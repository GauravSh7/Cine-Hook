# Cancellation / Refunds — module checkpoint

Date: 2026-10-07. Implemented; full verification passed; task test services stopped.
STOP before UI integration. No commit/push/secrets or normal user database changes.
The historical foundation record is unchanged.

## 1. Inspection and approved policy

Booking already supported CANCELLED; the fourth SQL migration already atomically
removed ConfirmedSeat allocations. Paid cancellation policy/API, refund provider
methods and refund evidence/recovery were absent. Payment had PENDING/SUCCESS/
FAILED; the fifth migration intentionally preserved captured SUCCESS. Availability
excluded initially allocated seats from Redis inspection, unsafe after cancellation.

The user explicitly resolved the policy gate:

- Owner-only CONFIRMED cancellation strictly before Show.startsAt using trusted
  PostgreSQL UTC time. Equality/later rejects; no advance cutoff was invented.
- Refund 100% of trusted captured amounts. No cancellation fee/deduction.
- Paid-but-unfulfilled compensation is full regardless of show time. Never revive
  a failed booking, reacquire seats or extend its hold.
- Cancellation is a transition, not deletion. Preserve BookingSeat snapshots and
  Payment/captured evidence. Allocation release is atomic with cancellation.
- Refund uncertainty leaves CANCELLED/REFUND_PENDING, not CONFIRMED again.
  Only verified provider evidence completes the return.

An already-CANCELLED owner's repeat request remains idempotent after show start;
it is not a new cancellation. Unpaid hold release stays the existing separate
DELETE hold API, producing FAILED/HOLD_RELEASED rather than paid cancellation.

## 2. Exact file inventory

Paths are repository-relative. 13 created, 19 changed. This module record was
created during preceding inspection and updated now. Generated client/build
artifacts remain ignored. No new runtime dependencies or frontend source edits.

### Created (13)

| File | Responsibility |
| --- | --- |
| docs/superpowers/plans/2026-10-07-cancellation-refunds.md | Execution/evidence/review ledger |
| backend/prisma/migrations/20261007000600_cancellation_refunds/migration.sql | Additive return states, persistence and native guards |
| backend/src/modules/refunds/refund.types.ts | Store/coordinator/record contracts |
| backend/src/modules/refunds/refund.repository.ts | Shared transactions, obligations, attempts, evidence and fair recovery selection |
| backend/src/modules/refunds/refund.service.ts | Cancellation/refund orchestration and provider recovery |
| backend/src/modules/refunds/refund.controller.ts | HTTP only |
| backend/src/modules/refunds/refund.routes.ts | Routes, existing JWT/current user/ADMIN checks and validation |
| backend/tests/booking-cancellation.test.ts | Booking eligibility/policy |
| backend/tests/razorpay-refunds.test.ts | Actual adapter, signatures and financial bindings |
| backend/tests/refunds.test.ts | Composed service/HTTP unit tests |
| backend/tests/helpers/refunds.ts | Test-only persistence/provider I/O replacement |
| backend/tests/refunds-database.integration.mjs | Actual PostgreSQL native guards |
| backend/tests/refunds.integration.mjs | Actual PostgreSQL/Redis/HTTP/provider-adapter races/recovery |

### Changed (19)

| File | Change |
| --- | --- |
| backend/prisma/schema.prisma | Refund/RefundAttempt, return states, event refund ID and reconciliation resolution |
| backend/src/modules/booking/booking.types.ts | Scoped decision supports CANCELLED |
| backend/src/modules/booking/booking.service.ts | Owner/cutoff policy; inspect all physical seats |
| backend/src/modules/payments/payment-provider.ts | Normalized create/fetch/refund-webhook contracts |
| backend/src/modules/payments/razorpay.provider.ts | Idempotent refund HTTPS and raw refund events |
| backend/src/modules/payments/payment.types.ts | Refund event identity and reconciliation resolvedAt |
| backend/src/modules/payments/payment.repository.ts | Preserve capture/return progress; distinct extra-capture obligations |
| backend/src/modules/payments/payment.service.ts | Refund dispatch/recovery; known refunded-source polling without fulfillment |
| backend/src/modules/payments/create-payments.ts | Shared provider and RefundService/Repository assembly |
| backend/src/app.ts | Mount refund routes |
| backend/package.json | Include new live suites |
| .github/workflows/ci.yml | Disposable refund database URL |
| backend/tests/helpers/booking.ts | Test-only cancellation allocation release |
| backend/tests/helpers/payments.ts | Test-only capture/return preservation |
| backend/tests/razorpay-provider.test.ts | Unsupported-event fixture uses a still-unsupported event |
| backend/tests/payments-database.integration.mjs | Historical paid cancellation obeys new invariant; exact fixture cleanup |
| docs/cancellation-refunds.md | This checkpoint |
| docs/implementation-progress.md | Current ledger/evidence |
| README.md | APIs, recovery and checkpoint |

