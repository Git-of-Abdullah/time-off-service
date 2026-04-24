import { INestApplication } from '@nestjs/common';
import { MockHcmServer } from '../mock-hcm/server';

describe('GET /api/v1/time-off/balances/:employeeId/:locationId', () => {
  let app: INestApplication | undefined;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4003);
    await mockHcm.start();
    // TODO: bootstrap NestJS test app
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app?.close();
  });

  beforeEach(() => mockHcm.reset());

  it.todo('200 — returns available balance deducting pending days from hcm_balance');
  it.todo('200 — isStale=false when lastSyncedAt is within threshold');
  it.todo('200 — isStale=true when lastSyncedAt exceeds threshold');
  it.todo('200 — ?refresh=true forces HCM call and updates local cache');
  it.todo('200 — ?leaveType= filters response to a single leave type');
  it.todo('200 — returns empty balances array for an employee with no local records');
});
