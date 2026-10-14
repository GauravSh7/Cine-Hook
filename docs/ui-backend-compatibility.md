# Screenshot UI refresh: compatibility review

Reviewed: 2026-10-08. The user has now approved persistent Profile/Wishlist and
Cloudinary uploads. Development target is cinehook_dev on existing port5432,
not an assumed5434 instance. Help & Support is only a future chatbot placeholder.
The inspection below preserves the pre-approval findings; current implementation
and database-permission status are in [progress](implementation-progress.md).
No product/schema/data changes occurred during the inspection itself.

## Visual source and scope

The user's eight attached screenshots supersede the earlier MagicPath reference
where they differ. They establish the dark cinematic header, red/white brand,
search and city controls, category navigation, menu, image cards, footer,
two-column authentication, booking-history cards and account layout. Screenshot
8 also establishes Offers, Wishlist and the location dialog. Sample names,
dates, promotions, payment methods and booking statuses in those images are
design examples, not live product data or instructions.

The user explicitly deferred Help & Support. Do not implement a chatbot or a
working support action. Store date of birth, never a permanent age; calculate
age for display. Offers categories must never collect/store financial details.

## Current backend compatibility

| Screen / flow | Existing support | Boundary |
| --- | --- | --- |
| Movies and search | GET /api/movies and /api/movies/:id; search/language/genre/pagination | No ratings, popularity, cast, certification, trailer or backdrop field |
| Location | GET /api/cities; shows/theatres filtered by cityId | Selector may contain only real API cities; browser location is not required |
| Show/seat selection | GET /api/shows, show detail/seats/availability | UTC date filters; permanent physical layout; real per-seat-type prices |
| Booking/checkout/ticket | Existing owner Booking and Payment APIs | Server quote/expiry, verified provider evidence, CONFIRMED booking required for ticket |
| My Bookings | GET /api/bookings and /api/bookings/:id/summary | Movie bookings only; tab counts must reflect data actually fetched, not invented totals |
| Cancellation/refunds | Existing owner cancellation/refund APIs | Existing cutoff, full-refund, pending/retry and evidence rules remain unchanged |
| Login/Register | Existing Auth APIs and GET /api/auth/me | Email/password only; no phone login, social login, reset or remember-me contract |
| Account | Current user name/email can be displayed | No DOB/phone/avatar fields or profile-update route |
| Wishlist | None | Requires a persistent owner/movie relation and APIs for cross-device saves |
| Offers | None | Category filters can be UI-only; no invented offers, coupon application or discounts |
| Stream / Events / Sports / Activities | None | Truthful unavailable/empty sections only; no fabricated watch/book actions or live listings |

Evidence: [schema](../backend/prisma/schema.prisma),
[Auth routes](../backend/src/modules/auth/auth.routes.ts),
[catalog routes](../backend/src/modules/catalog/catalog.routes.ts),
[show routes](../backend/src/modules/shows/show.routes.ts),
[booking routes](../backend/src/modules/booking/booking.routes.ts),
[payment routes](../backend/src/modules/payments/payment.routes.ts),
[refund routes](../backend/src/modules/refunds/refund.routes.ts), and
[UI read routes](../backend/src/modules/ui-read/ui-read.routes.ts).

All existing financial modules stay unchanged. New modules, if approved, retain
Route -> Middleware -> Controller -> Service -> Repository -> Prisma -> PostgreSQL.
Do not add browser totals, paid/refunded flags or method fields to strict payment
payloads. Razorpay continues to own actual payment-method entry.

## Proposed minimal new contracts — not implemented

Recommended scope is the approved screenshot styling plus existing movie flows,
small persistent Account/Wishlist additions, and truthful unsupported-category
screens. An alternative with no schema changes could provide read-only Account
and an unavailable Wishlist; it would not satisfy persistent profile/saves.
Building every entertainment category is a separate domain expansion and is not
recommended for this integration pass.

- Account: nullable dateOfBirth (PostgreSQL DATE), optional unverified/nonunique
  international-format phone and a profile-picture reference. Owner-only profile
  update accepts a strict subset of name/DOB/phone/avatar fields. Reject future
  or invalid DOB; serialize YYYY-MM-DD and derive age on display. Keep email
  read-only; changing login identity requires a separate verification policy.
- Avatar decision: first-party avatar presets avoid an upload/storage contract;
  uploaded personal photos require owner-scoped, validated Cloudinary upload
  support and its local credentials. Do not implement a fake save/upload.
- Movie wishlist: userId/movieId/createdAt with unique (userId,movieId), protected
  paginated GET and idempotent PUT/DELETE APIs. Owner comes from JWT, never a
  submitted userId. New saves require an active movie; previously saved disabled
  movies stay visible as unavailable/removable, not bookable.
- Offers: All, UPI, Net Banking, Credit Card and Debit Card filters with explicit
  no-active-offers state. No card numbers, CVV, bank accounts, UPI IDs, expiry or
  saved-payment-method table. Real promotions need a later eligibility/discount
  contract. No fake percentages or redemption action.
- Other new category pages: consistent cinematic section layouts and clearly
  unavailable content. No stale 2024/2025 events presented as current inventory.

## Development seed and target safety

There is no development seed command today. The old browser fixture is not a
development seed: it requires an empty isolated test DB, uses fixed 2099 shows,
null posters, shared test-only passwords and a controlled provider. Do not use
that fixture or its fake checkout in the populated development app.

Proposed seed: an explicit development-only command with a declarative manifest,
stable seed IDs, real movie metadata and verified matching poster references,
real city names, clearly demo theatres, complete layouts and a future rolling
show horizon. Same-day reruns create no duplicate inventory; later reruns append
upcoming days without rescheduling existing shows or altering bookings.

The script must fail before writes unless development mode and the approved
exact loopback host/port/database are supplied. Serialize concurrent runs, create
missing records only, and abort ambiguous ID/email/layout collisions. Reuse
existing city/venue unique identities without overwriting user data. A dedicated
development ADMIN uses an explicitly supplied strong password, bcrypt hashing
and a reserved identity; never promote existing users or reset passwords on rerun.
Never hardcode/log credentials or run the seed on startup or in production.

Database SQL guards require READ COMMITTED, complete layouts before scheduling,
exact seat-type prices in the Show transaction and duration-derived end times.
After any Show exists, even INSERT on Seats is forbidden: skipDuplicates is not
a safe rerun strategy. Verify an existing layout and perform zero seat writes.
These rules are in the existing
[Shows/Seats migration](../backend/prisma/migrations/20261006000300_shows_seats/migration.sql).

The exact development database is not established by the repository. Compose
defines a template on 5432 named cinehook; the previous integration tests used
separate temporary test databases. Neither establishes which database the user
wants populated now. Recommend a separate persistent cinehook_dev database on
loopback, preserving the existing 5432 data. Confirm host/port/name before any
migration or seed. Do not request passwords in chat.

Once approved, use explicit target selection and reviewed additive migration
deployment, never reset/db push or drift-driven development migration against
existing data. Test seed-twice, preservation/collisions, concurrent runs, future
dates/layout/prices and ADMIN password preservation with live PostgreSQL guards.

## Next checkpoint

Resolve the minimal profile/movie-wishlist scope, avatar mode and database target.
Then implement screenshot layouts and approved compatibility additions, the safe
seed and regressions; run the seed against the confirmed development database,
exercise real Express journeys/responsive layouts, and document exact localhost
launch commands. No new verification result or populated-app claim is made here.