Existing startup/foundation config/error middleware is reused; server.ts does not
need changing. No environment-variable/dependency/lockfile changes were needed.
Previous five migrations were not rewritten.

## 3. APIs and exact request flows

| Endpoint | Access/input | Result |
| --- | --- | --- |
| POST /api/bookings/:id/cancel | Owner JWT, UUID, body {} | 200 returned; 202 durable refund pending |
| POST /api/bookings/:id/refund/retry | Owner JWT, UUID, body {} | Retry/poll existing obligations; 200/202 |
| GET /api/bookings/:id/refunds | Owner JWT, UUID | Persisted booking/payment/refund/attempt view |
| POST /api/admin/refunds/reconcile | JWT + current DB ADMIN, body {} | { examined }, at most 20 payments |
| POST /api/webhooks/razorpay | Existing raw body + signature/event headers | refund.created/processed/failed evidence |

Financial routes use Cache-Control: no-store. Unknown fields and browser amount/
status/success flags are rejected. Foreign history is safe 404, missing/invalid
JWT 401, non-current-ADMIN 403. Cutoff rejection is 409 CANCELLATION_CLOSED;
wrong booking state 409 BOOKING_STATE. Existing safe error middleware also maps
native integrity/commit/lock conflicts; no raw provider details leak.

```text
Cancellation
Route -> JWT/current-user + UUID/strict {} -> RefundController
  -> RefundService.cancel -> RefundRepository.cancel (short READ COMMITTED)
       lock Booking -> Payment
       -> scoped BookingService.cancel -> BookingRepository -> Prisma -> Postgres
          owner + DB UTC cutoff -> CONFIRMED to CANCELLED
          native trigger releases ConfirmedSeat; preserves BookingSeat
       persist full captured-source Refund + reconciliation
       Payment SUCCESS -> REFUND_PENDING
     COMMIT: transition, release and obligation all succeed or all roll back
  -> RefundService.reconcile -> persist/reuse RefundAttempt -> COMMIT
  -> PaymentProvider.createRefund/fetchRefund -> Razorpay (NO DB transaction)
  -> RefundRepository.record (short evidence transaction)
       source/amount/currency/receipt/provider ID/event bindings
       processed proof -> Refund REFUNDED
       all required captured sources returned -> Payment REFUNDED
  -> Controller 200/202 persisted view

Webhook
raw middleware -> PaymentController -> PaymentService
  -> RazorpayProvider: HMAC exact bytes BEFORE JSON interpretation
  -> RefundService.webhook -> reserved receipt/provider ID lookup
  -> validate full binding -> transactional attempt/refund/payment/event update
  -> 200; identical repeated delivery has no extra financial effect

Recovery
owner retry OR current ADMIN bounded batch -> RefundService.reconcile
  -> durable candidates/attempts -> provider outside transaction
  -> verified persisted progress; no Booking confirmation or Redis reacquisition
```

BookingService owns owner/cutoff/transition policy; RefundService coordinates
returns; PaymentService preserves financial capture/fulfillment history and
dispatches verified events. Repositories own I/O/transactions/native invariants.
Only the existing trusted Payment fulfillment path calls BookingService.confirm().
Refunds never call confirm. Old capture/failure replays cannot resurrect seats.
This preserves Route -> Middleware -> Controller -> Service -> Repository ->
Prisma -> PostgreSQL; provider/Redis are separate external boundaries.

