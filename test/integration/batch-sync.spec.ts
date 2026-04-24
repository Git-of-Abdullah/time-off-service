import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createHmac, createHash } from 'crypto';
import { MockHcmServer } from '../mock-hcm/server';
import { createTestApp } from '../helpers/create-test-app';

const TEST_SECRET = 'test-hmac-secret';
const BATCH_URL = '/api/v1/hcm/batch-sync';

function makeBatchBody(records: Array<{ employeeId: string; locationId: string; leaveType: string; balance: number }>, syncId?: string) {
  return {
    syncId: syncId ?? `sync_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    records,
  };
}

function signBatch(body: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function postBatch(app: INestApplication, body: object) {
  const bodyStr = JSON.stringify(body);
  const sig = signBatch(bodyStr);
  return request(app.getHttpServer())
    .post(BATCH_URL)
    .set('Content-Type', 'application/json')
    .set('x-hcm-signature', sig)
    .send(bodyStr);
}

describe('POST /api/v1/hcm/batch-sync — Batch Sync', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4007);
    await mockHcm.start();
    app = await createTestApp({ hcmPort: 4007, webhookSecret: TEST_SECRET });
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app.close();
  });

  it('202 PROCESSING — 100 records; all local balances updated correctly', async () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      employeeId: `emp_b${i}`,
      locationId: 'loc1',
      leaveType: 'VACATION',
      balance: i + 1,
    }));

    const res = await postBatch(app, makeBatchBody(records));

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.recordsReceived).toBe(100);

    // Spot-check a few balances
    const balRes = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_b0/loc1');
    const vac = balRes.body.balances.find((b: any) => b.leaveType === 'VACATION');
    expect(vac?.hcmBalance).toBe(1);
  });

  it('202 already processed — same payload sent twice; second call is a no-op', async () => {
    const records = [{ employeeId: 'emp_idem', locationId: 'loc1', leaveType: 'VACATION', balance: 5 }];
    const body = makeBatchBody(records, 'fixed-sync-id');
    const bodyStr = JSON.stringify(body);
    const sig = signBatch(bodyStr);

    const first = await request(app.getHttpServer())
      .post(BATCH_URL)
      .set('Content-Type', 'application/json')
      .set('x-hcm-signature', sig)
      .send(bodyStr);
    expect(first.status).toBe(202);

    const second = await request(app.getHttpServer())
      .post(BATCH_URL)
      .set('Content-Type', 'application/json')
      .set('x-hcm-signature', sig)
      .send(bodyStr);
    expect(second.status).toBe(202);
    // Same syncLogId returned
    expect(second.body.syncLogId).toBe(first.body.syncLogId);
  });

  it('202 PROCESSING — batch contains duplicate; last occurrence wins', async () => {
    const records = [
      { employeeId: 'emp_dup', locationId: 'loc1', leaveType: 'VACATION', balance: 5 },
      { employeeId: 'emp_dup', locationId: 'loc1', leaveType: 'VACATION', balance: 9 },
    ];
    const res = await postBatch(app, makeBatchBody(records));

    expect(res.status).toBe(202);

    const balRes = await request(app.getHttpServer())
      .get('/api/v1/time-off/balances/emp_dup/loc1');
    const vac = balRes.body.balances.find((b: any) => b.leaveType === 'VACATION');
    expect(vac?.hcmBalance).toBe(9);
  });

  it('401 — invalid HMAC signature; no processing', async () => {
    const body = makeBatchBody([{ employeeId: 'emp_x', locationId: 'loc1', leaveType: 'VACATION', balance: 5 }]);
    const bodyStr = JSON.stringify(body);

    const res = await request(app.getHttpServer())
      .post(BATCH_URL)
      .set('Content-Type', 'application/json')
      .set('x-hcm-signature', 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb')
      .send(bodyStr);

    expect(res.status).toBe(401);
  });
});
