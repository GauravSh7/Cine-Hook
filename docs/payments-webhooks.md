# Payments / Razorpay Webhooks — module record

Status (2026-10-07): implemented; final verification/checkpoint record below.
STOP before Cancellation/Refunds. No commit, push, actual provider charge or
secret/environment file creation.

## User-authorized scope

- Separate PaymentService from BookingService; isolate Razorpay behind
  PaymentProvider. Preserve Route -> Middleware -> Controller -> Service ->
  Repository -> Prisma -> PostgreSQL.
- Create orders from the trusted Booking amount, never browser totals.
- Verify payment signatures on the backend; persist Payment/provider identifiers.
- Only verified provider/backend evidence can reach BookingService.confirm.
- Use short PostgreSQL transactions for final payment/booking state; no provider
  HTTP call while a database transaction is open.
- Deduplicate provider payment IDs and webhook event IDs, including concurrent
  browser verification and webhook delivery.
- Dedicated raw-body Razorpay webhook route; recover when the browser closes.
- Payment lifecycle: PENDING -> SUCCESS | FAILED. No refunds/cancellation policy.
- Verify the full module, update progress and stop before Cancellation/Refunds.
  Never commit/push or expose secrets.

## Inspection findings

Before implementation the schema contained Booking, BookingSeat and ConfirmedSeat, but no
Payment model. No PaymentService, PaymentProvider, Razorpay routes or provider
configuration existed at that inspection; all are now implemented.

BookingService.confirm checks the live Redis owner/fence, five-minute deadline,
show bookability and terminal Booking state. PostgreSQL independently checks
expiry at transition and before commit. No implicit renewal or re-acquisition
is permitted. A successful payment cannot override these allocation rules.

BookingRepository.transition originally owned its own transaction; confirmation
also owns failure recovery and post-commit Redis cleanup. Simply nesting a call
to the existing confirm method inside a Payment transaction would not make the
two commits atomic. Integration therefore uses a transaction-scoped repository
boundary retaining BookingService policy, with Redis cleanup after the shared
commit. Provider calls remain outside that transaction.

App originally mounted generic JSON parsing first. The dedicated webhook route
must use exact raw bytes before that parser. JWT/current-user checks, strict
validation, safe errors, UTC database connections and existing factories should
be reused, not duplicated.

## Approved financial-truth contract (supersedes the earlier proposal)

Captured money and ticket fulfillment are distinct facts. A capture can be
verified after a hold expires/is released, when Booking confirmation must fail.
Razorpay also documents payment.failed followed by payment.captured for the
same transaction. Ignoring the capture loses financial evidence; the earlier
strict-terminal proposal would conflict with financial truth.

The user explicitly approved:

- Verified/provider-confirmed capture is SUCCESS independently of
  whether the booking can be fulfilled.
- Persist a reconciliation flag/reason for captured but unfulfilled payments;
  preserve failed Booking state without renewing/reacquiring seats.
- Captured evidence takes precedence over earlier financial failure observations;
  SUCCESS never downgrades. Record the observation history by provider identity,
  and never revive a failed Booking as a result of that financial correction.
- Do not issue refunds, add cancellation policy or claim a ticket was booked.

There are only three financial states: PENDING, SUCCESS, FAILED. The latest
unqualified instruction that every verified capture is SUCCESS supersedes the
earlier recommendation to freeze financial FAILED even after later capture.
This corrects financial evidence only, not seat ownership or Booking lifecycle.

## Provider evidence checked during inspection

