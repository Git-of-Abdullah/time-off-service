import { INestApplication } from '@nestjs/common';

describe('POST /api/v1/hcm/batch-sync — Batch Sync', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    // TODO: bootstrap NestJS test app
  });

  afterAll(() => app?.close());

  it.todo('202 PROCESSING — 100 records; all local balances updated correctly');
  it.todo('202 PROCESSING — balance decreases in batch create BALANCE_DEFICIT_WARNING for affected employees');
  it.todo('202 already processed — same payload hash sent twice; no re-write on second call');
  it.todo('202 PROCESSING — 1500 records processed in 3 chunks of 500; all committed');
  it.todo('202 PROCESSING — batch contains duplicate (employeeId, locationId, leaveType); last occurrence wins');
  it.todo('401 — invalid HMAC signature; no processing');
  it.todo('413 — payload exceeds maximum body size limit');
});
