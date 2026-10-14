# Checkout cancellation and automatic scrolling

Approved 12 October 2026. No schema changes or application database migrations
were required: existing movie/event booking guards allow PENDING -> CANCELLED.

## Request and state flow

`POST /api/bookings/:id/checkout/cancel` with an empty JSON object:
route -> JWT/current-user/id/body validation -> RefundController -> RefundService
-> RefundRepository -> trusted BookingGateway -> movie/event BookingService
-> transaction-scoped booking repository -> Prisma/PostgreSQL.

The booking row lock serializes cancellation against order reservation,
capture and final confirmation. Only the owner can cancel. Pending checkout
becomes CANCELLED with CHECKOUT_CANCELLED. A repeat request is idempotent.
If confirmation won first, the existing strictly-before-start paid cancellation
policy applies and permanent allocations are released in the same transaction.
Historical BookingSeat/EventBookingSeat snapshots remain unchanged.

Redis owner/hold-fenced cleanup is deferred until the cancellation commit.
Failed cleanup does not undo cancellation; the original five-minute TTL remains
the fallback. It never releases another booking's new hold.
The previous DELETE /hold endpoint now also records pending release as CANCELLED;
the UI uses the new financial-coordinated endpoint, not a navigation-only action.

If capture arrived before fulfillment, the cancellation coordinator atomically
finalizes the unfulfilled disposition and creates full captured-source refund
obligations. Payment becomes REFUND_PENDING; provider HTTP follows commit.
Later capture/webhook replay cannot revive CANCELLED or reacquire seats. The
captured-evidence transaction itself finalizes already-CANCELLED/FAILED outcomes
and seeds full refund obligations, even if execution stops before another
finalize/reconcile call. Refund batch recovery therefore sees the durable work.
existing evidence/refund identities prevent duplicate effects and compensation
does not depend on session time. Provider-unavailable refunds remain durable.

## FIRST50

Verified captured financial evidence permanently consumes eligibility, across
movie/event booking, even after cancellation, fulfillment failure or refund.
No-order pending cancellation releases its own reservation in the transaction.
This is reusable immediately, with user-row serialization against a second offer.

An issued/uncertain Razorpay order is not definitively closed just because one
payment attempt failed or the user cancelled. Such a reservation remains fenced
until its provider outcome is certain; releasing it would allow two discounted
orders to capture. Current provider abstraction has no verified terminal
order-closure contract. No false order-closure evidence or timeout-based release
was introduced. A truly terminal pre-capture provider-order disposition requires
authoritative reconciliation, not a browser flag. Captured evidence always wins.

## UI and files

Checkout calls the backend, then navigates to authoritative booking status;
network/API failure does not pretend cancellation succeeded. Cancelled bookings
have no timer/resume-checkout action and appear under My Bookings -> Cancelled.
Captured cancellations show provider-authoritative refund state, not a ticket.

`use-paged-async.ts` aggregates pages, deduplicates identities, aborts stale
filter/account requests, preserves earlier rows on next-page failure, and exposes
retry. `ScrollMore.tsx` observes a bottom sentinel with a native scroll fallback.
No numbered Previous/Page/Next controls remain in Category, Event, Movie,
Wishlist, My Bookings or admin list pages. Movie home was already fully scrollable.
Filter changes and mutation actions reset to the first page; loaded counts are
explicitly not represented as account-wide totals.

Backend changed: app composition and booking controller/routes; movie/event
booking services and repositories; new pricing/release-unpaid-offer helper;
payment evidence repository; refund service/repository/types/controller/routes.
Frontend changed: booking API, checkout/status pages, paginated pages above;
new shared paging hook/sentinel. Targeted tests changed/added: booking-cancellation,
booking, payments, refunds, pricing.integration; booking-flow and scrolling.

Tax validation remains unchanged and fail-closed. See tax-configuration-required.md
for live missing policies, reviewed government sources and exact setup fields.

## Verification evidence

- Backend: 94 targeted tests across booking, cancellation, payments, refunds
  and event booking; typecheck and build passed.
- Actual isolated PostgreSQL/Redis: 18 passing results, zero failures/skips;
  `cinehook_event_seed_pricing_oct12cancelfinal_test` retained. Includes owner
  protection/strict empty body, duplicate cancellation, no-order coupon release,
  capture/confirmation races, interruption immediately after late capture,
  shared movie/event FIRST50 and legacy DELETE hold financial coordination.
- Frontend: 51 targeted tests across booking/payment flows, event flows,
  pricing and scrolling; lint, typecheck and build passed. Scroll test covers
  append/deduplication, later-page failure/retry and stale-filter abort.
- Browser: actual authenticated history loaded 20 -> 26 entries without page
  controls; Cancelled category contained two entries. A cancelled detail showed
  zero timers and zero continue-checkout links. No existing booking was changed
  by browser verification.
- Prisma validation/generation and git diff whitespace check passed. No schema
  edit or migration on cinehook_dev. Temporary verification services stopped
  after tests; all test data retained. No commit, push or deployment.

Financial provider transport in tests is controlled: no real money moved.
Tax policies on cinehook_dev still number zero. Unconfigured provider keys and
reviewed tax settings remain separate external blockers, not passing live checkout.
