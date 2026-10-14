# Payments / Razorpay Webhooks Implementation Plan

> **For agentic workers:** Use test-driven-development, independent parallel implementation for disjoint boundaries, and final requesting-code-review. Track each step below; no commits/pushes.

**Goal:** Verified financial truth, idempotent server orders/verification/raw webhooks, trusted Booking fulfillment and durable compensation conditions; stop before refunds.

**Architecture:** PaymentService coordinates provider I/O outside transactions and repository-owned short transactions. BookingService retains confirmation policy through a transaction-scoped BookingStore and deferred post-commit cleanup. Route -> Middleware -> Controller -> Service -> Repository -> Prisma -> PostgreSQL remains intact.

**Tech Stack:** Existing Node/Express/TypeScript, Zod, Prisma/PostgreSQL, Redis, native fetch/crypto, Vitest/Supertest. No provider SDK dependency required.

**Spec:** User-approved financial-truth contract and docs/payments-webhooks.md, updated with approved design.

## Global constraints

- Payment states PENDING, SUCCESS, FAILED describe provider financial outcome, never ticket fulfillment.
- Verified capture dominates earlier failure evidence: captured money must be SUCCESS; SUCCESS never downgrades. This follows the latest explicit financial-truth instruction, not permission to revive a Booking.
- No renewal/reacquisition/Booking revival/refunds. Preserve five-minute Redis policy and permanent allocation authority.
- All provider HTTP occurs outside database transactions; secrets and raw provider errors are never returned/logged.
- Persist financial evidence before attempting fulfillment so rollback/outage cannot erase verified capture.
- No public booking confirm; only verified backend evidence calls trusted BookingService.confirm.
- Existing dirty checkout is explicitly in scope. No reset/destructive migration, existing-user-database mutation, secrets, commits/pushes or synced-source edits.
- Keep foundation historical; update progress/module notes. Automatic execution approval overrides generic skill approval/commit/worktree handoffs.

## Review focus

- Crash after provider order/capture but before local response: stable receipt recovery and persisted SUCCESS/unfinished fulfillment must be retryable.
- Same capture through verify, payment.captured and order.paid: one financial identity, one seat allocation, no duplicate reconciliation.
- Expiry at transition/commit, Redis outage, allocation collision: preserve SUCCESS, never revive/relock, distinguish retryable unfinished work from compensation-required failure.
- Failed event after capture or capture after earlier failure: capture wins; a forged/mismatched event cannot bind another booking/order.
- Exact raw bytes/secret separation, bounded provider responses/timeouts, authenticated ownership and no browser price/paid flags.

## Task 1: Provider boundary

Create `backend/src/modules/payments/payment-provider.ts`, `razorpay.provider.ts`, `tests/razorpay-provider.test.ts`.

Interfaces: ProviderOrder {id,receipt,amountPaise,currency,status}; ProviderPayment {id,orderId,amountPaise,currency,status,captured}; ProviderWebhook {eventType,payment?,order?,digest}. PaymentProvider keyId, createOrder(input), findOrder(receipt), fetchOrder(id), fetchPayment(id), verifyCheckoutSignature(orderId,paymentId,signature): boolean, parseWebhook(rawBody:Buffer,signature): ProviderWebhook.

- [x] Write/run RED tests for HMAC identity/raw bytes, malformed response, amount/order binding and bounded external failures.
- [x] Implement native fetch/crypto with hardcoded Razorpay HTTPS origin, timeout and response size limit. Reuse receipt after unknown creation outcome; duplicate receipt recovery fetches exact existing order.
- [x] Run focused tests and independent source review.

## Task 2: Financial persistence

Modify schema; create additive `20261007000500_payments_webhooks/migration.sql` and `tests/payments-database.integration.mjs`.

Models: Payment (one aggregate/order per Booking; immutable trusted amount/currency/receipt, nullable unique providerOrderId, financial status, first successful providerPaymentId, capturedAt, bookingFinalizedAt, failureCode); PaymentEvidence (unique providerPaymentId, Payment parent, amount/currency, captured boolean that never reverses, failureSeen); PaymentWebhookEvent (unique providerEventId, raw-body digest, eventType, Payment parent, providerPaymentId, processedAt nullable); PaymentReconciliation (unique Payment parent, reason, compensationRequired flag). No raw payload/card/customer data persisted.

- [x] Add/run native database guards; the initial HTTP RED is recorded. Native SQL tests ran after migration, so no old-schema native RED is claimed.
- [x] Add indexes/FKs/checks/immutability/capture-dominance and evidence integrity. Preserve earlier migration files.
- [x] Generate/validate, apply to a fresh isolated test DB, run native invariants/races. Only test fixture cleanup is allowed.

## Task 3: Booking transaction boundary, Payment layers and HTTP

Modify booking.types/service/repository for scoped confirmation; create payments types/repository/service/validation/controller/routes/factory, unit/helper/live integration tests; update app/server/config/example/CI/scripts.

BookingConfirmationScope: store: BookingStore, afterCommit(callback:()=>Promise<void>):void. BookingService.confirm(id,scope?) retains legacy standalone behavior; in scope returns unfulfilled disposition without rejecting expected terminal/expiry policy and queues Redis cleanup for after shared commit. BookingRepository.withTransaction(tx) uses the supplied transaction, never nests it.

PaymentStore: reserve(userId,bookingId)->Payment; attachOrder(paymentId,ProviderOrder)->Payment; findByBooking/findByOrder/findByReceipt; recordEvidence(paymentId,evidence,event?)->Payment; finalize(paymentId,work(scope)->Booking result)->Payment; markEventProcessed(eventId). Implementation callbacks leave services owning policy, repository owns locking/Prisma. Lock order Booking -> Payment -> Show -> Movie -> sorted physical Seats.