## 4. Models and states

```text
Booking CONFIRMED -> CANCELLED                 owner, strictly before start
Booking FAILED   -> FAILED                    compensation, no revival

Payment SUCCESS -> REFUND_PENDING -> REFUNDED  all required captures returned
Refund  PENDING -> REFUNDED                    verified processed evidence
Attempt REQUESTED -> PENDING | FAILED | PROCESSED
        PENDING   -> FAILED | PROCESSED
        FAILED    -> PROCESSED                 newer processed evidence wins
        PROCESSED -> PROCESSED                 cannot regress

Payment 1:N PaymentEvidence (global provider payment ID)
Captured PaymentEvidence 1:0..1 Refund (one full source obligation)
Payment 1:N Refund
Refund 1:N RefundAttempt (ordered persisted retries)
Payment 1:0..1 PaymentReconciliation (resolvedAt preserves condition history)
```

Refund amount is immutable BigInt INR paise from captured PaymentEvidence already
bound to the trusted Booking/Payment quote. Source payment ID is unique; receipt/
provider refund IDs are globally unique; (refundId, sequence) is unique. A native
partial unique index permits one processed attempt per obligation.

The sixth additive migration extends capture guards while retaining original
provider IDs, capturedAt, bookingFinalizedAt and evidence. Runtime writers cannot
delete refunds/attempts. Aggregate REFUNDED requires full returned obligations/
processed attempts for every required source. Native guards reject refunding
legitimate primary funding while its ticket stays CONFIRMED and prevent cancelled
allocation revival. BookingSeat history/quotes remain unchanged.

A valid CONFIRMED ticket keeps primary funding Payment SUCCESS and seats while
only extra captures are refunded. CANCELLED/FAILED tickets require all captures
returned. A genuinely new extra capture after REFUNDED reopens REFUND_PENDING for
that source only; old replay never does. Earlier returned sources stay returned.
Capture truth is never rewritten as FAILED merely because fulfillment failed.

compensationRequired remains a historical fact; resolvedAt marks completion.
A distinct unfinished return clears resolvedAt again. Read both fields when
displaying unresolved work, not compensationRequired alone.

## 5. Concurrency, idempotency and retry

- Financial writers lock Booking -> Payment -> Refund. Cancellation/replays
  serialize; release and intent share one commit. PostgreSQL unique permanent
  Show/Seat allocation remains final authority during another user's rebooking.
- Cutoff uses PostgreSQL clock_timestamp, including native transition and deferred
  commit checks. Early requests delayed until/committed at start roll back.
- Persist attempt UUID/receipt before HTTP. UUID is X-Refund-Idempotency; unknown
  acknowledgement retries identical body/key, never blindly creates a new key.
  See [Razorpay normal refund idempotency](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent).
- Known pending refund is fetched, not recreated. Advance only after fresh
  provider-confirmed failure and serialized local recheck. Concurrent retries
  reuse one next attempt. Processed webhook before reservation suppresses it.
- PROCESSED dominates stale created/failed evidence. Webhook-before-HTTP-attach
  binds reserved receipt. Event ID plus digest/type/payment/refund identity
  prevents conflicting reuse. Signed amount/currency/source/receipt all match.
