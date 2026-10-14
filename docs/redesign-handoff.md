# CineHook redesign handoff

Status: approved implementation completed and locally verified on 2026-10-10;
not committed, pushed or deployed. Live provider setup is still required.

## Delivered

- Professional dark cinematic React/TypeScript/Tailwind interface based on the
  approved screenshots and handwritten changes.
- Real database-backed movie discovery, details, city/date/theatre shows, seat
  availability, five-minute holds, checkout recovery, bookings and refund states.
- 30 development movies with original illustrative local art, collection rails,
  source-aware metadata and a rolling, non-destructive demo screening seed.
- Authenticated editable profile (name, DOB, calculated age, phone, read-only
  email), guarded Cloudinary avatar integration, and owner-scoped movie wishlist.
- Backend-verified Google Identity Services integration. It remains visibly
  unavailable until a Google client ID is configured; no fake login exists.
- Focused seat/checkout/ticket layouts, mobile-local seat scrolling and honest
  unavailable shells for unapproved content domains.

## Authority boundaries preserved

The frontend never supplies an authoritative price, paid flag, refund amount or
refund-success state. Redis remains the temporary lock authority and PostgreSQL
remains the permanent allocation/financial-history authority. Existing booking,
payment, webhook, compensation, cancellation and refund state machines were not
weakened. Profile images go through the backend; no card, UPI or bank credentials
are collected for Offers.

## Verified local inventory

`cinehook_dev` on local PostgreSQL 5432 contains 8 migrations, 30 movies,
3 cities, 3 demo theatres, 6 screens, 288 seats, 102 retained shows and 306 price
rows. Of these, 96 shows are future screenings at this checkpoint; every movie
has at least one future show somewhere in the supported cities. The Oct10 run
appended 12 shows/36 prices without deleting old schedules; its immediate rerun
added zero records. The original `cinehook` retains six migrations and its
unchanged empty-table fingerprints. It was not migrated, seeded, reset or deleted.
See [database evidence](verification/database-report.json).

## Verification evidence

- Backend unit/HTTP: 581 passing tests in 33 files.
- Frontend: 108 passing tests in 12 files.
- Native integration: 73 PostgreSQL/Redis tests, 2 seed tests and 2 runtime
  smoke tests passed with zero failures/skips.
- Backend/frontend typechecks and builds, frontend lint, Prisma validation and
  generation passed. Both dependency audits reported zero vulnerabilities.
- Real-browser checks passed for populated movie/show discovery, city search/
  save, menu, carousel rotation, keyboard Offers filtering, focused physical
  seats, login, persistent wishlist and profile save/reload including DOB/age.
- Actual PG/Redis plus the controlled Razorpay transport produced CONFIRMED
  tickets, CANCELLED + REFUND_PENDING, then provider-verified REFUNDED. A3/A4
  became selectable again. A genuine five-minute unpaid hold became FAILED;
  checkout redirected to the truthful expired state and B3 became available.
- The native raw-webhook test verifies browser-close recovery with no `/verify`
  call, alongside verify/webhook concurrency and payment/refund replay tests.
  Browser payment testing used the explicit LOCAL TEST CHECKOUT, not real money.
- The final 105-state responsive matrix covers nine public/focused routes, five
  authenticated account/history/refund routes, all five admin routes, checkout
  and confirmed ticket, at 320, 390, 768, 1024 and 1440 pixels. No page exceeded
  its viewport. The seat map and admin tables own intentional local scrolling.
  [Full measurements](verification/responsive-results.json).
- Correction to the earlier Oct9 summary: 320px initially overflowed because
  `body` had a 320px minimum width despite a narrower scrollbar-adjusted content
  area. That minimum was removed and the full matrix rerun. The final evidence,
  not that earlier blanket claim, is authoritative.

Audit initially hit registry DNS/reset errors; both independent retries returned
zero vulnerabilities. An integration attempt initially targeted an empty,
unmigrated task database; it was interrupted and all 73 tests were rerun on a
fresh, eight-migration `_test` database with zero failures/skips. No requirements
were changed. Native Prisma/pg integration emits a pg client-query deprecation
warning; tests pass on the pinned version, but it should be reviewed before a
future pg major upgrade. Browser warning/error logs were empty in the inspected
test tab. These are scoped checks, not a guarantee that software has no defects.

Razorpay, Cloudinary and Google provider credentials are not present locally.
Their unavailable states are intentional. Native tests use controlled provider
adapters and do not claim real charges, refunds, uploads or Google sessions.

## Launch