- [x] Initial RED: existing app POST /api/payments/order expected201/actual404.
- [x] Unit/API tests: trust server amount; strict input/auth ownership; HMAC + fetch capture check; webhook raw parsing/signature; closed browser; duplicate/out-of-order/concurrent events; captured-but-expired/failed reconciliation; unknown commit; operational outages.
- [x] Persist receipt reservation before provider call. Repeated order returns stored order; unknown creation recovered by exact receipt outside transactions.
- [x] /verify verifies signature with stored order then fetches actual payment and matches IDs/amount/currency/captured state. Valid authorization remains PENDING, no fulfillment.
- [x] /webhooks/razorpay uses express.raw before express.json, validates signature before parsing. payment.captured/order.paid/payment.failed enter same evidence handler; unsupported signed events ignored safely.
- [x] Persist evidence/SUCCESS and provisional FULFILLMENT_PENDING condition first; duplicate capture triggers retry of unfinished work rather than skipping it. Shared short final transaction invokes trusted scoped BookingService.confirm; commit stores finalization/reconciliation; event processed status follows in a separate short receipt transaction. SQL expiry/allocation rejection keeps earlier financial evidence and falls back to failed fulfillment/compensation condition; transient dependency failures stay retryable.
- [x] Run unit/typecheck and live PostgreSQL/Redis/API/provider-transport integration; no real Razorpay order or charge without test credentials/explicit appropriate scope.

## Task 4: Required checkpoint

- [x] Independent final review and demonstrated regression fixes.
- [x] Full tests/typecheck/Prisma validate+generate/build/smoke/audits/frontend regression; distinguish local fake provider HTTP from actual Razorpay account verification.
- [x] Exact file inventory and create-order/verify/webhook flows; idempotency, financial/booking state separation, reconciliation and limitations in payments-webhooks.md; summarize in progress/README.
- [x] Stop test services safely; stop before Cancellation/Refunds. No commits/pushes.

## Preflight and ledger

| Tasks | Shared boundary | Resolution |
| --- | --- | --- |
| 1 / 3 | PaymentProvider normalized orders/payments/events | Task1 types are source of truth; root coordinates names before service implementation |
| 2 / 3 | Prisma models/evidence fields | Schema agent owns schema/migration; root owns repository and validates generated types |
| 3 / existing Booking | scoped store and afterCommit | Legacy no-scope API preserved; no Redis cleanup before outer commit |
| 1 | provider tests match external security contract | No SDK or arbitrary base URL; only transport test injection |
| 2 | guards vs fixture cleanup | No destructive user-data migration; exact run IDs cleaned child-first |
| 3 | financial success vs rollback | Evidence commits first; transient failure is unfinished, not false financial FAILED |
| 4 | checkpoint vs execution sequence | Explicit STOP before refunds overrides automatic next-module execution |

Ruling: Latest captured-payment-is-always-SUCCESS instruction makes capture dominate prior failure evidence; no new financial enum state, SUCCESS never downgrades. Cost if wrong: correction semantics must be revisited, never silently lose capture truth.
Ruling: Disjoint provider/schema/test tasks may run in parallel under proactive delegation; existing dirty checkout/no-commit user contract overrides generic skill worktree/commit tooling. Cost: source-based reviews replace commit-range review packages.

## Completed execution / review ledger (2026-10-07)

- Provider/security boundary: 41 focused tests. Actual external HTTPS was not called; controlled transport tests exercise production normalization/HMAC/deadlines/limits.
- Financial schema: additive fifth migration; all five deployed to fresh isolated cinehook_payments_final_test. Native financial and race checks pass. No earlier migration or user database changed.
- Initial HTTP RED was 404 instead of 201. Scoped Book confirmation/cleanup and operational/financial policies have RED-to-GREEN regressions; final current tree passes.
- Independent final review found three Important defects: provider-issued secret min32, mapped CONCURRENT_CHANGE incorrectly treated as permanent, and fetched refunded state fulfilling interrupted capture. Each was reproduced with a failing regression, then fixed and rerun. Final independent rerun: 83 focused tests; no current-scope blocker.
- Ruling: transient concurrency/unknown errors propagate and leave SUCCESS/FULFILLMENT_PENDING retryable. Only known durable allocation/check conflicts enter compensation fallback.
- Ruling: refunded provider fetch returns PAYMENT_RECONCILIATION_REQUIRED before accept; prior SUCCESS stays intact. No refund transition/policy/execution added. External refunds/stale capture-event reconciliation remain next-module scope.
- Minor limitation: bounded receipt lookup fails closed if its page cannot establish an exact match; pagination is a future availability improvement, not permission to guess a provider order.
- Final verification: backend typecheck/build; 278 unit/HTTP tests (14 files); Prisma validate/generate7.10.0; five migrated/current migrations; 38 actual PG/Redis integration results (0 skipped/failed); 2 compiled smoke tests; frontend lint/TS/Vite build; backend/frontend audit0 all pass.
- Exact 19-created/13-changed inventory, API/transaction flows, models, decisions and limitations are in docs/payments-webhooks.md; progress and README updated. Historical foundation hash remains unchanged.
- Task-only PostgreSQL18.4/Redis8.10.2 stopped after identity validation. Existing5432 untouched. Temporary data files remain recoverable; no global service install/reset/removal.
- Ruling: explicit no-commit/no-push/STOP instruction chooses keep-as-is; generic branch integration menus/merge/cleanup actions do not apply. No user worktree/files removed.
- STOP before Cancellation/Refunds. Actual Razorpay account/charges/dashboard/internet webhook, Docker and remote CI remain unverified.
