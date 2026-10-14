# Cancellation / Refunds Implementation Plan

> **For agentic workers:** Use executing-plans and test-driven-development; disjoint provider/schema work may run in parallel under dispatching-parallel-agents. No commits/pushes.

**Goal:** Owner cancellation before show start, full refunds/compensation, durable provider-authoritative completion and safe replay/rebooking.

**Architecture:** BookingService owns cancellation eligibility. RefundService coordinates refund intent and provider HTTP outside transactions. RefundRepository owns short shared Booking/Payment/refund transactions. PaymentService preserves captured evidence and routes refund webhooks/reconciliation without resurrecting seats.

**Tech Stack:** Existing Express/TypeScript/Zod, Prisma/PostgreSQL, Redis and native HTTPS/crypto. No new dependencies.

**Spec:** docs/cancellation-refunds.md and the user's explicit v1 approval.

## Global constraints

- Owner only; CONFIRMED -> CANCELLED strictly before Show.startsAt using DB UTC time; repeated already-cancelled requests remain idempotent after cutoff.
- Full captured amount, no fee; failed/unfulfilled compensation is full regardless of show time and never revives/reacquires seats.
- Atomically cancel/release ConfirmedSeat/create refund obligations; retain BookingSeat, Payment and captured history.
- Payment SUCCESS -> REFUND_PENDING -> REFUNDED; failures stay pending. Extra capture after cancellation/refund creates a new compensation obligation, never a new ticket.
- No client amount/status, no provider HTTP inside DB transaction, no process-local durable state, no Redis dependence for paid cancellation.
- Same request attempt uses persisted UUID receipt and X-Refund-Idempotency key; retry unknown outcomes with identical body/key. Advance attempt only after current provider confirms previous attempt failed.
- Preserve historical foundation, user files, old migrations and actual environment/secrets; existing checkout is explicitly authorized. STOP before UI.

## Review focus

- Cancellation boundary equality and expiry while waiting for DB locks/commit.
- Duplicate capture/failed/captured webhook replay after refund must not reset financial progress or allocate seats.
- Unknown provider acknowledgement plus webhook-before-attach must converge on one refund identity.
- Failed-refund retry racing processed webhook and concurrent retries must not produce two successful refund effects.
- Initially allocated seat cancelled/re-held during availability read must not look AVAILABLE due to missed Redis inspection.

## Task 1: Razorpay refund boundary (disjoint provider files)

Files: modify payments/payment-provider.ts and razorpay.provider.ts; create tests/razorpay-refunds.test.ts.
Interfaces: ProviderRefund {id,paymentId,amountPaise,currency,receipt:string|null,status:'pending'|'processed'|'failed'}; CreateProviderRefund {paymentId,amountPaise,currency,receipt,idempotencyKey}; provider createRefund(input), fetchRefund(id); ProviderWebhook adds refund?. Existing order/payment APIs unchanged.

- [x] RED: refund creation payload/header derived from literal trusted amount; same key/body retry; malformed IDs/amount/response rejected; fetched identity binding; exact signed refund.created/refund.processed/refund.failed bytes and status checked; provider timeout/409 safe.
- [x] GREEN: official normal refund idempotency endpoint; immutable request body, header X-Refund-Idempotency; receipt exact binding; bounded response/transport reused. Existing provider tests stay green.
- [x] Verify focused tests; root reviews source/security and merges interface consumers.

## Task 2: Additive financial persistence (disjoint schema/migration)

Files: modify schema.prisma; create migration 20261007000600_cancellation_refunds/migration.sql and tests/refunds-database.integration.mjs.
Models: RefundStatus {PENDING,REFUNDED}; RefundAttemptStatus {REQUESTED,PENDING,FAILED,PROCESSED}; Refund {id UUID, paymentId UUID, providerPaymentId unique FK PaymentEvidence, amountPaise BigInt,currency INR,reason varchar100,status,createdAt/updatedAt Tstz}; RefundAttempt {id UUID,refundId UUID,sequence int,receipt unique varchar40,providerRefundId nullable unique varchar100,status,lastErrorCode nullable varchar100,processedAt nullable Tstz,createdAt/updatedAt Tstz}; unique(refundId,sequence). Payment.refunds[], PaymentEvidence.refund?, Refund.attempts[]; PaymentStatus adds REFUND_PENDING/REFUNDED; PaymentWebhookEvent.providerRefundId nullable varchar100; PaymentReconciliation.resolvedAt nullable Tstz. No Booking columns needed.