In one PowerShell terminal:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
npm run dev:db:check
npm run dev:db:migrate
npm run db:generate
npm run db:seed:dev
npm run dev:populated
```

In another:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\frontend"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. Do not replace the guarded development scripts
with a reset or a migration command aimed at the original database.

At final handoff the normal frontend (5173), backend (4000), original PostgreSQL
service (5432) and normal Redis (6379) remain running. After stopping the isolated
test servers on 55438/55439/55440, a fresh check returned frontend HTTP 200,
backend readiness success and 30 movies through the frontend API proxy. The
temporary PostgreSQL databases/files were retained; no database was dropped.
The test Redis was shut down with NOSAVE. Keep the app terminals open; an
ordinary restart only requires the two start commands above, not reseeding.

The browser-only QA user and its wishlist row were deleted after verification.
That cleanup affected only data created for this check and is not recoverable;
no pre-existing user or booking data was removed.

## Models and APIs

The latest migration is `20261009000800_catalog_google`. It adds nullable unique
Google subject identity and allows Google-only users to have no password hash;
existing bcrypt hashes/roles remain untouched. Movie gains backdrop, collections,
metadata/artwork provenance and a complete nullable rating tuple with SQL
constraints and a collections GIN index. No Show/Seat/Booking/Payment/Refund
state machine or Redis Lua protocol changed. Profile/Wishlist retain their
previously approved `20261008000700_profile_wishlist` migration.

| API | Source/authority |
| --- | --- |
| `GET /api/movies?cityId=&search=&language=&genre=&page=&limit=` | Active films plus selected-city future-show availability |
| `GET /api/movies/:id?cityId=` | Safe metadata, artwork attribution, verified rating or null |
| `GET /api/movies/:id/show-dates?cityId=` | Independent future-show dates, `Asia/Kolkata` |
| `GET /api/shows?movieId=&cityId=&localDate=` | Additive IST-day filter; old UTC `date` remains supported |
| `GET /api/auth/google/config` | Public configured client ID or null |
| `POST /api/auth/google/challenge` / `POST /api/auth/google` | Origin/CSRF/nonce and provider-verified identity |
| `PATCH /api/account/profile` | Authenticated name/DOB/phone only; no email/role/age write |
| `POST /api/account/avatar` | Authenticated multipart `image`; decoded/limited Cloudinary upload |
| `GET /api/wishlist/movies` | Paginated authenticated-user wishlist |
| `GET`, `PUT`, `DELETE /api/wishlist/movies/:id` | Owner-derived status/save/remove; unique user/movie pair |

All contracts use the existing success/error envelopes. Google setup/security is
documented in [google-auth.md](google-auth.md); profile/image constraints in
[account-wishlist.md](account-wishlist.md). Metadata facts/sources live in
`backend/prisma/dev-seed-manifest.ts` and `dev-film-expansion.ts`.

## Request/code flow

```text
Home/MoviePage -> catalogApi -> public catalog/show routes -> validation
  -> Movie/ShowController -> Movie/ShowService -> repository -> Prisma -> PG

SeatsPage -> bookingApi.create(showId, seatIds) -> auth/validation -> controller
  -> BookingService -> SeatLockService (atomic Redis hold) + BookingRepository
  -> PG price snapshot -> CheckoutPage uses server total and expiry

CheckoutPage -> paymentApi.order(bookingId) -> PaymentService -> PaymentProvider
  -> verified capture -> trusted BookingService.confirm -> short PG transaction
  -> BookingPage/BookingsPage poll authoritative owner summary

Cancel dialog -> bookingApi.cancel(id) -> existing RefundService/BookingService
  -> PG cancellation + allocation release + durable refund obligation
  -> provider outside transaction -> verified fetch/webhook -> refund state

AccountPage/WishlistButton -> separate API modules -> authenticated owner routes
  -> controller -> Account/WishlistService -> repository -> Prisma -> PG
```

Temporary lock state is not stored on physical seats or in server memory.
Browser prices are estimates only before server booking creation. No client
payment/refund-success flag or public booking-confirm route was introduced.
Backend financial evidence, immutable BookingSeat history and compensation rules
remain the authority. This matches the approved HLD/LLD boundaries.

## Visual deviations / intentionally unavailable features

- Original, clearly attributed CC0 illustrations replace official film posters/
  stills; the delivery does not scrape IMDb, fabricate ratings, or assume that
  Wikipedia fair-use artwork grants unrestricted reuse. The optional guarded
  TMDB importer is server-side/manual and preserves data on failure. No live
  import was performed. See [provider/source notes](plans/redesign-tmdb-import.md).
- Carousel uses only name/art/Book Now, per the latest handwritten notes; search
  is in discovery content, not the navbar. Wishlist is secondary on details/
  account rather than the homepage card's primary action.
- Theatre aisles are presentation-only because the physical-seat schema has no
  approved aisle geometry. Row names/numbers/types/IDs remain actual PG data.
- Stream/Events/Sports/Activities have themed layouts but no booking/streaming
  actions or invented live events. Offers categories show honest empty states.
- Help & Support is a labelled future chatbot. No fake response, social login,
  password-reset, saved-card, notification, 2FA or account-deletion workflow was
  added. Email remains read-only; no card/bank/UPI account details are stored.
- Google/Razorpay/Cloudinary provider credentials and production configuration
  remain operator prerequisites. The local app supports registration/login,
  catalog, seats/holds, profile and wishlist without simulating those providers.
- CI/Docker execution, deployment, scalability, queues, realtime updates,
  monitoring and load testing remain outside this approved delivery.

## Files and saved proof

[Complete current-task file inventory](redesign-files.md) distinguishes this
redesign from the pre-existing dirty checkout. Financial/concurrency source
files and `implementation-foundation.md` are unchanged relative to the saved
redesign baseline. No synced project reference or ignored `.env` was edited.

Screenshots: [desktop home](verification/home-desktop.jpg),
[mobile home](verification/home-mobile.jpg),
[confirmed mobile ticket](verification/ticket-mobile.jpg),
[refunded mobile booking](verification/refund-mobile.jpg).
Ticket/refund images are from isolated fixtures, not live purchases.