- [Payment lifecycle](https://razorpay.com/docs/payments/payments/): authorization
  differs from capture; capture is the completed payment state.
- [Payments webhook events](https://razorpay.com/docs/webhooks/payments/): failed
  followed by captured for the same transaction is an expected sequence.
- [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/):
  create orders server-side; verify Checkout HMAC using the stored server order ID.
- [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/): verify
  unaltered raw bytes with the webhook secret; event IDs detect duplicates;
  delivery can be out of order.
- [Webhook delivery practices](https://razorpay.com/docs/webhooks/best-practices/):
  consume idempotently, acknowledge successful consumption and retry transient
  failures rather than acknowledge work that has not been durably saved.

## Exact file inventory for this module

Paths below are relative to the repository root. Existing uncommitted files
from earlier modules and unrelated frontend edits are not new Payments changes.

Created (19 files):

| File | Responsibility |
| --- | --- |
| `backend/src/modules/payments/payment-provider.ts` | Provider-neutral order/payment/webhook contract |
| `backend/src/modules/payments/razorpay.provider.ts` | Razorpay HTTPS transport, response validation and HMAC |
| `backend/src/modules/payments/payment.types.ts` | Persistence and service contracts |
| `backend/src/modules/payments/payment-write.ts` | Safe mapping of database write failures |
| `backend/src/modules/payments/payment.repository.ts` | Financial persistence, locking and transaction composition |
| `backend/src/modules/payments/payment.service.ts` | Order/evidence/fulfillment orchestration |
| `backend/src/modules/payments/payment.validation.ts` | Strict API body/header validation |
| `backend/src/modules/payments/payment.controller.ts` | HTTP responses only |
| `backend/src/modules/payments/payment.routes.ts` | Authenticated payment routes and raw webhook router |
| `backend/src/modules/payments/create-payments.ts` | Dependency construction; fail closed without configured provider |
| `backend/prisma/migrations/20261007000500_payments_webhooks/migration.sql` | Additive financial tables and native guards |
| `backend/tests/payments.test.ts` | HTTP/real-service policy regressions |
| `backend/tests/razorpay-provider.test.ts` | Provider boundary/signature/transport regressions |
| `backend/tests/payments-config.test.ts` | Optional/all-or-none credentials and safe validation |
| `backend/tests/booking-confirmation.test.ts` | Scoped confirmation and deferred cleanup |
| `backend/tests/helpers/payments.ts` | Test-only persistence/provider I/O replacements |
| `backend/tests/payments-database.integration.mjs` | Actual PostgreSQL financial constraints and races |
| `backend/tests/payments.integration.mjs` | Real HTTP/PostgreSQL/Redis + Razorpay adapter on controlled transport |
| `docs/superpowers/plans/2026-10-07-payments-webhooks.md` | Implementation plan, review rulings and verification ledger |

Changed (13 files):

| File | Change |
| --- | --- |
| `backend/prisma/schema.prisma` | PaymentStatus, four financial models and Booking relation |
| `backend/src/modules/booking/booking.types.ts` | Transaction-scoped BookingStore/afterCommit contract |
| `backend/src/modules/booking/booking.repository.ts` | Reuse outer transaction, no nested commit |
| `backend/src/modules/booking/booking.service.ts` | Trusted scoped confirmation, payable checks and conditional failure |
| `backend/src/app.ts` | Raw webhook before generic JSON; payment routes |
| `backend/src/server.ts` | Share existing Booking instance with PaymentService |
| `backend/src/config/env.ts` | Optional grouped Razorpay credentials; safe bounded validation |
| `backend/.env.example` | Three blank provider placeholders, never actual credentials |
| `backend/package.json` | Include both Payments integration suites |
| `.github/workflows/ci.yml` | Disposable Payments test database URL |
| `docs/payments-webhooks.md` | This module record |
| `docs/implementation-progress.md` | Current checkpoint/next-module status |
| `README.md` | Payment APIs, provider setup and verification instructions |

No new dependencies/lockfile changes, frontend source changes or edits to prior
migrations. Generated Prisma/build output stays ignored. The historical
`implementation-foundation.md` is unchanged.

## API contract and exact request flows

Both payment routes use existing JWT verification AND current database-user
checks, strict body validation, safe errors and `Cache-Control: no-store`.

| API | Input | Access / result |
| --- | --- | --- |
| `POST /api/payments/order` | `{ bookingId: UUID }` | Owner JWT; 201, stable order + payment + original hold expiry |
| `POST /api/payments/verify` | `bookingId`, `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` | Owner JWT; 200, financial record and fulfillment/reconciliation disposition |
| `POST /api/webhooks/razorpay` | Exact JSON bytes; `X-Razorpay-Signature`, `X-Razorpay-Event-Id` | Provider HMAC, no JWT; 200 `{ received: true }` after durable consumption |

Unknown fields such as amount, total, userId and paid are rejected. Invalid
signatures/mismatched evidence return safe 400; another user's payment is hidden
with 404; identity conflicts return 409; dependency outages remain retryable
503. A mapped database concurrency abort stays retryable 409/CONCURRENT_CHANGE.

Create-order flow:

```text
Route -> JWT/current-user/validation -> PaymentController.order
 -> PaymentService.order -> BookingService.payable (owner, live hold, future show)
 -> PaymentRepository.reserve -> Prisma -> PostgreSQL (commit trusted quote/receipt)
 -> PaymentProvider.findOrder/createOrder -> Razorpay (OUTSIDE transaction)
 -> PaymentRepository.attachOrder -> Prisma -> PostgreSQL (short transaction)
 -> BookingService.payable again -> controller -> 201
```

The amount comes exclusively from immutable Booking.totalPaise, derived from
BookingSeat price snapshots. Prices use integer INR paise. Receipt is a persisted
UUID (36 characters, within Razorpay's 40-character limit), not a new value per
retry. If provider creation succeeded but its response was lost, exact receipt
lookup recovers the order. There is no automatic retry of an ambiguous POST.
Razorpay's receipt filter is a substring filter, so results are post-filtered
for exact identity and ambiguous/incomplete lookup fails closed.

Verify flow:

```text
Route -> JWT/current-user/validation -> PaymentController.verify
 -> PaymentService.verify -> PaymentRepository.findByBooking (owner from PostgreSQL)
 -> PaymentProvider.verifyCheckoutSignature (stored order ID + payment ID)
 -> PaymentProvider.fetchPayment -> Razorpay (OUTSIDE transaction)
 -> Match order/payment ID, trusted amount, currency and captured status
 -> recordEvidence transaction -> shared fulfillment transaction -> controller -> 200
```

A valid Checkout signature alone does not prove capture. Authentic authorization
remains PENDING and never confirms seats. Verify ownership does not depend on
Redis, so Redis outage cannot prevent saving verified financial evidence.

Webhook/browser-close flow:

```text
Dedicated route -> express.raw (before express.json, no inflation, 100 KB limit)
 -> PaymentController.webhook -> PaymentService.webhook (signature/event-ID validation)
 -> RazorpayProvider.parseWebhook (HMAC raw bytes BEFORE parsing JSON)
 -> find local provider order; recover reserved receipt if attach was interrupted
 -> same recordEvidence + fulfillment handler as verify -> processed event -> 200
```

Supported evidence: payment.captured, order.paid and payment.failed. Order-paid
also requires a matching captured payment and paid order. Signed unsupported or
unrelated events are durably acknowledged without booking/financial mutation.
No client callback is needed when the browser closes: captured webhook recovery
uses the same trusted path. No public booking-confirm route exists.

## Financial transactions versus booking fulfillment

There are two deliberately separate short transaction boundaries:

1. **Financial evidence:** lock Booking -> Payment; bind immutable identifiers,
   save evidence/event receipt, set SUCCESS for verified capture, and create
   FULFILLMENT_PENDING with compensationRequired=false. Commit FIRST.
2. **Final fulfillment:** lock Booking -> Payment, then existing Show/Movie/Seat
   order; call `BookingService.confirm(bookingId, scope)`. The scope supplies a
   transaction-bound BookingRepository and `afterCommit` registration. The same
   transaction updates Booking/ConfirmedSeat, bookingFinalizedAt and final
   reconciliation. Only AFTER commit are owner/fence-checked Redis locks released.

Services never import/use Prisma for these decisions. PaymentRepository owns
the short READ COMMITTED transaction (seven-second bound); BookingRepository
reuses it rather than starting a nested transaction. No Razorpay request runs
inside either transaction. Redis validation is bounded and never renews holds.
Event processedAt is saved in a subsequent short receipt transaction, so a lost
acknowledgement can safely repeat the entire idempotent handler.

| Financial fact / fulfillment outcome | Saved disposition |
| --- | --- |
| Authorization only | Payment PENDING; no confirmation |
| Verified failure, no prior capture | Payment FAILED; existing hold deadline unchanged |
| Capture + valid hold/bookable show | Payment SUCCESS; Booking CONFIRMED; no compensation condition |
| Capture + expired/lost/released/terminal Booking | Payment SUCCESS; Booking remains/fails unfulfilled; compensationRequired=true with reason |
| Native allocation/commit-time expiry conflict | Financial SUCCESS survives rollback; conditional failUnfulfilled + durable FULFILLMENT_CONFLICT |
| Transient Redis/DB/concurrency failure | SUCCESS + FULFILLMENT_PENDING; bookingFinalizedAt null; retry unfinished work |
| Additional distinct captured provider payment | SUCCESS; DUPLICATE_CAPTURE compensation condition; no second ticket |

Never infer fulfillment from Payment.status alone. The response includes
bookingFinalizedAt and reconciliation; read the owner's Booking to establish
ticket status. A later capture corrects earlier financial FAILED evidence but
cannot resurrect a failed Booking. SUCCESS never becomes FAILED. Refunds are
not issued and no new financial refund enum/policy was invented.

## Prisma relationships and database authority

| Relationship | Purpose |
| --- | --- |
| Booking 1:0..1 Payment | One immutable order/quote aggregate per Booking |
| Payment 1:N PaymentEvidence | Each provider payment identity binds globally to one aggregate |
| Payment 1:N PaymentWebhookEvent | Durable delivery identity/digest; unrelated events can have no Payment |
| Payment 1:0..1 PaymentReconciliation | Unfinished fulfillment or compensation obligation |

Provider order ID, first captured payment ID, receipt and booking ID are unique.
PaymentEvidence uses providerPaymentId as primary key; PaymentWebhookEvent uses
providerEventId. Reconciliation is unique by Payment. Timestamps are timezone
aware UTC. Monetary amount is BIGINT bound to the Booking quote.

Native checks/triggers enforce immutable quote/order binding and evidence amount,
capture/failure observation monotonicity, SUCCESS capture evidence, no SUCCESS
downgrade, and finalized captured-money disposition. A SUCCESS that is not yet
finalized must retain its unfinished reconciliation condition. Updating a related
Booking also rechecks financial disposition, preventing silent paid-booking
cancellation without compensation. Existing ConfirmedSeat unique Show/Seat
allocation remains the race-safe final authority; Redis is temporary only.

## Idempotency and failure recovery

Provider payment IDs bind globally and event IDs bind to digest/type/payment
identity. Reusing an event ID for different signed bytes is a conflict, not a
duplicate. Book/Payment row locks serialize parallel writers; confirmation
returns the existing disposition after finalization. Captured and failed
observations never reverse earlier captured evidence. Extra captures are
recorded, not ignored, with compensation required.

Crashes between evidence commit and fulfillment leave durable SUCCESS and
FULFILLMENT_PENDING. Same verify/webhook retries finalization if
bookingFinalizedAt is null; an event receipt alone never suppresses that retry.
Finalization rollback preserves Redis holds because cleanup was deferred.
Commit-with-lost-ack retries see finalized Book/Payment and cannot allocate twice.
Operational errors return non-2xx to preserve webhook retries; an expired hold
at recovery is failed/compensated, never renewed. Native expiry guards also
check the deadline at commit, not just a stale service read.

## HLD/LLD alignment and approved refinements

The locked stack and Route -> Middleware -> Controller -> Service -> Repository
-> Prisma -> PostgreSQL flow are unchanged. PaymentService owns financial
orchestration, BookingService owns fulfillment, SeatLockService owns Redis, and
RazorpayProvider implements PaymentProvider. Controllers only handle HTTP.

Refinements beyond the basic LLD are necessary implementation details:

- Financial evidence/event/reconciliation tables preserve capture truth and
  retry state; these implement the expressly approved financial-truth gate.
- A transaction-scoped Booking repository + afterCommit hook composes final
  state atomically without moving policy into repositories or services into HTTP.
- One Payment aggregate/order per Booking plus N provider attempt identities
  replaces a naive single provider payment ID that would lose failure history.
- Native fetch/crypto implements the provider contract instead of adding an SDK;
  protocol/signatures are validated against official documentation and tests.
- Provider credentials are all-or-none. With none, Payment APIs fail closed
  while other development modules still work. API secrets are provider-issued
  (presence/bounded length); our chosen webhook/JWT secrets retain minimum length.

No Redis concurrency/TTL change, Seat status column, provider call inside a DB
transaction, booking revival, refund implementation or alternate stack.

## Review and verification

Test-driven changes cover real services; I/O replacements exist only in test
helpers. Provider, native persistence and HTTP policies were developed across
disjoint tasks and reviewed independently. Three Important review findings were
fixed with observed failing-then-passing regressions: provider-issued API secret
length compatibility, keeping CONCURRENT_CHANGE aborts retryable, and rejecting
fetched external refunded state before reattempting unfinished fulfillment.
The latter returns PAYMENT_RECONCILIATION_REQUIRED without rewriting SUCCESS
or implementing refund policy. Unknown 409 errors are not assumed to mean
permanent fulfillment failure. Final independent review reported no current
scope blockers and independently reran 83 focused tests successfully.

Fresh full verification (2026-10-07):

| Check | Result |
| --- | --- |
| Backend typecheck | Passed |
| Full Vitest unit/HTTP suite | 278 passed in 14 files |
| Prisma validate / generate | Passed; client 7.10.0 |
| Backend build | Passed |
| Full live integration suite | 38 passed, 0 failed/skipped |
| Payments-specific live subset | 1 native database result + 14 combined HTTP results (13 subtests + parent) |
| Compiled server smoke | 2 passed |
| Backend / frontend dependency audit | 0 vulnerabilities each |
| Frontend lint / TypeScript + Vite build | Passed; no frontend source change |
| Fresh isolated migration deployment/status | All five migrations applied; schema up to date |
| Tracked whitespace and ignored-secret checks | Passed; informational LF/CRLF warnings only |

Full integration includes Auth/Catalog/Shows/Booking/Redis regressions. Actual
PostgreSQL financial guards test immutable quotes, identity uniqueness, captured
evidence, fulfillment disposition and concurrent writers. Combined API checks
exercise server-priced orders, provider calls outside request transactions,
closed-browser/raw webhook recovery, duplicate/out-of-order delivery, lost order
acknowledgements, expiry/release, allocation conflict, rollback and retryable
DB/Redis outages, and fetched external refunded-state rejection.

Services were task-only: PostgreSQL 18.4 on loopback port 55438 with fresh
`cinehook_payments_final_test`; SHA-verified community portable Redis 8.10.2 on
loopback port 55439/DB15. The normal PostgreSQL service on 5432 was untouched.
No database reset, global installation or destructive user migration. Task
services are stopped at handoff; their temporary database files remain
recoverable. Fixture cleanup deletes only this test run's identities/keys.

Integration uses the actual Razorpay adapter, but its HTTPS transport is
controlled: this is NOT actual Razorpay account/payment/dashboard verification.
CI targets PostgreSQL17/official Redis8, but remote CI/Docker remain unexecuted.
The known non-failing Prisma/pg nested-query deprecation warning remains visible;
intentional outage tests log only safe error codes/events, never secrets.

## Local provider setup and remaining boundaries

Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and a strong RAZORPAY_WEBHOOK_SECRET only
in your ignored environment/secret manager. The public key ID can be returned
for Checkout; API/webhook secrets must never be VITE_* values or logged.
Configure a reachable HTTPS webhook URL for `/api/webhooks/razorpay` and subscribe
to payment.captured, order.paid and payment.failed. Configure provider automatic
capture; authorization alone does not fulfill. This module does not manually
capture payments. Provider capture timing does not extend the five-minute hold;
late capture enters compensation reconciliation.

No actual provider credentials, dashboard subscription, internet webhook
delivery or real financial transaction was performed. Background reconciliation
workers, refund APIs/policy, cancellation APIs, UI Checkout integration, rotated
webhook-secret history, ADMIN bootstrap and shared auth throttling remain later
work. Docker/remote CI are configured but unexecuted. API implementation passing
locally does not mean deployed/production-ready.

Receipt lookup is bounded to one page; 100 results without an exact match fail
closed rather than guessing or creating a duplicate order. This is an explicit
availability/pagination limitation. Fetched refunded state is rejected, but
external refunds and stale capture-webhook reconciliation after an external
refund still require the next module/operator policy. No automatic worker
replays unfinished obligations after the provider's delivery retry window.

STOP at Payments/Webhooks checkpoint. Cancellation/Refunds must consume durable
captured evidence and compensation obligations without treating unfulfilled
money as a financial failure. Its policy is not decided by this module.
