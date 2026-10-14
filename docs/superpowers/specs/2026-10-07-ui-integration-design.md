# CineHook approved-design UI integration

User-authorized implementation, 2026-10-07. Existing approved visual design and
architecture are binding; not a redesign. Continuous module implementation and
no-commit/no-push instructions supersede routine skill approval/commit/worktree
menus. Keep existing uncommitted modules in this checkout.

## Visual source and scope

https://designs.magicpath.ai/v1/serene-flood-9884 was accessible in the in-app
browser and the authenticated read-only MagicPath integration. Verified project
458212679702687744, component458212875450880000, pinned revision458212875450880001
('CineHook Complete UI'). Complete reference component source/style and native
render were read. No remote designs are edited. No synced sources are modified.

Reproduce background #0b0b0f, panels #15151c, inputs #1b1b24, borders #2a2a34,
muted #a6a6af, red #e50914, white typography; rounded panels/cards/buttons and
original spacing/grid/hero/header/checkout/ticket/admin-sidebar composition.
Public pages max1280px, header80px; cards 1/2/4 columns at mobile/tablet/desktop.
Seat targets min44px; scrollable row grid on small devices, never shrink all
seats into unusable touch targets. Responsive admin navigation/table scrolling.

Sequence: Home/movies -> Movie/show selection -> Seats -> server-created hold ->
Checkout/Razorpay -> authoritative booking outcome/ticket -> My Bookings/refunds
-> Login/Register -> approved admin surfaces. Implement auth plumbing early as a
dependency, not a different visual product. Screens use real API data only.

## Boundaries

Typed API client/domain DTOs separated from React pages. React Router keeps
reload/back/deep-link paths. Session-scoped JWT storage (not passwords), /me
revalidates identity after reload; close/reopen can log in and recover server
bookings. Logout clears token/session-sensitive state; expired tokens require
reauthentication. No backend sessions/process-local locks.

Client selection prices are not totals: per-seat API labels only; total becomes
trusted Booking.totalPaise after POST. Countdown uses backend expiresAt and
response Date clock offset; zero/lost hold disables checkout and refreshes state,
never renews. Selection is not a hold until POST succeeds. Refresh availability
with bounded polling/focus refresh; no WebSocket/SSE/waiting room/work queues.

Razorpay SDK loaded from official checkout URL. Options key/order/amount come
from POST order; callback signature is sent to backend verify. Never render
success from SDK alone. Failed/uncertain verification links to backend recovery;
authoritative summary is polled on result/reload. CONFIRMED, not merely Payment
SUCCESS, controls ticket validity. Expired/lost capture can require full refund.
Cancellation and returns use existing endpoints, immutable totals, no client
amount/state. Ticket is a print/download view of backend state, not an invented
QR or admission validation system.

## API alignment (ordinary read extensions, no new domain states/schema)

Existing public catalog/shows/availability/auth/booking/payment/refund writes
remain unchanged. Add owner GET /api/bookings/:id/summary for coherent booking,
historical show/venue/movie metadata (including disabled movies), nullable payment
and refunds. BookingService observes hold validity first; read repository locks
Booking before financial read, never calls provider/Redis in its transaction.

Add current-DB-ADMIN GET /api/admin/dashboard, /movies, /shows, /bookings, /payments.
Read-only UiReadController -> UiReadService -> UiReadRepository -> Prisma -> PG.
Paginated lists20/max100, safe text/UUID filters, explicit public DTOs without
password/hash/JWT/credentials. Admin movie lists include disabled; shows include
past/cancelled; booking/payment views are server-wide, not admin's own history.
Dashboard counts are DB-derived; last card says 'Captured today' (primary Payment
capturedAt UTC day, not net settlement/revenue; extra capture/refund accounting
is visible separately). No financial transitions or new migrations in this work.

Prototype unsupported features: no invented ratings/popularity ranking/trailer,
coupon, convenience fee, password reset, scheduled-show editing or QR validation.
Use disabled/explanatory states preserving composition. Near-you cards derive
actual city shows, not fabricated popularity. Date filtering labels UTC contract;
human show times display IST (Asia/Kolkata) explicitly; admin scheduling input
and date filters remain UTC. Report every deviation in notes.

## Testing / release boundary

TDD for API payload/errors, hold clock, state interpretation, auth, selection,
checkout failure/recovery, cancellation/refund, admin permission/read projections.
Only external persistence/HTTP/SDK I/O replaced in unit tests. Live journey uses
isolated loopback *_test PG/Redis and actual backend with controlled Razorpay
adapter transport. A test-only browser fixture supplies a clearly labelled fake
SDK/provider to test capture/verify/refund; never served by production server.
Actual account test-mode capture/internet webhook/settlement remains unverified.
No real charges, secrets/env edits, user DB writes/reset, commit/push.

Check frontend lint/typecheck/test/build, backend regressions+Prisma checks,
responsive390/768/1440 widths, actual local user/admin journeys, error/empty/
retry/disabled/skeleton states and keyboard semantics. Update progress/module
notes with exact files/evidence/differences. Stop at first-pass UI checkpoint;
defer all requested later scalability upgrades.
