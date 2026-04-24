import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TimeOffModule } from '../../src/time-off/time-off.module';
import { BalanceModule } from '../../src/balance/balance.module';
import { HcmModule } from '../../src/hcm/hcm.module';
import { TimeOffRequest } from '../../src/time-off/entities/time-off-request.entity';
import { LeaveBalance } from '../../src/balance/entities/leave-balance.entity';
import { HcmSyncLog } from '../../src/database/entities/hcm-sync-log.entity';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { RequestIdInterceptor } from '../../src/common/interceptors/request-id.interceptor';

export interface TestAppOptions {
  hcmPort: number;
  webhookSecret?: string;
}

export async function createTestApp(opts: TestAppOptions): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            NODE_ENV: 'test',
            API_PREFIX: 'api/v1',
            DATABASE_PATH: ':memory:',
            HCM_BASE_URL: `http://localhost:${opts.hcmPort}`,
            HCM_MAX_RETRIES: 3,
            HCM_TIMEOUT_MS: 4000,
            HCM_WEBHOOK_SECRET: opts.webhookSecret ?? 'test-hmac-secret',
            HCM_WEBHOOK_SECRET_PREV: '',
            BALANCE_STALE_THRESHOLD_MINUTES: 30,
          }),
        ],
      }),
      ScheduleModule.forRoot(),
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [TimeOffRequest, LeaveBalance, HcmSyncLog],
        synchronize: true,
        logging: false,
      }),
      BalanceModule,
      TimeOffModule,
      HcmModule,
    ],
  }).compile();

  const app = module.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  await app.init();
  return app;
}