- [x] Native tests: quote/source binding, provider refund/event uniqueness, captured evidence preservation, paid cancellation atomic allocation release, refund status requires processed evidence, monotonic processed attempts, cancelled allocation cannot revive, commit-time before-show boundary, READ COMMITTED lock/race guards.
- [x] Add enums/tables/FKs/indexes/immutable identity; extend payment guard for refund states, not rewriting prior migrations. Preserve all old capture checks. Refunds/attempts never deleted by runtime APIs; fixture cleanup only on disposable DB.
- [x] Generate/validate; root applies all migrations to a fresh isolated _test DB and runs native tests.

## Task 3: Cancellation and availability policy

Files: booking.service.ts, booking.types.ts, tests/booking-cancellation.test.ts, tests/booking.test.ts; tests/helpers/booking.ts I/O fake allocation release only.
Interface BookingService.cancel(userId,id,scope:BookingConfirmationScope) -> public Booking; BookingDecision permits CANCELLED. Booking policy uses scoped repository transition; checks owner, already-CANCELLED retry, CONFIRMED and DB now strictly before show.start; never calls Redis for cancellation.

- [x] RED: valid owner cancellation, foreign/not-confirmed rejects, exact/after cutoff rejects; repeats succeed after prior cancellation; immutable quote/history; initially allocated seat cancelled/re-held within inspect yields LOCKED.
- [x] GREEN: scoped policy and inspect ALL physical seats before final allocation reread; no TTL change.
- [x] Run focused tests and full unit suite.

## Task 4: Refund orchestration/repository/HTTP

Create refunds/refund.types.ts, refund.repository.ts, refund.service.ts, refund.controller.ts, refund.routes.ts, tests/refunds.test.ts, tests/refunds.integration.mjs and a test helper as needed. Modify payments service/repository/factory/types, app/server and existing provider fakes; package.json/CI integration test paths.
Repository interfaces: cancel(userId,bookingId,work(scope)) -> booking disposition; prepare(paymentId) -> Refund[]; findOwned(userId,bookingId) -> financial/refund view; pending(paymentId) -> Refund with attempts; attempt(refundId) -> current persisted attempt; retryAttempt(refundId,providerRefundId) -> stable next attempt only after verified failure; record(refundId,attemptId,ProviderRefund,event?) -> persisted financial status; noteFailure(attemptId,code); reconcileCandidates(limit) -> IDs; webhook lookup by provider ID/receipt.
RefundService: cancel(user,id), retry(user,id), get(user,id), reconcile(paymentId), webhook(refund,event). Optional RefundCoordinator fourth PaymentService constructor argument {reconcile,webhook}; production factory always supplies it. Existing payment-only test wiring remains isolated historical tests; new integration exercises composed production behavior.

- [x] RED: new cancel route expected200/202 but currently404; full amount/no paid flag; durable pending during outage; duplicate cancellation/concurrent retry; compensation after show; old payment replay never resets refund progress; refund webhook raw HMAC/identity/amount/event conflict; source-specific duplicate capture compensation.
- [x] GREEN: short Book -> Payment -> Refund locks. cancel callback runs BookingService policy, creates full per-capture Refund and durable REFUND_PENDING + reconciliation in same commit; provider dispatch occurs after.
- [x] prepare creates obligations for all captures if Booking FAILED/CANCELLED, or extra captures only if CONFIRMED. Preserve legitimate funding/status for a valid confirmed ticket during extra-capture compensation. Resolve reconciliation via resolvedAt, never erase financial obligation history.
- [x] Dispatch uses stable attempt UUID/header/body. Unknown HTTP outcome keeps attempt; verified failed current attempt can create serialized next attempt. Processed evidence dominates stale failed/created events; fetch current failed identity before advancing. Persist evidence/events/status after provider call.
- [x] Protected strict-empty-body POST /api/bookings/:id/cancel and /refund/retry; owner GET /refunds. ADMIN POST /api/admin/refunds/reconcile for bounded durable backlog retry, using existing current-role checks; no browser amounts/status. Normal cancellation route does not depend on Redis.
- [x] Payment capture handler never downgrades refund states; after durable fulfillment disposition runs refund reconciliation. Refund events use existing raw webhook/HMAC and durable event ledger. Webhook-before-attach finds persisted attempt receipt and validates all provider identities.
- [x] Live tests: actual PG/Redis/adapter controlled transport, cancellation/rebook races, rollback, quote history, replay, full compensation, unknown acknowledgement/retry and provider evidence. Never call actual Razorpay with real keys during verification.

