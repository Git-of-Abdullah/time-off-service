import { INestApplication } from '@nestjs/common';
import { MockHcmServer } from '../mock-hcm/server';

describe('POST /api/v1/time-off/requests — Request Submission', () => {
  let app: INestApplication | undefined;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4001);
    await mockHcm.start();
    // TODO: bootstrap NestJS test app pointing at mock HCM port 4001
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app?.close();
  });

  beforeEach(() => mockHcm.reset());

  it.todo('201 Created — valid submission with sufficient balance');
  it.todo('201 Created — balance exactly meets the requested days');
  it.todo('201 Created — first-time employee; no local balance record; HCM confirms balance');
  it.todo('201 Created — local cache is stale and lower; HCM has more; local cache updated after submission');
  it.todo('422 INSUFFICIENT_BALANCE — local computed balance is less than daysRequested');
  it.todo('422 HCM_BALANCE_MISMATCH — local cache shows sufficient; HCM confirms insufficient; local cache updated');
  it.todo('503 HCM_UNAVAILABLE — HCM returns 503 three times; no DB record created');
  it.todo('200 OK (idempotent) — same Idempotency-Key sent twice; second call returns original record');
  it.todo('200 OK (idempotent) — same content sent twice without header; derived key deduplicates');
  it.todo('409 OVERLAPPING_REQUEST — new request dates overlap an existing PENDING request');
  it.todo('409 OVERLAPPING_REQUEST — new request dates overlap an existing APPROVED request');
  it.todo('400 DATE_IN_PAST — startDate is yesterday');
  it.todo('400 — daysRequested is 0');
  it.todo('400 — daysRequested is 91 (exceeds cap)');
  it.todo('201 Created — float precision: employee has 5.0 days; two 2.5-day requests both succeed');
});
