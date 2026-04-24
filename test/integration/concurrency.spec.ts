import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';

const BASE = '/api/v1/time-off/requests';

function makePayload(employeeId: string, days: number, start: string, end: string) {
  return {
    employeeId,
    locationId: 'loc1',
    leaveType: 'VACATION',
    startDate: start,
    endDate: end,
    daysRequested: days,
  };
}

describe('Concurrency — Race Condition Guards', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4006);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4006 });
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  beforeEach(() => mockHcm.reset());

  it('exactly one 201 and one 422 — two simultaneous 3-day requests against a 5-day balance', async () => {
    mockHcm.seed({ employeeId: 'emp_race1', locationId: 'loc1', leaveType: 'VACATION', balance: 5 });

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(BASE)
        .set('idempotency-key', 'race1-key-a')
        .send(makePayload('emp_race1', 3, '2035-06-01', '2035-06-03')),
      request(app.getHttpServer())
        .post(BASE)
        .set('idempotency-key', 'race1-key-b')
        .send(makePayload('emp_race1', 3, '2035-07-01', '2035-07-03')),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 422]);
  });

  it('exactly two 201 and one 422 — three simultaneous 4-day requests against a 10-day balance', async () => {
    mockHcm.seed({ employeeId: 'emp_race2', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const [r1, r2, r3] = await Promise.all([
      request(app.getHttpServer())
        .post(BASE)
        .set('idempotency-key', 'race2-key-a')
        .send(makePayload('emp_race2', 4, '2035-06-01', '2035-06-04')),
      request(app.getHttpServer())
        .post(BASE)
        .set('idempotency-key', 'race2-key-b')
        .send(makePayload('emp_race2', 4, '2035-07-01', '2035-07-04')),
      request(app.getHttpServer())
        .post(BASE)
        .set('idempotency-key', 'race2-key-c')
        .send(makePayload('emp_race2', 4, '2035-08-01', '2035-08-04')),
    ]);

    const statuses = [r1.status, r2.status, r3.status].sort();
    expect(statuses).toEqual([201, 201, 422]);
  });

  it('consistent final state — concurrent approve and cancel; no double-commit', async () => {
    mockHcm.seed({ employeeId: 'emp_race3', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const submitRes = await request(app.getHttpServer())
      .post(BASE)
      .send(makePayload('emp_race3', 5, '2035-06-01', '2035-06-05'));
    expect(submitRes.status).toBe(201);
    const id = submitRes.body.id as string;

    // Concurrently approve and cancel
    const [approveRes, cancelRes] = await Promise.all([
      request(app.getHttpServer())
        .patch(`${BASE}/${id}/approve`)
        .send({ managerId: 'mgr1' }),
      request(app.getHttpServer())
        .delete(`${BASE}/${id}`)
        .send({ employeeId: 'emp_race3' }),
    ]);

    const successCount = [approveRes.status, cancelRes.status].filter(
      (s) => s === 200 || s === 202,
    ).length;

    // At least one must succeed
    expect(successCount).toBeGreaterThanOrEqual(1);

    // Final state must be a valid terminal/pending state — never PENDING (both skipped it)
    const finalRes = await request(app.getHttpServer()).get(`${BASE}/${id}`);
    expect(['APPROVED', 'CANCELLED', 'HCM_DEDUCT_PENDING', 'CANCELLATION_CREDIT_PENDING']).toContain(
      finalRes.body.status,
    );
  }, 20_000);
});
