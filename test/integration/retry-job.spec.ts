import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';
import { HcmSyncService } from '../../src/hcm/hcm-sync.service';

const BASE = '/api/v1/time-off/requests';

async function submitAndApproveToDeductPending(
  app: INestApplication,
  mockHcm: MockHcmServer,
  employeeId: string,
): Promise<string> {
  mockHcm.seed({ employeeId, locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

  const submitRes = await request(app.getHttpServer())
    .post(BASE)
    .send({
      employeeId,
      locationId: 'loc1',
      leaveType: 'VACATION',
      startDate: '2035-06-01',
      endDate: '2035-06-05',
      daysRequested: 5,
    });
  if (submitRes.status !== 201) throw new Error(`Submit failed: ${JSON.stringify(submitRes.body)}`);
  const id = submitRes.body.id as string;

  // Inject 503 so approve leaves it in HCM_DEDUCT_PENDING
  mockHcm.injectError({ nextN: 10, statusCode: 503 });
  const approveRes = await request(app.getHttpServer())
    .patch(`${BASE}/${id}/approve`)
    .send({ managerId: 'mgr1' });
  if (approveRes.status !== 202) throw new Error(`Approve didn't leave HCM_DEDUCT_PENDING: ${JSON.stringify(approveRes.body)}`);

  return id;
}

describe('Background Retry Job — HCM_DEDUCT_PENDING / CANCELLATION_CREDIT_PENDING', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;
  let syncService: HcmSyncService;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4005);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4005 });
    syncService = app.get(HcmSyncService);
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  beforeEach(() => mockHcm.reset());

  describe('HCM_DEDUCT_PENDING retry', () => {
    it('APPROVED — HCM recovers on next retry; status transitions to APPROVED', async () => {
      const id = await submitAndApproveToDeductPending(app, mockHcm, 'emp_retry1');

      // HCM is now healthy again — run one retry cycle manually
      mockHcm.reset();
      mockHcm.seed({ employeeId: 'emp_retry1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      await syncService.retryAsyncPending();

      const getRes = await request(app.getHttpServer()).get(`${BASE}/${id}`);
      expect(getRes.body.status).toBe('APPROVED');
      expect(getRes.body.hcmCommitted).toBe(1);
    }, 30_000);

    it('PENDING — HCM returns INSUFFICIENT_BALANCE on retry; status returns to PENDING', async () => {
      const id = await submitAndApproveToDeductPending(app, mockHcm, 'emp_retry2');

      // HCM now has insufficient balance
      mockHcm.reset();
      mockHcm.seed({ employeeId: 'emp_retry2', locationId: 'loc1', leaveType: 'VACATION', balance: 0 });
      await syncService.retryAsyncPending();

      const getRes = await request(app.getHttpServer()).get(`${BASE}/${id}`);
      expect(getRes.body.status).toBe('PENDING');
    }, 30_000);

    it('REJECTED — HCM returns 400 on retry; status transitions to REJECTED', async () => {
      const id = await submitAndApproveToDeductPending(app, mockHcm, 'emp_retry3');

      mockHcm.reset();
      mockHcm.seed({ employeeId: 'emp_retry3', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      mockHcm.injectError({ nextN: 1, statusCode: 400 });

      await syncService.retryAsyncPending();

      const getRes = await request(app.getHttpServer()).get(`${BASE}/${id}`);
      expect(getRes.body.status).toBe('REJECTED');
    }, 30_000);
  });

  describe('CANCELLATION_CREDIT_PENDING retry', () => {
    it('CANCELLED — HCM credit succeeds on retry; status transitions to CANCELLED', async () => {
      mockHcm.seed({ employeeId: 'emp_cred1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

      const submitRes = await request(app.getHttpServer())
        .post(BASE)
        .send({
          employeeId: 'emp_cred1',
          locationId: 'loc1',
          leaveType: 'VACATION',
          startDate: '2035-06-01',
          endDate: '2035-06-05',
          daysRequested: 5,
        });
      const id = submitRes.body.id as string;

      await request(app.getHttpServer())
        .patch(`${BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      // Inject 503 so cancel leaves it CANCELLATION_CREDIT_PENDING
      mockHcm.injectError({ nextN: 10, statusCode: 503 });
      const cancelRes = await request(app.getHttpServer())
        .delete(`${BASE}/${id}`)
        .send({ employeeId: 'emp_cred1' });
      expect(cancelRes.status).toBe(202);

      // HCM recovers
      mockHcm.reset();
      mockHcm.seed({ employeeId: 'emp_cred1', locationId: 'loc1', leaveType: 'VACATION', balance: 5 });
      await syncService.retryAsyncPending();

      const getRes = await request(app.getHttpServer()).get(`${BASE}/${id}`);
      expect(getRes.body.status).toBe('CANCELLED');
    }, 30_000);
  });
});