- refund.created may already contain processed state; accepted evidence is
  status-specific and fully bound. See [Razorpay refund events](https://razorpay.com/docs/webhooks/refunds).
- ADMIN batches durably rotate examined Payment.updatedAt using DB time before
  HTTP, locking Booking first with SKIP LOCKED. Persistently pending items cannot
  indefinitely hide later obligations. This is scheduling metadata, not a money
  claim/lease; persisted attempt/provider IDs still protect concurrent requests.
- Provider HTTP never runs in a DB transaction; integration instrumentation checks.

Provider terminal-state/idempotency behavior is an external contract, not a
distributed transaction. If a provider contradicts its authoritative failed
result after a new attempt was already dispatched, our DB cannot atomically
undo that external call. Guards preserve evidence/refuse two processed attempts;
such contradictory evidence requires operator reconciliation. No claim of
mathematically exactly-once money delivery across arbitrary provider inconsistency.

## 6. Availability fix

Previously, an initially BOOKED seat skipped Redis inspection. If cancelled/
reheld during the read, the final PG reread could expose it as AVAILABLE.
BookingService now inspects ALL physical seats, then rereads allocations. The
barrier-driven live test cancels/reholds that seat and requires LOCKED.

Availability remains an advisory cross-store snapshot, not a reservation: holds
can change afterward. Actual writes still recheck Redis ownership/expiry and
unique PG allocation. No physical Seat status, local lock fallback, TTL change,
implicit extension or new Redis concurrency algorithm.

## 7. Compensation, recovery and boundaries

After durable capture and trusted final FAILED/unfulfilled disposition, refunds
create/reconcile full source obligations. Owner retry/ADMIN batches also recover
earlier successful-payment compensation. Show time never blocks compensation.
Another user's hold/allocation is untouched. Transient unfinished fulfillment
still uses the Payments module's retry boundary until a final disposition.

Timeout/outage returns 202 with CANCELLED/REFUND_PENDING and safe attempt error
code. Poll GET refunds; retry owner endpoint or ADMIN batches after recovery.
Failed attempt evidence is retained; payment/obligation stay pending until
processed proof. No background scheduler was added: operators must invoke
recovery regularly for unattended obligations.

Subscribe existing webhook URL to refund.created/refund.processed/refund.failed
in addition to payment events. Actual account setup, test-mode initiation,
internet delivery, retention and settlement need verification before deployment.
No real account credentials, provider money requests or charges were used.

Unknown external/manual/partial refunds are outside full-refund automation.
Unbound signed events are retained but do not cancel tickets/fabricate completion.
Fetched refunded primary payment state is accepted for a known local return flow
only by polling owned refund evidence; never fulfills a ticket. Unknown external
refunded payment state remains a safe reconciliation error. Operators must
inspect unsupported external actions, not blindly issue another refund.

## 8. Verification and review

Fresh checks: 362 unit tests (17 files), 68 live integration results (no skips),
2 smoke tests, typecheck/build, Prisma validate/generate and six-migration status,
frontend lint/build, and both audits (zero vulnerabilities). Identity-validated
task PostgreSQL/Redis were stopped, listeners closed; normal port5432 remained
running. Git/ignored-file/source whitespace checks passed, foundation SHA256
unchanged; HEAD remains 54ac39c and nothing was committed/pushed. Baseline:
278 unit tests. This module adds 84 (6 Booking policy, 63 actual provider, 15
composed refund unit/HTTP). Live suites use real PG/Redis and actual Razorpay
adapter on controlled HTTPS transport; business policy is not mocked.

RED-to-GREEN caught missing behavior/provider APIs, mutable provider input across
await, capture replay reversing refund progress, known returned-source polling,
ADMIN middleware wiring and recovery starvation. Independent review reproduced
the last with 21 pending obligations and approved durable fair rotation. A
barrier test also covers processed webhook between failed fetch and reservation.
Historical ADMIN recovery now allows multiple bounded batches with >20 fixtures,
still requiring the original attempt rather than another refund.

Native fixture cleanup bypasses triggers transaction-locally only for exact run
IDs in validated loopback *_test databases; runtime never bypasses guards.
No FLUSHDB/reset/drop/user-schema migration. Temporary cluster files remain
recoverable. Prisma/pg emits a concurrent-query deprecation warning; intentional
outages log safe codes only. CI/Docker, actual provider behavior, UI integration
and deployment hardening remain unverified.

Workflow influence: approved-policy planning, TDD, disjoint provider/schema work,
independent review and fresh verification shaped native guards and replay/recovery
regressions. User no-commit/existing-checkout/STOP instructions override generic
skill integration/worktree/continuation steps.

12 October follow-up adds unpaid checkout cancellation and atomic reverse-race
late-capture refunds. The existing paid cutoff/full-refund contract is unchanged;
details and targeted evidence are in checkout-cancellation-scrolling.md.
