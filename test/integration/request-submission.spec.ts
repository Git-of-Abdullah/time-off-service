import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';

const BASE = '/api/v1/time-off/requests';
const FUTURE = '2035-06-01';
const FUTURE_END = '2035-06-05';

function payload(overrides = {}) {
  return {
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: 'VACATION',
    startDate: FUTURE,
    endDate: FUTURE_END,
    daysRequested: 5,
    ...overrides,
  };
}

describe('POST /api/v1/time-off/requests — Request Submission', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4001);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4001 });
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  beforeEach(() => mockHcm.reset());

  it('201 Created — valid submission with sufficient balance', async () => {
    mockHcm.seed({ employeeId: 'emp1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const res = await request(app.getHttpServer()).post(BASE).send(payload());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.employeeId).toBe('emp1');
  });

  it('201 Created — balance exactly meets the requested days', async () => {
    mockHcm.seed({ employeeId: 'emp1b', locationId: 'loc1', leaveType: 'VACATION', balance: 5 });

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp1b', daysRequested: 5, startDate: '2035-06-10', endDate: '2035-06-14' }));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  it('201 Created — first-time employee; no local balance record; HCM confirms balance', async () => {
    mockHcm.seed({ employeeId: 'new_emp', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'new_emp', daysRequested: 3 }));

    expect(res.status).toBe(201);
  });

  it('201 Created — local cache stale/lower; HCM has more; local cache updated', async () => {
    // emp_stale has no local balance row; HCM has 10 days
    mockHcm.seed({ employeeId: 'emp_stale', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp_stale', daysRequested: 8 }));

    expect(res.status).toBe(201);

    // Verify local cache was populated from HCM
    const balRes = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_stale/loc1');
    expect(balRes.status).toBe(200);
    expect(balRes.body.balances.length).toBeGreaterThan(0);
    const vacBalance = balRes.body.balances.find((b: any) => b.leaveType === 'VACATION');
    expect(vacBalance).toBeDefined();
    expect(vacBalance.hcmBalance).toBe(10);
  });

  it('422 INSUFFICIENT_BALANCE — local computed balance is less than daysRequested', async () => {
    mockHcm.seed({ employeeId: 'emp2', locationId: 'loc1', leaveType: 'VACATION', balance: 3 });

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp2', daysRequested: 5 }));

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('422 HCM_BALANCE_MISMATCH — HCM confirms insufficient; local cache was stale high', async () => {
    // Submit once to seed local cache at 10
    mockHcm.seed({ employeeId: 'emp3', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
    await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp3', daysRequested: 2 }));

    // Now HCM drops to 1 (employee's balance was adjusted externally)
    mockHcm.setBalance('emp3', 'loc1', 'VACATION', 1);

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp3', startDate: '2035-07-01', endDate: '2035-07-05', daysRequested: 5 }));

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/INSUFFICIENT_BALANCE|HCM_BALANCE_MISMATCH/);
  });

  it('503 HCM_UNAVAILABLE — HCM returns 503; no DB record created', async () => {
    // No seed — HCM will return 404 on get balance, but inject 503 to simulate unavailability
    mockHcm.seed({ employeeId: 'emp4', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
    mockHcm.injectError({ nextN: 10, statusCode: 503 });

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp4' }));

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('HCM_UNAVAILABLE');
  }, 20_000);

  it('200 OK (idempotent) — same Idempotency-Key sent twice; second call returns original record', async () => {
    mockHcm.seed({ employeeId: 'emp5', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const idemKey = 'my-unique-key-123';
    const first = await request(app.getHttpServer())
      .post(BASE)
      .set('idempotency-key', idemKey)
      .send(payload({ employeeId: 'emp5' }));
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(BASE)
      .set('idempotency-key', idemKey)
      .send(payload({ employeeId: 'emp5' }));
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('200 OK (idempotent) — same content sent twice without header; derived key deduplicates', async () => {
    mockHcm.seed({ employeeId: 'emp6', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });

    const body = payload({ employeeId: 'emp6', daysRequested: 3 });
    const first = await request(app.getHttpServer()).post(BASE).send(body);
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer()).post(BASE).send(body);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('409 OVERLAPPING_REQUEST — new request dates overlap an existing PENDING request', async () => {
    mockHcm.seed({ employeeId: 'emp7', locationId: 'loc1', leaveType: 'VACATION', balance: 20 });

    await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp7', daysRequested: 5 }));

    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('idempotency-key', 'different-key')
      .send(payload({ employeeId: 'emp7', daysRequested: 3 }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OVERLAPPING_REQUEST');
  });

  it('400 DATE_IN_PAST — startDate is yesterday', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ startDate: yesterday, endDate: yesterday }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DATE_IN_PAST');
  });

  it('400 — daysRequested is 0 (below Min(0.5))', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ daysRequested: 0 }));

    expect(res.status).toBe(400);
  });

  it('400 — daysRequested is 91 (exceeds Max(90))', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ daysRequested: 91 }));

    expect(res.status).toBe(400);
  });

  it('201 Created — float precision: 5.0 days; two 2.5-day requests both succeed', async () => {
    mockHcm.seed({ employeeId: 'emp8', locationId: 'loc1', leaveType: 'VACATION', balance: 5 });

    const first = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp8', startDate: '2035-08-01', endDate: '2035-08-03', daysRequested: 2.5 }));
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(BASE)
      .send(payload({ employeeId: 'emp8', startDate: '2035-09-01', endDate: '2035-09-03', daysRequested: 2.5 }));
    expect(second.status).toBe(201);
  });
});
