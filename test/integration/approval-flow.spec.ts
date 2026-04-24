import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';

const REQUESTS_BASE = '/api/v1/time-off/requests';

async function submitRequest(
  app: INestApplication,
  opts: { employeeId?: string; daysRequested?: number; startDate?: string; endDate?: string } = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(REQUESTS_BASE)
    .send({
      employeeId: opts.employeeId ?? 'emp1',
      locationId: 'loc1',
      leaveType: 'VACATION',
      startDate: opts.startDate ?? '2035-06-01',
      endDate: opts.endDate ?? '2035-06-05',
      daysRequested: opts.daysRequested ?? 5,
    });
  if (res.status !== 201) throw new Error(`Submit failed: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

describe('Approval / Rejection / Cancellation Flows', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4002);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4002 });
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  beforeEach(() => mockHcm.reset());

  describe('PATCH /requests/:id/approve', () => {
    it('200 APPROVED — HCM accepts deduction; hcm_committed is set', async () => {
      mockHcm.seed({ employeeId: 'emp1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app);

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.hcmCommitted).toBe(1);
      expect(res.body.hcmTransactionId).toBeDefined();
    });

    it('422 HCM_BALANCE_MISMATCH — balance dropped to 0 between submit and approve; request stays PENDING', async () => {
      mockHcm.seed({ employeeId: 'emp_drop', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_drop' });

      // Drain balance in HCM
      mockHcm.setBalance('emp_drop', 'loc1', 'VACATION', 0);

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('HCM_BALANCE_MISMATCH');

      const getRes = await request(app.getHttpServer()).get(`${REQUESTS_BASE}/${id}`);
      expect(getRes.body.status).toBe('PENDING');
    });

    it('202 HCM_DEDUCT_PENDING — HCM returns 503 during approval', async () => {
      mockHcm.seed({ employeeId: 'emp_503', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_503' });

      // Inject enough 503s to exhaust all retries
      mockHcm.injectError({ nextN: 10, statusCode: 503 });

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('HCM_DEDUCT_PENDING');
    }, 20_000);

    it('409 INVALID_STATUS_TRANSITION — approving an already-APPROVED request', async () => {
      mockHcm.seed({ employeeId: 'emp_dbl', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_dbl' });

      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });

    it('409 INVALID_STATUS_TRANSITION — approving a REJECTED request', async () => {
      mockHcm.seed({ employeeId: 'emp_rej', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_rej' });

      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/reject`)
        .send({ managerId: 'mgr1', notes: 'no' });

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(409);
    });

    it('404 REQUEST_NOT_FOUND — ID does not exist', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/non-existent-id/approve`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('REQUEST_NOT_FOUND');
    });
  });

  describe('PATCH /requests/:id/reject', () => {
    it('200 REJECTED — no HCM call is made', async () => {
      mockHcm.seed({ employeeId: 'emp_r', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_r' });

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/reject`)
        .send({ managerId: 'mgr1', notes: 'Denied' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.managerId).toBe('mgr1');
      // Verify no HCM deduction happened
      expect(mockHcm.getBalance('emp_r', 'loc1', 'VACATION')).toBe(10);
    });

    it('409 INVALID_STATUS_TRANSITION — rejecting an already-APPROVED request', async () => {
      mockHcm.seed({ employeeId: 'emp_ra', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_ra' });

      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      const res = await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/reject`)
        .send({ managerId: 'mgr1' });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /requests/:id (cancel)', () => {
    it('200 CANCELLED — PENDING request; no HCM call made', async () => {
      mockHcm.seed({ employeeId: 'emp_c1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_c1' });

      const res = await request(app.getHttpServer())
        .delete(`${REQUESTS_BASE}/${id}`)
        .send({ employeeId: 'emp_c1' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      // Balance unchanged — no HCM call
      expect(mockHcm.getBalance('emp_c1', 'loc1', 'VACATION')).toBe(10);
    });

    it('200 CANCELLED — APPROVED request with hcm_committed; HCM credit call is made', async () => {
      mockHcm.seed({ employeeId: 'emp_c2', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_c2', daysRequested: 3 });

      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      const res = await request(app.getHttpServer())
        .delete(`${REQUESTS_BASE}/${id}`)
        .send({ employeeId: 'emp_c2' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      // 10 - 3 from deduct + 3 from credit = 10
      expect(mockHcm.getBalance('emp_c2', 'loc1', 'VACATION')).toBe(10);
    });

    it('202 CANCELLATION_CREDIT_PENDING — APPROVED + committed; HCM credit returns 503', async () => {
      mockHcm.seed({ employeeId: 'emp_c3', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_c3', daysRequested: 3 });

      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      // Inject enough 503s to exhaust all credit retries
      mockHcm.injectError({ nextN: 10, statusCode: 503 });

      const res = await request(app.getHttpServer())
        .delete(`${REQUESTS_BASE}/${id}`)
        .send({ employeeId: 'emp_c3' });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('CANCELLATION_CREDIT_PENDING');
    }, 20_000);

    it('200 CANCELLED — HCM_DEDUCT_PENDING request; cancelled locally with no HCM call', async () => {
      mockHcm.seed({ employeeId: 'emp_c4', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_c4', daysRequested: 3 });

      // Put it into HCM_DEDUCT_PENDING by injecting 503 on approve
      mockHcm.injectError({ nextN: 10, statusCode: 503 });
      await request(app.getHttpServer())
        .patch(`${REQUESTS_BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' });

      mockHcm.reset();
      mockHcm.seed({ employeeId: 'emp_c4', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

      const res = await request(app.getHttpServer())
        .delete(`${REQUESTS_BASE}/${id}`)
        .send({ employeeId: 'emp_c4' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    }, 20_000);

    it('404 — employee attempts to cancel another employee request', async () => {
      mockHcm.seed({ employeeId: 'emp_owner', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
      const id = await submitRequest(app, { employeeId: 'emp_owner' });

      const res = await request(app.getHttpServer())
        .delete(`${REQUESTS_BASE}/${id}`)
        .send({ employeeId: 'emp_other' });

      expect(res.status).toBe(404);
    });
  });
});
