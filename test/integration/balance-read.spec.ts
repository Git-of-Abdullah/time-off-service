import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createHmac } from 'crypto';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';

const TEST_SECRET = 'test-hmac-secret';

async function seedBalanceViaWebhook(
  app: INestApplication,
  employeeId: string,
  locationId: string,
  balance: number,
  effectiveAt?: string,
) {
  const body = JSON.stringify({
    eventId: `evt_seed_${employeeId}_${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    eventType: 'BALANCE_UPDATE',
    employeeId,
    locationId,
    leaveType: 'VACATION',
    newBalance: balance,
    reason: 'SEED',
    effectiveAt: effectiveAt ?? new Date().toISOString(),
  });
  const sig = createHmac('sha256', TEST_SECRET).update(body).digest('hex');
  await request(app.getHttpServer())
    .post('/api/v1/hcm/balance-update')
    .set('Content-Type', 'application/json')
    .set('x-hcm-signature', sig)
    .send(body);
}

describe('GET /api/v1/time-off/balances/:employeeId/:locationId', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4003);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4003, webhookSecret: TEST_SECRET });
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  beforeEach(() => mockHcm.reset());

  it('200 — returns available balance deducting pending days from hcm_balance', async () => {
    mockHcm.seed({ employeeId: 'emp_bal1', locationId: 'loc1', leaveType: 'VACATION', balance: 10 });
    await seedBalanceViaWebhook(app, 'emp_bal1', 'loc1', 10);

    // Submit a pending request to create pending days
    await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .send({
        employeeId: 'emp_bal1',
        locationId: 'loc1',
        leaveType: 'VACATION',
        startDate: '2035-06-01',
        endDate: '2035-06-03',
        daysRequested: 3,
      });

    const res = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_bal1/loc1');

    expect(res.status).toBe(200);
    const vac = res.body.balances.find((b: any) => b.leaveType === 'VACATION');
    expect(vac?.hcmBalance).toBe(10);
    expect(vac?.pendingDays).toBe(3);
    expect(vac?.availableBalance).toBe(7);
  });

  it('200 — isStale=false when lastSyncedAt is within threshold', async () => {
    await seedBalanceViaWebhook(app, 'emp_fresh', 'loc1', 10);

    const res = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_fresh/loc1');

    expect(res.status).toBe(200);
    const vac = res.body.balances.find((b: any) => b.leaveType === 'VACATION');
    expect(vac?.isStale).toBe(false);
  });

  it('200 — ?refresh=true forces HCM call and updates local cache', async () => {
    mockHcm.seed({ employeeId: 'emp_ref', locationId: 'loc1', leaveType: 'VACATION', balance: 20 });
    await seedBalanceViaWebhook(app, 'emp_ref', 'loc1', 10); // local = 10

    const res = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_ref/loc1?refresh=true');

    expect(res.status).toBe(200);
    const vac = res.body.balances.find((b: any) => b.leaveType === 'VACATION');
    // After refresh, local should reflect HCM value (20)
    expect(vac?.hcmBalance).toBe(20);
  });

  it('200 — ?leaveType= filters response to a single leave type', async () => {
    mockHcm.seed({ employeeId: 'emp_lt', locationId: 'loc1', leaveType: 'VACATION', balance: 5 });
    mockHcm.seed({ employeeId: 'emp_lt', locationId: 'loc1', leaveType: 'SICK', balance: 10 });
    await seedBalanceViaWebhook(app, 'emp_lt', 'loc1', 5);

    // Also seed SICK via a batch to make it exist locally
    const sickBody = JSON.stringify({
      syncId: 'sync_sick',
      generatedAt: new Date().toISOString(),
      records: [{ employeeId: 'emp_lt', locationId: 'loc1', leaveType: 'SICK', balance: 10 }],
    });
    const sig = createHmac('sha256', TEST_SECRET).update(sickBody).digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/hcm/batch-sync')
      .set('Content-Type', 'application/json')
      .set('x-hcm-signature', sig)
      .send(sickBody);

    const res = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_lt/loc1?leaveType=VACATION');

    expect(res.status).toBe(200);
    expect(res.body.balances).toHaveLength(1);
    expect(res.body.balances[0].leaveType).toBe('VACATION');
  });

  it('200 — returns empty balances array for an employee with no local records', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_nonexistent/loc1');

    expect(res.status).toBe(200);
    expect(res.body.balances).toEqual([]);
  });
});
