# Targeted product refinements — 14 October 2026

- All 30 existing movies have matched TMDB ratings. Repeat import: cached30,
  updated0; nonrating fields preserved. Refresh: backend `npm run catalog:ratings:tmdb`.
- Existing location dialog offers State → City and user-triggered geolocation.
  Nearest supported city is staged until Save; no coordinate storage/external
  reverse lookup. Denial/stale requests never overwrite manual choices.
- Cinema screen lighting/reflections and capacity-based visual variants; stadium
  floodlights/stands/fields; smaller stages/workshop areas. Physical inventory
  and availability unchanged. 390px/1440px checks: no page overflow.
- Events/Sports/Activities now share server-priced coupons, bills and opt-in
  Razorpay TEST checkout. Approved flat18% included tax is only an assumption,
  not verified legal GST. FIRST50/SAVE10 and new-booking fee waiver preserved.
  Stream has no fabricated booking domain. Test-bill label remains visible.
- Failed provider evidence atomically cancels only pending bookings; dismissal
  asks the backend to cancel. Expiry becomes Cancelled on normal status/history
  reads. Redis TTL independently frees holds. Captures before/during/after
  cancellation retain full refund obligations. No records/history deleted.
  No-payment FIRST50 reservations release; issued orders with uncertain outcomes
  remain fenced until resolved, because an attempt failure does not close an order.
- Google button opens accounts.google.com; personal sign-in not performed.
  Current localhost origin matches configured frontend; no provider settings changed.

## Changed files

- backend/src/config/env.ts; src/server.ts; scripts/dev-launch.ts
- backend/src/modules/pricing/{pricing-engine.ts,pricing.repository.ts,cinema-simulation.ts,pricing.test.ts}; scripts/dev-pricing-simulation.ts
- backend/src/modules/payments/{create-payments.ts,payment.repository.ts,payment.service.ts}; modules/refunds/refund.types.ts
- backend/src/modules/booking/{booking.repository.ts,expired-checkout.ts}; modules/event-booking/event-booking.repository.ts; modules/catalog/movie.repository.ts
- backend/prisma/{dev-seed-tmdb-core.ts,dev-tmdb-ratings.ts}; package.json; tsconfig.seed.json; .env.example
- frontend/src/{components/EventVenueMap.tsx,pages/SeatsPage.tsx,index.css}
- frontend/src/{app/CityProvider.tsx,components/LocationDialog.tsx,domain/location.ts}
- frontend/src/{components/MovieCard.tsx,pages/MoviePage.tsx,pages/CheckoutPage.tsx,components/BookingFacts.tsx,components/CheckoutSeatPreview.tsx,domain/booking-target.ts}
- Targeted tests: backend payments-config, razorpay-test-checkout, pricing.integration,
  checkout-expiry.integration, catalog.repository, dev-seed-tmdb and dev-seed-tmdb-ratings;
  frontend booking-flow, location and venue-atmosphere.

Builds/typechecks and focused tests pass; isolated financial checks cover exact
refunds, coupon races and expiry compensation. Browser checked live ratings,
location confirmation, cinema/stadium sizing, FIRST50 bill and Razorpay opening.
Actual sports bill: ₹300 − ₹150 FIRST50 = ₹150, including ₹22.88 admission tax,
platform fee Free. No actual captured provider payment claimed. Renewed public
webhook URL requires Dashboard update: see razorpay-test-webhook.md.

Two unrelated older ui-polish test expectations were observed (old Total text
and unsanitized category-title wording); they were not rewritten or included in
the final focused pass. No full-suite run, commit, push, deploy or DB reset.
