import { INestApplication } from '@nestjs/common';
import { MockHcmServer } from '../mock-hcm/server';

describe('Concurrency — Race Condition Guards', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4006);
    await mockHcm.start();
    // TODO: bootstrap NestJS test app
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app?.close();
  });

  beforeEach(() => mockHcm.reset());

  it.todo('exactly one 201 and one 422 — two simultaneous 3-day requests against a 5-day balance');
  it.todo('exactly two 201 and one 422 — three simultaneous 4-day requests against a 10-day balance');
  it.todo('exactly one succeeds — concurrent approve and cancel on the same request; other gets 409');
});