## Task 5: Full checkpoint

- [x] Fresh independent review, RED-to-GREEN fixes, full unit/integration/typecheck/Prisma/build/smoke/audits/frontend regressions.
- [x] Exact inventory, policy/state/request flow, seat release, compensation/retry/recovery and limitations in cancellation-refunds.md; update progress/README; foundation unchanged.
- [x] Stop identity-validated task test services; no user DB reset/global installation. STOP before UI, no commit/push.

## Preflight and ledger

| Boundaries | Resolution |
| --- | --- |
| Provider / root service | Normalized refund signatures above locked; provider agent owns only provider files |
| Schema / root repositories | Models/fields above locked; schema agent owns only additive persistence files |
| Scoped Booking / Refund transaction | Shared store; repository owns transaction, BookingService owns policy |
| Financial truth / refund state | Capture evidence retained; refund states are monetary return progress, not capture failure |
| Approved automatic execution / skill gates | User explicitly approves v1 and requests continue; no routine plan-approval pause, commits or worktree creation |

Ruling: existing dirty checkout and no-commit instruction override generic skill branch/commit/workspace-cleanup steps; plan itself is persistent ledger. Cost if wrong: review must use source inventory rather than clean commit range.
Ruling: normal refunds use the documented X-Refund-Idempotency header, persisted attempt UUID and identical body; HTTP retries do not mean duplicate financial effects. Cost if provider contract differs: fail closed/pending until provider test-mode verification.

## Completed evidence and review ledger (2026-10-07)

- Provider boundary: 63 focused refund adapter/HMAC tests pass; native input
  mutation across await was caught RED and fixed with primitive snapshotting.
- Booking policy: 6 cases pass, including exact/after start and repeat after
  prior cancellation. Live availability barrier confirms initially allocated,
  cancelled/reheld seats are inspected and reported LOCKED.
- Sixth migration applied after the previous five to a fresh loopback
  cinehook_refunds_test DB. Native guards: 5 results passed. Previous SQL retained.
- Composed new refund live suite: 25 results passed. Historical tests wired
  without refunds deliberately remain prior-Payments policy regressions; composed
  new suite exercises production refund behavior.
- RED-to-GREEN: capture replay after REFUND_PENDING/REFUNDED, new extra capture
  after full return, known returned-source verification and role middleware.
- Independent reviewer P2: oldest20 candidates starve #21 if provider remains
  pending. Real 21-obligation regression reproduced it. Short selection rotates
  Payment.updatedAt before HTTP, Booking-first SKIP LOCKED preserves lock order;
  reviewer approved fix with no remaining actionable implementation defect.
- Test sequencing follow-up: 21-item fixture leaves >20 pending; older admin
  recovery test must allow bounded multiple batches, not assume every new item
  fits first. Updated and passed without relaxing recovery/identity assertions.
- Added barrier test: processed webhook between failed fetch and retryAttempt
  reservation causes recheck to suppress any next attempt/HTTP.
- FINAL: backend typecheck, 362 units/17 files, build, all10 live files/68 results
  with no skips, 2 smoke tests; Prisma validate/generate/up-to-date6migrations;
  frontend lint/build; both audits zero vulnerabilities.
- Files: exact13created/19changed inventory in module record. Planned booking.test.ts
  and server.ts changes were unnecessary; existing wiring suffices.
- Foundation SHA256 unchanged:
  9EF27F809418E2387E7347FC7AA00091B171DF208A1C17829288098293AC22C6.
- Task PostgreSQL PID28580/data directory/port55438 and Redis PID41612/executable/
  port55439 were identity-validated then stopped. Both task listeners closed;
  normal port5432 process7716 remains. Temporary test data retained/recoverable.
- User explicitly chose keep-existing-work-uncommitted/noGit/STOP beforeUI, so
  generic finishing skill merge/push/worktree menu is inapplicable.

Review rulings: real provider idempotency/terminal-state/settlement behavior and
arbitrary contradictory evidence across dispatched retries cannot be proved by
controlled transport. Native one-processed/source binding, fresh failed-proof
retry and processed-before-reservation barrier are verified; do not claim a
distributed exactly-once guarantee. Manual/external/partial refunds remain an
operator reconciliation boundary. No background scheduler added; durable owner
retry/fair ADMIN batch is the recovery interface. No actual provider money request,
account credential change, user DB migration/reset, commit/push or UI work.
