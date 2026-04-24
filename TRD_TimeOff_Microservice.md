# Technical Requirement Document (TRD)
## Time-Off Microservice — ExampleHR

**Author:** M. Abdullah Butt  
**Date:** April 24, 2026  
**Version:** 1.1  
**Status:** Draft  
**Stack:** NestJS · SQLite · TypeORM  

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [System Goals & Non-Goals](#2-system-goals--non-goals)
3. [Key Challenges](#3-key-challenges)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Data Model Design](#5-data-model-design)
6. [API Design](#6-api-design)
7. [Core Workflows](#7-core-workflows)
8. [Consistency & Sync Strategy](#8-consistency--sync-strategy)
9. [Error Handling & Resilience](#9-error-handling--resilience)
10. [Edge Cases](#10-edge-cases)
11. [Security Considerations](#11-security-considerations)
12. [Testing Strategy](#12-testing-strategy)
13. [Tradeoffs & Alternatives](#13-tradeoffs--alternatives)
14. [Future Improvements](#14-future-improvements)

---

## 1. Problem Statement

ExampleHR provides employees with a time-off management interface. However, the **Human Capital Management (HCM)** system (e.g., Workday, SAP) is the authoritative source of truth for all leave balances. Balances are scoped per **employee × location**.

This creates a **dual-write problem**: when an employee submits a time-off request, ExampleHR must reflect the balance impact accurately — but cannot unilaterally own that balance. HCM may independently modify balances at any time (work anniversary bonuses, year-start accrual resets, manual HR corrections), and ExampleHR must reconcile with those changes.

The core tension: employees expect real-time feedback on submission, but HCM is the only system that can validate and commit a balance change, and neither system has a complete view of the other's in-flight state.

---

## 2. System Goals & Non-Goals

### Goals

| ID | Goal |
|----|------|
| G1 | Accept time-off requests with synchronous, accurate feedback. |
| G2 | Validate balance against HCM before accepting any request. |
| G3 | Maintain a locally consistent view: HCM-committed balance minus locally pending days. |
| G4 | Handle HCM-initiated balance updates via both real-time webhooks and batch sync. |
| G5 | Support manager approval/rejection with correct state transitions. |
| G6 | Prevent double-deductions through idempotent request handling. |
| G7 | Degrade gracefully when HCM is unavailable, with explicit staleness signaling. |

### Non-Goals

| ID | Non-Goal |
|----|----------|
| NG1 | Managing employee profiles or job data (owned by HCM). |
| NG2 | Payroll calculations or pay code mapping. |
| NG3 | Replacing HCM as the system of record — this service is a coordination and cache layer. |
| NG4 | Authentication and JWT issuance (handled by upstream API gateway). |
| NG5 | Multi-step approval chains (single-level manager approval only). |
| NG6 | Calendar or scheduling integrations. |

---

## 3. Key Challenges

### 3.1 Data Inconsistency Between Systems

HCM does not know about requests pending in ExampleHR. ExampleHR's cached HCM balance may be stale if HCM updated it independently. The correct available balance requires combining both views, meaning neither system alone can answer the question "can this employee take leave right now?"

### 3.2 Concurrent Requests

Two simultaneous requests for the same employee can both read the same balance snapshot, independently conclude they have sufficient balance, and both be accepted — resulting in combined deductions exceeding the available balance. This must be enforced at the persistence layer, not the application layer.

### 3.3 External HCM Balance Updates

| Channel | Trigger | Latency | Volume |
|---------|---------|---------|--------|
| Real-time webhook | Work anniversary, manual correction | Seconds | Per-employee |
| Batch sync | Scheduled (nightly, year-start) | Hours | All employees |

Both channels can arrive while requests are in-flight. A batch sync may reduce a balance below what pending requests have already claimed. The system must detect and surface this deficit without silently accepting invalid state.

### 3.4 Partial Failures

The submission and approval flows span two systems. Critical failure boundaries:
- HCM call succeeds, local DB write fails → deduction committed in HCM, not recorded locally.
- Local DB write succeeds, HCM fails on approval → request marked approved but balance not deducted.

Each failure mode must be recoverable without manual data surgery.

### 3.5 Idempotency

Network timeouts cause clients to retry. Every mutating operation must produce identical results regardless of how many times it is received, including at the DB level — application-layer deduplication alone is insufficient.

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ExampleHR Frontend                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP/HTTPS  (JWT via API Gateway)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Time-Off Microservice  (NestJS)                    │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     Controller Layer                      │  │
│  │  TimeOffController · BalanceController · HcmController    │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                               │                                  │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │                      Service Layer                        │  │
│  │   TimeOffService · BalanceService · HcmSyncService        │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                               │                                  │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │                   Repository Layer                        │  │
│  │     TimeOffRequestRepository · LeaveBalanceRepository     │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                               │                                  │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │              SQLite Database  (TypeORM)                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  HCM Client  (retry + backoff + domain error mapping)     │  │
│  └───────────────────────────┬───────────────────────────────┘  │
└───────────────────────────────┼─────────────────────────────────┘
                                │ HTTPS
                                ▼
              ┌─────────────────────────────────┐
              │     HCM System (Workday / SAP)  │
              │  · GET  /balance                 │
              │  · POST /balance/deduct          │
              │  · POST /balance/credit          │
              └─────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **TimeOffController** | HTTP layer: submission, listing, approval, rejection, cancellation. |
| **BalanceController** | Balance reads and manual sync triggers. |
| **HcmController** | Inbound HCM webhooks (real-time) and batch sync payloads. |
| **TimeOffService** | Request lifecycle: validate → HCM verify → persist. |
| **BalanceService** | Local balance cache, available-balance computation, staleness. |
| **HcmSyncService** | Batch payload processing; background retry for `HCM_DEDUCT_PENDING` requests. |
| **HcmClient** | Outbound HCM HTTP calls with retry and domain error mapping. |

No message queue or event bus in v1 — synchronous flows are simpler to reason about and test at this scale.

---

## 5. Data Model Design

### 5.1 TimeOffRequest

```sql
CREATE TABLE time_off_requests (
    id                  TEXT    PRIMARY KEY,        -- UUID v4
    idempotency_key     TEXT    UNIQUE NOT NULL,    -- SHA256(emp:loc:type:start:end) or client-provided
    employee_id         TEXT    NOT NULL,
    location_id         TEXT    NOT NULL,
    leave_type          TEXT    NOT NULL,           -- VACATION | SICK | PERSONAL | ...
    start_date          TEXT    NOT NULL,           -- ISO 8601: YYYY-MM-DD
    end_date            TEXT    NOT NULL,
    days_requested      REAL    NOT NULL,           -- agreed value at submission; avoids recalculation drift
    status              TEXT    NOT NULL DEFAULT 'PENDING',
    manager_id          TEXT,
    manager_notes       TEXT,
    hcm_transaction_id  TEXT,                      -- reference ID returned by HCM on deduction
    hcm_committed       INTEGER NOT NULL DEFAULT 0, -- 1 once HCM confirms deduction
    retry_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,

    CHECK (status IN (
        'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED',
        'HCM_DEDUCT_PENDING', 'CANCELLATION_CREDIT_PENDING', 'RETRY_EXHAUSTED'
    )),
    CHECK (days_requested > 0),
    CHECK (end_date >= start_date),
    CHECK (hcm_committed IN (0, 1))
);

CREATE INDEX idx_tor_employee_status  ON time_off_requests(employee_id, status);
CREATE INDEX idx_tor_date_range       ON time_off_requests(employee_id, location_id, start_date, end_date);
CREATE INDEX idx_tor_async_pending    ON time_off_requests(status)
    WHERE status IN ('HCM_DEDUCT_PENDING', 'CANCELLATION_CREDIT_PENDING');
```

**Notes:**
- `idempotency_key` — UNIQUE constraint enforces exactly-once at the storage layer.
- `hcm_committed` — separates "manager approved" from "HCM acknowledged the deduction." A request can be `APPROVED` with `hcm_committed = 0` while in `HCM_DEDUCT_PENDING`.
- `retry_count` — enables escalation after threshold in the background retry job.
- Partial index on async-pending statuses keeps the retry job query fast.

---

### 5.2 LeaveBalance

```sql
CREATE TABLE leave_balances (
    id              TEXT    PRIMARY KEY,
    employee_id     TEXT    NOT NULL,
    location_id     TEXT    NOT NULL,
    leave_type      TEXT    NOT NULL,
    hcm_balance     REAL    NOT NULL CHECK (hcm_balance >= 0),
    last_synced_at  TEXT    NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,

    UNIQUE (employee_id, location_id, leave_type)
);

CREATE INDEX idx_lb_employee ON leave_balances(employee_id, location_id);
```

**Notes:**
- `hcm_balance` is the last HCM-confirmed committed balance. It is **not** decremented on submission — only when HCM confirms a deduction, a webhook arrives, or a batch sync runs.
- `available_balance` is always computed at query time: `hcm_balance − SUM(days_requested WHERE status IN ('PENDING', 'HCM_DEDUCT_PENDING'))`. Storing it would create a second write target within our own service.
- `version` supports optimistic lock assertions on concurrent balance writes.

---

### 5.3 HcmSyncLog

```sql
CREATE TABLE hcm_sync_logs (
    id               TEXT PRIMARY KEY,
    sync_type        TEXT NOT NULL,    -- BATCH | REALTIME
    payload_hash     TEXT UNIQUE NOT NULL,  -- SHA-256; prevents duplicate batch processing
    status           TEXT NOT NULL,    -- PROCESSING | COMPLETED | FAILED
    records_total    INTEGER,
    records_updated  INTEGER,
    error_message    TEXT,
    received_at      TEXT NOT NULL,
    completed_at     TEXT
);
```

Dual purpose: idempotency guard (unique `payload_hash`) and audit trail for all sync operations.

---

## 6. API Design

All endpoints: `/api/v1` prefix, `application/json`. Consistent error envelope:

```json
{
  "statusCode": 422,
  "error": "INSUFFICIENT_BALANCE",
  "message": "Requested 5.0 days; 2.0 available.",
  "requestId": "req_abc123"
}
```

---

### 6.1 Submit a Time-Off Request

```
POST /api/v1/time-off/requests
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>   (optional; derived from content if absent)
```

**Request:**
```json
{
  "employeeId": "emp_123",
  "locationId": "loc_nyc",
  "leaveType": "VACATION",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "daysRequested": 5,
  "notes": "Family trip"
}
```

**Validation:** `startDate` ≥ today; `endDate` ≥ `startDate`; `daysRequested` ∈ (0, 90]; `leaveType` in enum; `employeeId` matches JWT `sub`.

**201 Created:**
```json
{
  "id": "req_abc123",
  "status": "PENDING",
  "employeeId": "emp_123",
  "locationId": "loc_nyc",
  "leaveType": "VACATION",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "daysRequested": 5,
  "balanceSnapshot": { "hcmBalance": 10.0, "pendingDays": 0.0, "availableBalance": 10.0 },
  "createdAt": "2026-04-24T10:00:00Z"
}
```

Duplicate `Idempotency-Key` → `200 OK` with original body, no side effects replayed.

**Errors:**

| HTTP | Code | Trigger |
|------|------|---------|
| 400 | `INVALID_DATE_RANGE` | `endDate` before `startDate` |
| 400 | `INVALID_LEAVE_TYPE` | Unknown leave type |
| 400 | `DATE_IN_PAST` | `startDate` in the past |
| 409 | `OVERLAPPING_REQUEST` | Dates overlap an existing PENDING or APPROVED request |
| 422 | `INSUFFICIENT_BALANCE` | Local computed balance insufficient |
| 422 | `HCM_BALANCE_MISMATCH` | HCM confirmed insufficient balance |
| 503 | `HCM_UNAVAILABLE` | HCM unreachable after retries |

---

### 6.2 Approve a Request

```
PATCH /api/v1/time-off/requests/:id/approve
```

**Request:** `{ "managerId": "mgr_456", "notes": "..." }`

**200 OK** (HCM deduction confirmed):
```json
{ "id": "req_abc123", "status": "APPROVED", "hcmCommitted": true, "hcmTransactionId": "hcm_txn_789" }
```

**202 Accepted** (HCM unavailable — deduction queued for retry):
```json
{ "id": "req_abc123", "status": "HCM_DEDUCT_PENDING" }
```

**Errors:** `404 REQUEST_NOT_FOUND` · `409 INVALID_STATE_TRANSITION` · `422 HCM_BALANCE_MISMATCH` · `503 HCM_UNAVAILABLE`

---

### 6.3 Reject a Request

```
PATCH /api/v1/time-off/requests/:id/reject
```

**Request:** `{ "managerId": "mgr_456", "notes": "..." }`

**200 OK:** `{ "id": "req_abc123", "status": "REJECTED" }`

No HCM call — balance was never deducted at submission.

---

### 6.4 Cancel a Request

```
DELETE /api/v1/time-off/requests/:id
```

| Current Status | Action |
|----------------|--------|
| `PENDING` | Cancel immediately; no HCM call. |
| `APPROVED`, `hcm_committed = 1` | Call HCM credit API to reverse deduction, then cancel. If HCM is down → `CANCELLATION_CREDIT_PENDING`, retry job handles it. |
| `HCM_DEDUCT_PENDING` | Cancel locally; retry job will find nothing to deduct. |

**200 OK:** `{ "id": "req_abc123", "status": "CANCELLED" }`

---

### 6.5 List Time-Off Requests

```
GET /api/v1/time-off/requests?employeeId=&locationId=&status=&leaveType=&from=&to=&page=&limit=
```

**200 OK:** `{ "data": [...], "pagination": { "page": 1, "limit": 20, "total": 45 } }`

---

### 6.6 Get Leave Balance

```
GET /api/v1/time-off/balances/:employeeId/:locationId[?leaveType=&refresh=true]
```

`refresh=true` bypasses cache and calls HCM directly.

**200 OK:**
```json
{
  "employeeId": "emp_123",
  "locationId": "loc_nyc",
  "balances": [{
    "leaveType": "VACATION",
    "hcmBalance": 10.0,
    "pendingDays": 3.0,
    "availableBalance": 7.0,
    "lastSyncedAt": "2026-04-24T09:00:00Z",
    "isStale": false
  }]
}
```

`isStale: true` when `lastSyncedAt` > 30 minutes ago.

---

### 6.7 Trigger Manual Balance Sync

```
POST /api/v1/time-off/balances/sync
{ "employeeId": "emp_123", "locationId": "loc_nyc", "leaveType": "VACATION" }
```

Forces a live HCM call and updates the local cache. Returns the refreshed balance.

---

### 6.8 Receive HCM Batch Sync

```
POST /api/v1/hcm/batch-sync
X-HCM-Signature: <hmac-sha256-hex>
```

**Request:**
```json
{
  "syncId": "batch_20260424_001",
  "generatedAt": "2026-04-24T06:00:00Z",
  "records": [
    { "employeeId": "emp_123", "locationId": "loc_nyc", "leaveType": "VACATION", "balance": 12.0 }
  ]
}
```

**202 Accepted:** `{ "syncLogId": "sync_xyz", "status": "PROCESSING", "recordsReceived": 1500 }`

---

### 6.9 Receive HCM Real-Time Balance Webhook

```
POST /api/v1/hcm/balance-update
X-HCM-Signature: <hmac-sha256-hex>
```

**Request:**
```json
{
  "eventId": "evt_hcm_789",
  "timestamp": 1745490000,
  "eventType": "BALANCE_UPDATED",
  "employeeId": "emp_123",
  "locationId": "loc_nyc",
  "leaveType": "VACATION",
  "newBalance": 12.0,
  "reason": "WORK_ANNIVERSARY",
  "effectiveAt": "2026-04-24T00:00:00Z"
}
```

**200 OK:** `{ "acknowledged": true }` — `eventId` checked for duplicates; stale events acknowledged but not applied.

---

## 7. Core Workflows

### 7.1 Request Submission

```
POST /time-off/requests
    │
[1] DTO validation (dates, leaveType, days bounds)
    ├── fail → 400
    │
[2] Resolve idempotency key; check for existing record
    ├── duplicate → 200 with original response
    │
[3] Load LeaveBalance from local cache
    available = hcm_balance − SUM(PENDING + HCM_DEDUCT_PENDING days)
    ├── no local record → skip to [4]  (first-time employee)
    ├── available < daysRequested → 422 INSUFFICIENT_BALANCE
    │
[4] Call HCM GET balance
    ├── HCM balance < daysRequested → update local cache → 422 HCM_BALANCE_MISMATCH
    ├── HCM unavailable → 503  (do NOT persist)
    │
[5] BEGIN TRANSACTION
    ├── Date overlap check (PENDING / APPROVED / HCM_DEDUCT_PENDING rows)
    │   → overlap → ROLLBACK → 409 OVERLAPPING_REQUEST
    ├── Re-compute available (serialized — closes concurrent-request race window)
    │   → available < daysRequested → ROLLBACK → 422 INSUFFICIENT_BALANCE
    ├── INSERT time_off_requests (status=PENDING, hcm_committed=0)
    │   → UNIQUE conflict on idempotency_key → ROLLBACK, return existing record
    └── COMMIT
    │
[6] 201 Created with request + balance snapshot
```

---

### 7.2 Manager Approval

```
PATCH /requests/:id/approve
    │
[1] Load request; assert status = PENDING
    ├── not PENDING → 409 INVALID_STATE_TRANSITION
    │
[2] Call HCM deduct API
    ├── 2xx → [3]
    ├── INSUFFICIENT_BALANCE → refresh local cache → 422 HCM_BALANCE_MISMATCH (request stays PENDING)
    ├── unavailable → UPDATE status = HCM_DEDUCT_PENDING → 202
    │
[3] BEGIN TRANSACTION
    ├── UPDATE status=APPROVED, hcm_committed=1, hcm_transaction_id=<ref>
    └── COMMIT
    │
[4] 200 OK
```

---

### 7.3 HCM Real-Time Webhook

```
POST /hcm/balance-update
    │
[1] Verify HMAC-SHA256 signature; validate |now − timestamp| ≤ 300s
    ├── fail → 401
    │
[2] Check eventId for duplicate
    ├── seen → 200 (idempotent)
    │
[3] Check effectiveAt vs. last_synced_at − 30s  (skew-tolerant staleness guard)
    ├── stale → 200 (discard)
    │
[4] BEGIN TRANSACTION
    │   UPSERT leave_balances SET hcm_balance=newBalance, last_synced_at=now(), version++
    └── COMMIT
    │
[5] Post-update: compute available; if < 0 → log BALANCE_DEFICIT_WARNING
    │
[6] 200 acknowledged
```

---

### 7.4 Batch Sync

```
POST /hcm/batch-sync
    │
[1] Verify HMAC signature
    │
[2] SHA-256 hash of body; check hcm_sync_logs
    ├── duplicate hash → 202 "already processed"
    │
[3] INSERT hcm_sync_logs (status=PROCESSING)
    │
[4] Deduplicate records by (employeeId, locationId, leaveType); keep last occurrence
    Log HCM_BATCH_DUPLICATE_RECORD for any conflicts
    │
[5] Process in chunks of 500:
    │   BEGIN TRANSACTION
    │   UPSERT leave_balances (hcm_balance, last_synced_at, version++)
    │   COMMIT
    │   Post-chunk: scan for deficits → log BALANCE_DEFICIT_WARNING
    │
[6] UPDATE hcm_sync_logs (status=COMPLETED, records_updated=N)
    │
[7] 202 with syncLogId
```

Each 500-record chunk commits independently to avoid a long-held write lock on SQLite.

---

### 7.5 Background Retry Job (`@Cron('*/5 * * * *')`)

Processes `HCM_DEDUCT_PENDING` and `CANCELLATION_CREDIT_PENDING` rows:

| HCM Response | Action |
|--------------|--------|
| 2xx (deduct) | `status=APPROVED`, `hcm_committed=1` |
| 2xx (credit) | `status=CANCELLED`; refresh local `hcm_balance` |
| `INSUFFICIENT_BALANCE` | `status=PENDING` (return to manager queue) |
| Unavailable | `retry_count++`; if > 10 → `status=RETRY_EXHAUSTED`, alert ops |
| 400 / invalid | `status=REJECTED` |

---

## 8. Consistency & Sync Strategy

### Balance Model

| Value | Owner | Definition |
|-------|-------|------------|
| `hcm_balance` | HCM (cached locally) | Last confirmed committed balance from HCM |
| `pending_days` | ExampleHR | `SUM(days_requested WHERE status IN ('PENDING', 'HCM_DEDUCT_PENDING'))` |
| `available_balance` | Computed | `hcm_balance − pending_days` — never stored |

### HCM Call Policy

| Operation | Calls HCM? | Reason |
|-----------|-----------|--------|
| Read balance | No (cache) | ≤30 min staleness is acceptable |
| Submit request | Yes (read) | Prevents accepting requests against stale balances |
| Approve request | Yes (deduct) | Actual balance deduction happens here |
| Reject request | No | No balance change |
| Cancel APPROVED request | Yes (credit) | Reversal of committed deduction |
| Admin manual sync | Yes | Explicit cache invalidation |

### Balance Mismatch Handling

| Scenario | Action |
|----------|--------|
| HCM balance > local cache | Update cache; request proceeds |
| HCM balance < local cache | Update cache; re-evaluate pending requests |
| Balance decrease creates deficit (pending > new hcm_balance) | Log `BALANCE_DEFICIT_WARNING`; do NOT auto-cancel — HCM will reject the deduction at approval |

### Staleness Policy

- Cache is **fresh** for 30 minutes after `last_synced_at`; `isStale: true` returned beyond that.
- Background job refreshes balances for employees with active pending requests every 15 minutes.
- `?refresh=true` on the balance endpoint forces a live HCM fetch.

---

## 9. Error Handling & Resilience

### HCM Client Retry Policy

| Condition | Behavior |
|-----------|----------|
| Network error / timeout | Retry ×3 with exponential backoff: 500ms → 1s → 2s |
| HTTP 429 | Wait `Retry-After` (default 2s), then retry |
| HTTP 502, 503, 504 | Retry (transient) |
| HTTP 400, 401, 403 | No retry |
| HTTP 422 | No retry (HCM validation error — deterministic) |
| Max retries exceeded | Surface as `HCM_UNAVAILABLE` |

Max wall-clock wait before surfacing error: ~4 seconds. No circuit breaker in v1 — we lack empirical failure-rate data to set meaningful thresholds; add one if HCM instability recurs with measured frequency.

### HCM Down — Behavior by Operation

| Operation | Behavior |
|-----------|----------|
| Submit | Reject 503 — unverifiable requests are not accepted |
| Approve | `HCM_DEDUCT_PENDING`; retry job resolves it |
| Get balance | Serve cache with `isStale: true` |
| Cancel APPROVED | `CANCELLATION_CREDIT_PENDING`; retry job resolves it |

### Partial Failure Recovery

**HCM deduction succeeds, local DB write fails:** Log critical error with the HCM transaction ID. Admin reconciliation endpoint (`POST /admin/reconcile/:employeeId/:locationId`) re-fetches HCM state and repairs the local record. Covered by integration test using DB write failure injection.

**Local DB write succeeds, HCM call fails (approval):** Handled by `HCM_DEDUCT_PENDING` + retry job.

---

## 10. Edge Cases

### 10.1 Duplicate Requests

Client retries on timeout. The `UNIQUE` constraint on `idempotency_key` catches the duplicate at the DB level — no application-layer check required. On conflict: load the existing record, return `200 OK` with the original body.

If no `Idempotency-Key` header is provided, the key is derived as `SHA256(employeeId:locationId:leaveType:startDate:endDate)`, making same-content submissions naturally idempotent.

### 10.2 Concurrent Requests

Two requests simultaneously passing the HCM check (balance = 5, both requesting 3 days). SQLite serializes writes — the second transaction re-computes `5 − 3 − 3 = −1 < 0` after the first has committed its pending row, and rolls back with `INSUFFICIENT_BALANCE`. On PostgreSQL, replace the in-transaction re-check with `SELECT FOR UPDATE` on the `leave_balances` row; the logic is identical.

### 10.3 Negative Balance After HCM Update

HCM batch reduces balance to 2; employee has 3 pending days → `available = −1`. Do NOT auto-cancel — that is a business decision with employee impact. Log `BALANCE_DEFICIT_WARNING` with affected request IDs. The manager's approval attempt will naturally fail at the HCM deduct call, surfacing a clear error.

### 10.4 HCM Extended Downtime

1. Submissions rejected with 503.
2. Approvals queued as `HCM_DEDUCT_PENDING`; retry job runs every 5 minutes.
3. Balance reads served from cache with `isStale: true`.
4. On recovery: retry job drains the queue; a manual or scheduled sync refreshes stale balances.
5. `retry_count > 10` → `RETRY_EXHAUSTED`; ops alert fired.

### 10.5 Out-of-Order Webhook Delivery

HCM fires T1 (balance=10) then T2 (balance=8); T2 arrives first. Discard an event if `effectiveAt < last_synced_at − 30s`. The 30-second tolerance absorbs clock skew between HCM and our system; a narrower window risks discarding legitimate events from skewed clocks.

### 10.6 Overlapping Date Range

Inside the submission transaction:

```sql
SELECT 1 FROM time_off_requests
WHERE employee_id = ? AND location_id = ? AND leave_type = ?
  AND status IN ('PENDING', 'APPROVED', 'HCM_DEDUCT_PENDING')
  AND start_date <= :newEndDate AND end_date >= :newStartDate
```

Any result → `409 OVERLAPPING_REQUEST`.

### 10.7 First-Time Employee (No Local Balance Record)

No `leave_balances` row exists. Skip the local pre-flight check (step 3 in §7.1) and proceed directly to the HCM call. If HCM confirms sufficient balance, the UPSERT inside the submission transaction creates the row.

### 10.8 Floating-Point Precision

`2.5 + 2.5` in IEEE 754 can evaluate as `5.000000000000001`, failing a strict `>=` comparison. Mitigation: all balance comparisons use an epsilon tolerance of `0.001`; `days_requested` inputs are rounded to the nearest `0.5` before storage.

### 10.9 Cancellation of Approved Request When HCM Credit Fails

Mark request as `CANCELLATION_CREDIT_PENDING` and return `202`. The retry job calls the HCM credit API; on success, transitions to `CANCELLED` and refreshes `hcm_balance`. If exhausted, escalate to ops — the balance will self-correct on the next batch sync.

### 10.10 Concurrent Batch Sync and Request Submission

Each 500-record batch chunk commits atomically. A `leave_balances` row is either fully updated by a chunk or unchanged — there is no partial-row state. If a batch chunk and a submission write the same balance row simultaneously, SQLite serialization resolves it: the submission's in-transaction re-check (step 5, §7.1) reads the committed winner.

### 10.11 Duplicate Records Within a Batch

Deduplicate by `(employeeId, locationId, leaveType)` before writing; keep the last occurrence. Log `HCM_BATCH_DUPLICATE_RECORD` for investigation. Do not fail the batch.

---

## 11. Security Considerations

### Authentication & Authorization

- JWTs validated at the API gateway; this service consumes them.
- `employeeId` in request body must match JWT `sub`; mismatch → `403`.
- Manager endpoints (`/approve`, `/reject`) require `role: MANAGER`; service also asserts `managerId ≠ request.employeeId`.
- `/admin/reconcile` requires `role: ADMIN` or a dedicated service-to-service API key — the `MANAGER` role is insufficient.
- HCM endpoints (`/hcm/*`) use HMAC-SHA256 signature verification; `HCM_WEBHOOK_SECRET` is env-var only, never logged or returned in error responses.

### IDOR Prevention

UUIDs are an inconvenience, not a security control. Authorization is enforced per endpoint:

| Endpoint | Rule |
|----------|------|
| `GET /requests/:id` | Caller is the request's `employee_id`, or has `role: MANAGER` |
| `PATCH /requests/:id/approve` | `role: MANAGER` |
| `DELETE /requests/:id` | Caller is the request's `employee_id` |
| `GET /balances/:employeeId/*` | JWT `sub` = `employeeId`, or `role: MANAGER` |

Unauthorized access to another user's resource returns `404`, not `403`, to prevent enumeration.

### HCM Webhook Security

**Signature:**
```
expectedSig = HMAC-SHA256(rawBody, HCM_WEBHOOK_SECRET)
actualSig   = X-HCM-Signature header
```
Compared via `crypto.timingSafeEqual`. Missing or invalid → `401`.

**Replay prevention:** Reject if `|now − event.timestamp| > 300s`. Combined with `eventId` deduplication, the replay window is at most 5 minutes.

**Payload size:** Enforce max 50 MB on `/hcm/batch-sync` via NestJS body parser `limit`. Oversized payloads receive `413` before any processing.

**Secret rotation:** Support `HCM_WEBHOOK_SECRET` (current) and `HCM_WEBHOOK_SECRET_PREV` simultaneously. Try current secret first; fall back to previous. Remove `_PREV` once all in-flight webhooks drain.

### Input Validation

All bodies validated via `class-validator` DTOs before reaching service logic:

- `daysRequested` ∈ (0, 90] — caps abuse; rounded to nearest 0.5.
- Dates: ISO 8601, range `[today, today + 2 years]`.
- `employeeId`, `locationId`: alphanumeric, max 64 chars (TypeORM parameterized queries are the SQL injection defense; this is defense-in-depth).
- Free-text fields: max 1000 chars, HTML stripped (XSS prevention for downstream renderers).
- Batch `records` array: max 100,000 elements validated before chunk processing begins.

### Data Integrity

- DB `CHECK` constraints are the final guard: no negative balances, no zero-day requests, no invalid status values, regardless of application behavior.
- All DB writes through TypeORM repositories — no string-concatenated SQL.
- State transitions (`PENDING → APPROVED`, `APPROVED → CANCELLED`) run inside explicit transactions; unexpected pre-condition → rollback + alert log.

### Sensitive Data

- Balance figures must not appear in client-facing error messages; reference the condition code only.
- Log lines containing balance data must be tagged for data-retention policy scrubbing.
- `HCM_WEBHOOK_SECRET` must never appear in any log output, including DEBUG-level config dumps.

### Rate Limiting (API Gateway)

| Endpoint | Limit |
|----------|-------|
| `POST /time-off/requests` | 10 req/employee/min |
| `POST /hcm/batch-sync` | 2 req/min from HCM source IP |
| `POST /hcm/balance-update` | 100 events/min |

---

## 12. Testing Strategy

Unit tests verify isolated logic. Integration tests verify end-to-end correctness through the full stack (controller → service → repository → SQLite). The mock HCM is a real Express HTTP server — not an in-process stub — so integration tests exercise the actual `HcmClient` including retry logic, backoff timing, and HMAC verification.

### Test Structure

```
test/
├── unit/
│   ├── balance.service.spec.ts
│   ├── timeoff.service.spec.ts
│   ├── hcm.client.spec.ts
│   └── hcm-sync.service.spec.ts
├── integration/
│   ├── request-submission.spec.ts
│   ├── approval-flow.spec.ts
│   ├── rejection-cancellation.spec.ts
│   ├── balance-read.spec.ts
│   ├── hcm-webhook.spec.ts
│   ├── batch-sync.spec.ts
│   ├── retry-job.spec.ts
│   └── concurrency.spec.ts
└── mock-hcm/
    ├── server.ts           ← Express server, started before suite
    ├── handlers.ts         ← Route logic
    ├── state.ts            ← In-memory balance state
    └── control.routes.ts   ← /test/seed · /test/inject-error · /test/reset
```

**Mock HCM control API:**
```typescript
await mockHcm.seed({ employeeId: 'emp_1', locationId: 'loc_nyc', leaveType: 'VACATION', balance: 10 });
await mockHcm.injectError({ nextN: 2, statusCode: 503 });
await mockHcm.triggerBalanceChange({ employeeId: 'emp_1', newBalance: 12, reason: 'WORK_ANNIVERSARY' });
await mockHcm.reset();
```

The mock signs all outbound webhook calls with the test HMAC secret, exercising the full signature verification path.

---

### Unit Tests

| File | Test | Expected |
|------|------|----------|
| `balance.service` | `computeAvailable` — no pending requests | Returns `hcm_balance` |
| `balance.service` | `computeAvailable` — 3 pending days | Returns `hcm_balance − 3` |
| `balance.service` | `isStale` — 20 min old | `false` |
| `balance.service` | `isStale` — 35 min old | `true` |
| `timeoff.service` | `deriveIdempotencyKey` — same inputs | Deterministic output |
| `hcm.client` | 503 × 3 | Throws after 3 retries |
| `hcm.client` | 503 × 2, then 200 | Succeeds, retried twice |
| `hcm.client` | 400 | Throws immediately |
| `hcm.client` | 422 | Throws immediately |
| `hcm.client` | 429 with `Retry-After: 1` | Waits 1s before retry |
| `hcm-sync.service` | 1500 records | Split into 3 chunks of 500 |
| `hcm-sync.service` | `effectiveAt` < `last_synced_at − 30s` | No DB write |

---

### Integration Tests

**`request-submission.spec.ts`**

| Test Case | HCM State | Expected |
|-----------|-----------|----------|
| Valid, sufficient balance | balance=10, requesting 5 | 201, PENDING |
| Balance exactly meets request | balance=5, requesting 5 | 201, PENDING |
| First-time employee (no local record) | HCM balance=8, requesting 5 | 201; `leave_balances` row created |
| Local cache stale; HCM has more | local=2, HCM=8, requesting 5 | 201; local cache updated |
| Insufficient (local) | balance=3, requesting 5 | 422 INSUFFICIENT_BALANCE |
| Insufficient (HCM) | local=10, HCM=3, requesting 5 | 422 HCM_BALANCE_MISMATCH; cache updated |
| HCM unavailable | 503 × 3 | 503 HCM_UNAVAILABLE; no DB row created |
| Duplicate (explicit key) | Same request twice | 200 on second; same record returned |
| Duplicate (derived key) | Same content, no header | 200 on second; same record returned |
| Overlapping date range | PENDING May 1–5; new May 3–7 | 409 OVERLAPPING_REQUEST |
| `startDate` in past | — | 400 DATE_IN_PAST |
| `daysRequested = 0` | — | 400 |
| `daysRequested = 91` | — | 400 |
| Float precision (2.5 + 2.5, balance=5) | balance=5 | 201 (epsilon tolerance) |

**`approval-flow.spec.ts`**

| Test Case | Setup | Expected |
|-----------|-------|----------|
| Successful approval | PENDING; HCM accepts | 200, APPROVED, `hcm_committed=true` |
| Balance dropped post-submission | PENDING; HCM now has 0 | 422 HCM_BALANCE_MISMATCH; stays PENDING |
| HCM down during approval | 503 × 3 | 202, HCM_DEDUCT_PENDING |
| Already approved | status=APPROVED | 409 INVALID_STATE_TRANSITION |
| Non-existent ID | — | 404 |
| Reject | PENDING | 200, REJECTED; no HCM call made |
| Cancel PENDING | PENDING | 200, CANCELLED; no HCM call |
| Cancel APPROVED (committed) | APPROVED, hcm_committed=1 | 200, CANCELLED; HCM credit call made |
| Cancel APPROVED, HCM credit fails | APPROVED; HCM 503 | 202, CANCELLATION_CREDIT_PENDING |

**`hcm-webhook.spec.ts`**

| Test Case | Expected |
|-----------|----------|
| Balance increase (anniversary) | `hcm_balance` updated; `available` increases |
| Balance decrease, no pending | `hcm_balance` updated |
| Balance decrease creates deficit | `hcm_balance` updated; `BALANCE_DEFICIT_WARNING` logged |
| Invalid HMAC | 401; no DB write |
| Timestamp > 300s old | 401; no DB write |
| Duplicate `eventId` | 200; no DB write |
| Out-of-order (`effectiveAt < last_synced_at − 30s`) | 200; event discarded |

**`batch-sync.spec.ts`**

| Test Case | Expected |
|-----------|----------|
| 100 records | All balances updated |
| Decreases creating deficits | Deficits logged per employee |
| Duplicate payload (same hash) | 202 "already processed"; no writes |
| 1500 records | 3 commits of 500; all updated |
| Duplicate records within payload | Last occurrence applied; warning logged |
| Invalid HMAC | 401; no processing |

**`retry-job.spec.ts`**

| Test Case | Expected |
|-----------|----------|
| HCM recovers; `HCM_DEDUCT_PENDING` | → APPROVED |
| HCM `INSUFFICIENT_BALANCE` on retry | → PENDING |
| HCM down after 10 retries | → RETRY_EXHAUSTED; alert fired |
| HCM 400 on retry | → REJECTED |
| HCM recovers; `CANCELLATION_CREDIT_PENDING` | → CANCELLED; `hcm_balance` refreshed |

**`concurrency.spec.ts`**

| Test Case | Expected |
|-----------|----------|
| 2 simultaneous requests, balance=5, each 3 days | Exactly one 201, one 422 |
| 3 simultaneous requests, balance=10, each 4 days | Exactly two 201, one 422 |
| Concurrent approve + cancel on same request | Exactly one succeeds; other → 409 |

### Coverage Targets

| Layer | Target |
|-------|--------|
| Unit: line coverage (services, clients) | ≥ 90% |
| Integration: all documented happy paths | 100% |
| Integration: all documented error paths | 100% |
| Critical paths (submit, approve, batch sync): branch coverage | 100% |

---

## 13. Tradeoffs & Alternatives

### 13.1 HCM Call on Writes Only vs. Reads Too vs. Never

| Option | Writes | Reads | Verdict |
|--------|--------|-------|---------|
| **A (chosen)** | Always call HCM | Cache (≤30 min stale) | Reads tolerate staleness; writes require correctness |
| B | Always call HCM | Always call HCM | UI latency and availability are tied to HCM uptime |
| C | Never call HCM | Cache | Cannot prevent over-allocation from external HCM changes |

---

### 13.2 When to Deduct from HCM: At Submission vs. At Approval

**Option A (chosen):** Read-only HCM call at submission; deduct at approval.

- Pros: No reversal path on rejection. HCM writes only happen on confirmed business decisions. Our `pending_days` count compensates locally for the submission-to-approval window.
- Cons: HCM's balance does not reflect ExampleHR's in-flight requests; another HCM-connected system could see stale availability.

**Option B:** Deduct at submission; credit back on rejection/cancellation.

- Pros: HCM always reflects true available balance.
- Cons: Every submission becomes a write against HCM. Failed credits leave the balance permanently over-deducted until manual correction. Most HCM systems do not support high-frequency reversals cleanly.

**Verdict:** Option A — the failure mode of a failed reversal (permanent balance corruption) is worse than the cross-system consistency gap, which is bounded and self-correcting via `pending_days`.

---

### 13.3 Strong vs. Eventual Consistency on Submission

**Option A (chosen):** Synchronous HCM call on submit; stale cache on reads.

**Option B:** Accept locally, reconcile asynchronously.
- Employees receive a confirmation that may later be invalidated — the worst UX in a leave management system.

**Option C:** Distributed 2PC with HCM.
- Workday/SAP do not expose 2PC APIs; impractical.

**Verdict:** The synchronous HCM call on writes is the right cost for correctness on a high-consequence operation.

---

### 13.4 Concurrency Control

**Option A (chosen):** Re-verify inside SQLite write transaction (serialized writes close the race window natively).

**Option B:** Optimistic CAS on `version` field — adds complexity without benefit; SQLite already serializes.

**Option C:** Application-level mutex per employee — breaks at >1 process; doesn't survive restarts.

**Verdict:** Option A on SQLite; swap to `SELECT FOR UPDATE` on PostgreSQL — logic is identical.

---

### 13.5 Batch Processing: Synchronous Chunks vs. Async Queue

**Option A (chosen):** Chunked transactions (500 records) within the HTTP request lifecycle.

**Option B:** Redis + BullMQ — adds infrastructure dependency not yet warranted by scale.

**Verdict:** Move to a queue when batch sizes or processing time make it necessary; not before.

---

### 13.6 HCM Updates: Webhooks vs. Polling

**Option A (chosen):** Accept inbound webhooks from HCM.
- Near-real-time; no wasted HCM calls.
- Missed webhooks are reconciled by the batch sync endpoint, making correctness independent of webhook reliability.

**Option B:** Poll HCM on a schedule.
- Full control of delivery, but scales poorly — high HCM API traffic, most polls return no change.

**Verdict:** Webhooks are an optimization; correctness is guaranteed by the batch sync safety net.

---

### 13.7 Fractional Days: Float vs. Integer Half-Days

**Option A (chosen):** `REAL` storage with epsilon tolerance (`0.001`) and input rounding to nearest 0.5.

**Option B:** Integer half-day units (5.0 days stored as `10`).
- Exact arithmetic, but requires a translation layer at all API boundaries; breaks if quarter-day granularity is ever needed.

**Verdict:** Float with epsilon is simpler and more readable; revisit if quarter-day precision becomes a requirement.

---

## 14. Future Improvements

### 14.1 Database Migration (SQLite → PostgreSQL)

SQLite's global write serialization is sufficient for a single instance. PostgreSQL adds row-level locking (`SELECT FOR UPDATE`), concurrent write throughput, and connection pooling. The migration path is straightforward: TypeORM manages schema migrations, and the only behavioral change is replacing the in-transaction re-check with `SELECT FOR UPDATE` on the `leave_balances` row.

### 14.2 Balance Projection

Project an employee's balance over time: "given pending requests and scheduled accruals, your balance on date X will be Y." Requires date-aware computation and accrual schedules from HCM; deferred to v2.

### 14.3 Event-Driven HCM Integration

If HCM publishes to an event bus (Kafka, SNS/SQS), subscribing provides at-least-once delivery with offset tracking and better backpressure. Only justified if webhook reliability proves operationally insufficient — the batch sync safety net makes this an optimization, not a correctness requirement.

### 14.4 Multi-Tenancy

Add `tenant_id` as the leading column in all tables and indexes; derive it from the JWT claims at the repository layer.

### 14.5 Observability

Enrich all log lines with `{ requestId, employeeId, locationId, hcmTransactionId, durationMs }`.

Key alerts:

| Metric | Threshold |
|--------|-----------|
| `hcm_call_latency_p99` | > 2s |
| `hcm_error_rate` | > 5% over 5 min |
| `hcm_deduct_pending_queue_depth` | > 50 |
| `batch_sync_lag_minutes` | > 60 since last success |
| `balance_deficit_warnings_total` | > 0 |

---

*TRD v1.1 · Time-Off Microservice · ExampleHR*
