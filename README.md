# Time-Off Microservice

NestJS microservice for managing employee time-off requests with HCM (Human Capital Management) system integration.

## Prerequisites

- Node.js 20+
- npm 9+

## Setup

```bash
# Install dependencies
npm install

# Start in watch mode (development)
npm run start:dev

# Build for production
npm run build
npm run start:prod
```

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=3000

# Database (SQLite — file path)
DATABASE_PATH=./time-off.db

# HCM integration
HCM_BASE_URL=http://localhost:4000
HCM_API_KEY=your-api-key-here

# Webhook HMAC secrets
HCM_WEBHOOK_SECRET=your-webhook-secret-here
HCM_WEBHOOK_SECRET_PREV=   # optional — used during secret rotation

# Balance staleness threshold in minutes (default: 30)
BALANCE_STALE_THRESHOLD_MINUTES=30
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/time-off/requests` | Submit a new time-off request |
| `GET` | `/api/v1/time-off/requests/:id` | Get a single request |
| `GET` | `/api/v1/time-off/requests` | List requests (query: employeeId, locationId, status) |
| `POST` | `/api/v1/time-off/requests/:id/approve` | Approve a request |
| `POST` | `/api/v1/time-off/requests/:id/reject` | Reject a request |
| `POST` | `/api/v1/time-off/requests/:id/cancel` | Cancel a request |
| `GET` | `/api/v1/time-off/balances/:employeeId/:locationId` | Get leave balances |
| `POST` | `/api/v1/hcm/balance-update` | Real-time HCM webhook (HMAC-protected) |
| `POST` | `/api/v1/hcm/batch-sync` | Batch balance sync from HCM (HMAC-protected) |

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

## Project Structure

```
src/
├── main.ts                        # Bootstrap (rawBody, ValidationPipe, global prefix)
├── app.module.ts                  # Root module
├── common/
│   ├── enums/                     # RequestStatus enum + constants
│   ├── filters/                   # GlobalExceptionFilter
│   ├── guards/                    # HmacSignatureGuard
│   └── interceptors/              # RequestIdInterceptor
├── time-off/
│   ├── entities/                  # TimeOffRequest entity
│   ├── repositories/              # TimeOffRequestRepository (query layer)
│   ├── dto/                       # SubmitTimeOffDto, ApproveTimeOffDto, etc.
│   ├── time-off.service.ts        # Business logic (submit, approve, reject, cancel)
│   ├── time-off.controller.ts
│   └── time-off.module.ts
├── balance/
│   ├── entities/                  # LeaveBalance entity
│   ├── dto/
│   ├── balance.service.ts         # getBalance, syncFromHcm, computeAvailable
│   ├── balance.controller.ts
│   └── balance.module.ts
├── hcm/
│   ├── dto/                       # BatchSyncDto, BalanceUpdateWebhookDto
│   ├── hcm.client.ts              # HTTP client with retry + exponential backoff
│   ├── hcm-sync.service.ts        # @Cron retry jobs for async-pending statuses
│   ├── hcm.controller.ts          # Webhook + batch-sync endpoints
│   └── hcm.module.ts
└── database/
    ├── entities/                  # HcmSyncLog entity
    └── database.module.ts

test/
├── mock-hcm/
│   ├── server.ts                  # MockHcmServer — real Express server on configurable port
│   ├── handlers.ts                # Route handlers with real balance deduction logic
│   └── control.routes.ts         # /test/* control endpoints for test setup
├── unit/                          # Unit test specs
└── integration/                   # Integration test specs (use MockHcmServer)
```

## Key Design Decisions

**Balance model** — Three values: `hcm_balance` (HCM-owned, cached locally), `pending_days` (sum of PENDING + HCM_DEDUCT_PENDING rows), `available_balance` (computed at query time: `hcm_balance - pending_days`). The available balance is never stored.

**Concurrency** — SQLite serializes all writes natively. Available balance is re-verified inside the write transaction, making double-booking impossible without distributed locking.

**HCM downtime** — If HCM is unavailable during approval, the request moves to `HCM_DEDUCT_PENDING`. A `@Cron('*/5 * * * *')` job retries these. Same pattern for cancellations (`CANCELLATION_CREDIT_PENDING`).

**Idempotency** — Enforced at the database layer via a `UNIQUE` constraint on `idempotency_key`. The key is SHA-256 derived from request content if no `Idempotency-Key` header is provided.

**Webhook security** — HMAC-SHA256 with `crypto.timingSafeEqual`, 300-second replay window, dual-secret support for zero-downtime rotation.
