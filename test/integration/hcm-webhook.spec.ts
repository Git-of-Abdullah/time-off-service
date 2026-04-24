import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';

const TEST_SECRET = 'test-hmac-secret';

function signPayload(body: string): string {
  return createHmac('sha256', TEST_SECRET).update(body).digest('hex');
}

describe('POST /api/v1/hcm/balance-update — Real-Time Webhook', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // TODO: bootstrap NestJS test app with HCM_WEBHOOK_SECRET=test-hmac-secret
  });

  afterAll(() => app?.close());

  it.todo('200 acknowledged — balance increase (work anniversary); local hcm_balance updated');
  it.todo('200 acknowledged — balance decrease with no pending requests; hcm_balance updated');
  it.todo('200 acknowledged — balance decrease puts pending requests into deficit; BALANCE_DEFICIT_WARNING logged');
  it.todo('401 — invalid HMAC signature; no DB write');
  it.todo('401 — missing X-HCM-Signature header');
  it.todo('401 — timestamp is older than 300 seconds (replay window exceeded)');
  it.todo('200 acknowledged — duplicate eventId; no DB write (idempotent)');
  it.todo('200 acknowledged — out-of-order event (effectiveAt < last_synced_at - 30s); event discarded');
  it.todo('200 acknowledged — eventId accepted when previous secret is used during rotation');
});
