# CineHook

CineHook is a full-stack movie ticket booking platform inspired by BookMyShow.

The project is being built with a production-oriented approach, focusing not only on features but also on system design, concurrency, authentication, payments, scalability, testing, and deployment.

## Core Flow

Movie Discovery → Theatre & Show Selection → Seat Selection → Temporary Seat Lock → Payment → Booking Confirmation → Digital Ticket

## Tech Stack

### Frontend
- React
- Vite
- TypeScript
- Tailwind CSS

### Backend
- Node.js
- Express.js
- TypeScript

### Data Layer
- PostgreSQL
- Prisma ORM
- Redis

### External Services
- Razorpay — Payments
- Cloudinary — Media Storage

### Infrastructure
- Docker
- Vercel
- Render / Railway / AWS

## Key Engineering Features

- JWT authentication and authorization
- Redis-based temporary seat locking
- Double-booking prevention
- PostgreSQL transactions and constraints
- Razorpay payment verification
- Failure recovery
- Stateless backend architecture
- Scalable system design

## Project Status

- Requirements — Completed
- High-Level Design — Completed
- Planning — Completed (HLD, database/API design, critical flows, LLD, UI/UX)
- Implementation — Foundation, Authentication, Catalog/Venues and Shows/Seats
  implemented. Booking/Redis, Payments/Webhooks and Cancellation/Refunds pass
  unit and live PostgreSQL/Redis verification. Approved UI integration is
  implemented with the latest approved cinematic redesign, 30 development movies,
  owner profile/wishlist and configuration-gated Google sign-in. On 2026-10-10,
  616 backend tests, 155 frontend tests, 73 native integration tests, 6 seed/smoke
  checks and 125 responsive browser states passed. Additional refinements include
  midnight-aware DOB age, customer FAQs, focused financial details, a 5-second
  carousel, persisted bilingual movie summaries and 24 read-only DEMO listings.
  Actual provider-account
  charges, Google sessions, Cloudinary delivery and Docker/CI execution are not
  claimed. See [current handoff and evidence](docs/refinement-handoff.md),
  [changed files](docs/refinement-files.md) and [blank provider-key checklist](docs/provider-setup.md).

## Local development

Use Node.js 24 LTS (24.14 or newer in the 24 series) and npm.
Keep frontend and backend as separate npm projects.

For this existing checkout, use the verified local PostgreSQL service on 5432 and
Redis on 6379. The isolated `cinehook_dev` database already exists and is populated;
do not reset/recreate it or migrate the original `cinehook` database. Do not start
Compose PostgreSQL over the existing 5432 service. See [safe setup](docs/development-seed.md).

In `backend/`:

```sh
npm ci
```

Only on a new installation, copy `backend/.env.example` to `backend/.env`.
Do not overwrite existing local configuration. Generate a signing key with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
and set `JWT_SECRET` in the ignored `backend/.env` file. Never share that value.
Then run in `backend/`:

```sh
npm run db:generate
npm run dev:db:check
npm run dev:db:migrate
npm run db:seed:dev
npm run dev:content:seed
npm run dev:populated
```

In another terminal, run in `frontend/`:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open [CineHook locally](http://localhost:5173). Keep both terminals running.
Vite forwards `/api` requests to port 4000. For an ordinary restart, just run
`npm run dev:populated` in backend and the frontend launch command above.
If you change the backend port, update the Vite proxy target as well.
Tailwind is installed through its Vite plugin. The approved dark/red CineHook UI
uses real catalog, booking, payment/refund and current-role admin APIs.

Docker is an optional separate environment, not a prerequisite for the existing
native development database. Compose credentials are local examples, not
production secrets. To run the API in Docker:

```sh
docker compose --profile app up --build -d
```

For the Docker API, supply `JWT_SECRET` in your local shell or ignored root
`.env`; Compose does not read `backend/.env`. Apply database migrations
separately using `npm run db:deploy` in `backend/` with the local DATABASE_URL.
The image runs as a non-root user and excludes local environment files.
The migrations create users/roles, catalog/venues, Shows/physical Seats and
priced Bookings/permanent confirmed allocations and financial payment/evidence/
webhook/reconciliation records, plus full-source refund obligations and attempts.
The catalog migration
enables PostgreSQL's bundled `citext` extension for case-insensitive venue names;
the migration database user needs permission to enable that extension.

## Foundation request flow

```text
GET /api/health/live
  -> request ID / security / CORS middleware
  -> HealthRoutes -> HealthController -> 200 (process is alive)

GET /api/health/ready
  -> middleware -> HealthRoutes -> HealthController -> HealthService
  -> HealthRepository -> Prisma -> PostgreSQL SELECT 1
                      -> Redis PING
  -> 200 if both are up; 503 otherwise (bounded health timeout)

Unknown route / invalid JSON / unexpected error
  -> global error middleware -> safe JSON error + request ID
```

Liveness means the process is running; readiness means it can serve requests
that need both shared dependencies. HealthRepository probes infrastructure only.
Business repositories will access PostgreSQL; SeatLockService owns Redis locks.
No bookings, sessions, or seat locks are stored in backend process memory.

`app.ts` assembles HTTP middleware and routes. `server.ts` creates shared clients,
starts the listener, and closes resources on shutdown. Controllers own HTTP;
services return data and enforce business decisions; repositories own I/O.
Express 5 forwards rejected async handlers to the global error middleware.
The dedicated Razorpay webhook route uses raw body parsing before the generic
JSON parser so signature verification uses the original bytes.

## Checks

In `backend/`:

```sh
npm run db:generate
npm run db:validate
npm run typecheck
npm test
npm run build
npm audit
npm run test:smoke
```

In `frontend/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

GitHub Actions supplies the existing build/backend checks; the frontend UI
test/typecheck commands above are local gates added by this module. The workflow
was not changed or executed remotely for UI verification. HTTP tests inject only the
external health checks; they exercise the real HTTP middleware, controllers
and services. They do not prove live database/Redis or Docker connectivity.

Auth HTTP tests use real bcrypt/JWT and a test-only repository replacement.
CI starts disposable PostgreSQL and Redis services, applies migrations, then
runs `npm run test:integration` against the real repositories and lock scripts.
Locally, the integration test skips unless `AUTH_TEST_DATABASE_URL` points to
an explicitly migrated disposable database whose name ends in `_test`.

## Authentication

| Endpoint | Request | Access | Result |
| --- | --- | --- | --- |
| POST /api/auth/register | name, email, password | Public | 201 + user/accessToken |
| POST /api/auth/login | email, password | Public | 200 + user/accessToken |
| GET /api/auth/me | Authorization: Bearer token | Protected | 200 + current database user |

Email is trimmed/lowercased. Passwords are never trimmed; registration accepts
8 characters through 72 UTF-8 bytes. Only bcrypt hashes are stored. Requests
cannot assign roles. No passwords/hashes appear in responses or JWTs.
JWT lifetime defaults to one hour; missing/invalid/expired tokens receive 401.
No logout/refresh/revocation endpoints are part of this module.
See `docs/authentication.md` for file responsibilities, request flows and checks.

## Catalog and venue APIs

Public:

```text
GET /api/movies?search=&language=&genre=&page=1&limit=20
GET /api/movies/:id
GET /api/cities?page=1&limit=20
GET /api/theatres?cityId=&page=1&limit=20
GET /api/theatres/:id
```

Lists return `data: { items, page, limit }`. Filters combine with AND.
Disabled movies are absent from public lists/details. Theatre detail includes
its city and screens. Search is a case-insensitive literal title substring.

ADMIN (Bearer JWT and current database ADMIN role):

```text
POST   /api/admin/movies
PATCH  /api/admin/movies/:id
DELETE /api/admin/movies/:id
POST   /api/admin/cities
POST   /api/admin/theatres
PATCH  /api/admin/theatres/:id
POST   /api/admin/screens
PATCH  /api/admin/screens/:id
```

Movie create: title, description, durationMinutes (1-600), releaseDate
(YYYY-MM-DD), language, genres (1-10), optional HTTPS posterUrl.
City create: name, state, optional countryCode (default IN).
Theatre create: name, address, cityId.
Screen create: name, capacity (1-1000), theatreId.
PATCH accepts only provided mutable fields and rejects empty/unknown fields.
Movie DELETE is an idempotent soft-disable, not physical deletion.

City identity is name/state/country; theatre names are unique within a city;
screen names within a theatre. Movie titles are not unique (remakes/versions).
Catalog and Shows/Seats use PostgreSQL only. Booking separately combines Redis
holds with PostgreSQL allocation. See `docs/catalog-venues.md` for the full
file list, schema relationships, request flows, decisions and verification.

## Shows and physical seats

```text
GET  /api/shows?movieId=&cityId=&theatreId=&date=&page=1&limit=20
GET  /api/shows/:id
GET  /api/shows/:id/seats
GET  /api/screens/:id/seats
POST /api/admin/shows
POST /api/admin/screens/:id/seats
```

Physical seats belong to a Screen and are unique by row/number within it.
They have REGULAR/PREMIUM/RECLINER types, not availability/lock/booking status.
An ADMIN initializes a complete layout matching capacity before scheduling.
Each Show has normalized prices for its present seat types, in integer INR paise.
Timezone-aware start input becomes UTC; the end time snapshots movie duration.
PostgreSQL prevents overlapping SCHEDULED shows, including concurrent requests.
Layout/capacity/venue identity cannot change while dependent shows remain.

Shows lists are upcoming-only; `date` is a UTC calendar day. Show seats include
that show's prices but do not claim current bookability. The separate availability
API below adds Redis/Booking state; Payment does not change physical Seats. Protected
Show/layout database writes require READ COMMITTED;
the migration installs bundled `btree_gist` for interval exclusion. Review and
apply migrations only to your intended database; local verification used a
separate disposable test database, not the existing user database.

See [Shows/Seats notes](docs/shows-seats.md) for examples, exact flows, all changed
files, choices and verification.

## Booking and Redis holds

```text
GET    /api/shows/:id/availability       public
POST   /api/bookings                    authenticated
GET    /api/bookings?page=1&limit=20     authenticated, own history only
GET    /api/bookings/:id                authenticated, owner only
DELETE /api/bookings/:id/hold            authenticated, unpaid hold release only
```

Create body: `{ "showId": "UUID", "seatIds": ["UUID"] }` (1-10 distinct seats).
Browser prices/totals, user IDs and status fields are rejected. A successful
creation returns a PENDING booking with server-derived per-seat price snapshots,
`totalPaise` and the exact Redis five-minute `expiresAt` deadline.

Temporary locks exist only in Redis. Atomic Lua acquisition is all-or-nothing,
keyed by Show/Seat; owner-checked release includes a booking UUID fence. Holds
are never implicitly renewed. Availability returns BOOKED, LOCKED or AVAILABLE
and remaining hold milliseconds, without owner data. Physical Seat rows still
have no availability status. PostgreSQL uniquely allocates confirmed Show/Seat
pairs and preserves quote history. All pooled API database sessions use UTC.

There is no public confirmation route or browser-supplied paid flag. Trusted
BookingService confirmation is called internally only by verified payments. Releasing
a PENDING hold makes it FAILED/HOLD_RELEASED, not financially CANCELLED. Expired
or lost holds cannot confirm. Redis failures return safe 503 responses without
an optimistic in-memory fallback. Permanent confirmed allocations survive Redis
loss. See [Booking/Redis notes](docs/booking-redis.md) for exact flows, files,
database guards, race/expiry tests, compensation and remaining boundaries.

For live verification after a build, supply explicitly migrated disposable
database URLs whose database names end in `_test`, and an isolated Redis DB 15:

```text
AUTH_TEST_DATABASE_URL       Auth/Catalog/Shows/native Booking suites
BOOKING_TEST_DATABASE_URL    combined Booking API/PostgreSQL/Redis suite
SEAT_LOCK_TEST_REDIS_URL     Redis suites (URL must end in /15)
PAYMENTS_TEST_DATABASE_URL   native Payments and combined Payment API suites
REFUNDS_TEST_DATABASE_URL    native Refunds and combined Cancellation/Refund API suites
```

Then run `npm run test:integration` in `backend/`. Suites skip when their URLs
are absent; a skipped run does not prove live behavior. Tests use run-specific
rows/keys and remove only their fixtures, never FLUSHDB or a database reset.
Do not point these tests at your normal database. CI configuration is supplied
but has not been run remotely. Payments provider HTTPS is replaced by a controlled
transport while its actual adapter, signatures, services, PostgreSQL and Redis run.

## Payments and Razorpay webhooks

```text
POST /api/payments/order       owner JWT; { bookingId }
POST /api/payments/verify      owner JWT; { bookingId, razorpay_order_id,
                                razorpay_payment_id, razorpay_signature }
POST /api/webhooks/razorpay     raw JSON + X-Razorpay-Signature + X-Razorpay-Event-Id
```

Order amount comes from the immutable server Booking quote, never browser totals.
Persisted receipt/order identity recovers a lost provider response. Checkout HMAC
is verified with the stored server order ID, then actual provider capture is
checked. Webhook HMAC verifies exact raw bytes with a separate secret. Captured
webhooks recover a closed browser; authorization alone never confirms a ticket.

Payment.status describes money: PENDING, SUCCESS, FAILED, REFUND_PENDING and
REFUNDED. Verified capture first becomes SUCCESS even if ticket fulfillment
fails; captured financial evidence is retained during subsequent returns. Financial evidence commits first;
trusted BookingService.confirm then uses a shared short final transaction for
Booking/allocation and fulfillment disposition. Provider calls occur outside
transactions; Redis cleanup occurs after commit. Event/payment identities and
finalization markers prevent repeated delivery/verify from allocating twice.

Expired/released/lost holds are never renewed or reacquired. Captured-but-unfulfilled
payments get a durable full-source refund obligation after the failed disposition;
transient outages leave unfinished fulfillment retryable. Unknown external refunded
state is rejected for reconciliation rather than fulfilling from an earlier capture.
Known local refunded sources only poll refund progress, never confirm. Read Booking status to determine
ticket fulfillment; Payment SUCCESS alone is insufficient.

In your ignored environment/secret manager, set all three values together:
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET. With none, Payment
APIs fail closed with 503 while other modules remain usable. API secrets are
provider-issued; choose a strong webhook secret (at least 32 characters).
Do not expose either secret through VITE_* variables. Docker Compose currently
does not forward these optional module credentials: configure them through your
deployment secret settings before using containerized Payment APIs.

Configure automatic capture and a reachable HTTPS webhook URL ending in
`/api/webhooks/razorpay`, subscribing to payment.captured, order.paid and
payment.failed, refund.created, refund.processed and refund.failed.
Provider capture timing does not extend our five-minute hold.
Dashboard setup, real Razorpay account test-mode orders and internet webhook
delivery remain unverified. UI Checkout now invokes the existing order/verify
APIs and rereads backend booking state. Its local browser journey used a clearly
labelled controlled SDK/provider; no real charges were used.

See [Payments/Webhooks notes](docs/payments-webhooks.md) for the exact 19-created/
13-changed file inventory, request flows, database guards, recovery, decisions,
review regressions and historical verification evidence.

## Cancellation and refunds

```text
POST /api/bookings/:id/cancel         owner JWT; {}
POST /api/bookings/:id/refund/retry   owner JWT; {}
GET  /api/bookings/:id/refunds        owner JWT
POST /api/admin/refunds/reconcile    current database ADMIN; {}
```

The owner may cancel a confirmed ticket strictly before show start, using trusted
database UTC time. At/after start, reject new cancellation. A successful transition
atomically removes permanent ConfirmedSeat allocations, retains BookingSeat price
history, and records full captured-amount refund intent. It does not depend on Redis.
Repeated already-cancelled requests reuse existing obligations, including after start.

Booking remains CANCELLED if the provider is unavailable; Payment remains
REFUND_PENDING until verified processed refund evidence makes it REFUNDED.
Cancellation refunds 100%, without fees/deductions. Captured-but-unfulfilled tickets
receive full compensation regardless of show time without revival or seat reacquisition.
Each distinct captured source has one immutable refund obligation. Extra captures on
a valid confirmed ticket are refunded separately, preserving its primary funding/seats.

Provider requests run outside database transactions. A persisted attempt UUID supplies
the refund receipt/idempotency key; unknown outcomes retry the identical body/key.
Pending provider IDs are fetched. New attempts require current verified provider
failure and a serialized state recheck. Webhooks verify the original raw bytes and
bind all financial/provider/event identities. No client amount or refund-success flag.

GET refunds shows durable obligations/attempts and safe error codes. Owner retry or
ADMIN reconciliation recovers pending work after outages; each fair batch examines
at most 20 payments. There is no background worker yet: operators must run batches
regularly for unattended obligations. resolvedAt distinguishes resolved reconciliation
from its retained historical compensationRequired flag. Unsupported partial/manual/
external refunds require operator reconciliation, not guessed local completion.

Availability now inspects every physical seat before its final permanent-allocation
reread, fixing cancellation/rehold of a seat that was initially booked. It remains
an advisory snapshot; actual reservations enforce Redis/PG concurrency independently.

Fresh local checks: 362 unit tests, 68 live integration results (none skipped), 2
compiled-server smoke tests, typecheck, Prisma validation/generation/six-migration
status, backend/frontend builds, frontend lint, and zero vulnerabilities in both
audits. Actual Razorpay test-mode/refund settlement, internet webhook delivery,
Docker and remote CI remain unverified. No real provider money requests were made.

See [Cancellation/Refunds notes](docs/cancellation-refunds.md) for every created/
changed file, request flows, native guards, state/recovery decisions and review
regressions. That module stopped before UI integration; UI work is recorded below.
Nothing has been committed or pushed.

## Approved UI integration

Public routes cover movies/shows/seats, login/register, server-quoted checkout,
confirmed ticket print, owner history, cancellation and refund recovery. Admin
routes cover dashboard, movies, shows, global bookings/payments and existing
refund reconciliation. The new read endpoints are:

```text
GET /api/bookings/:id/summary          current owner; historical metadata/payment/refunds
GET /api/admin/dashboard              current database ADMIN
GET /api/admin/movies                 includes disabled movies
GET /api/admin/shows                  includes historical/cancelled shows
GET /api/admin/bookings               server-wide, bounded/searchable
GET /api/admin/payments               payment/reconciliation/refund facts
```

Only backend CONFIRMED creates a ticket; SDK success is followed by server
verification and a current summary. Amounts and five-minute expiry come from the
server. Unsupported trailers/ratings/coupons/fees, password reset, show editing
and admission QR features are disabled or omitted. Ticket download uses browser
print/Save as PDF. Session-scoped JWT restores through `/me`.

Fresh 2026-10-08 checks: 56 frontend tests, 409 backend unit tests, 68 live
integration results (zero skipped), two smoke tests, 42 responsive screen states,
frontend lint, both
typechecks/builds, Prisma validate/generate/six-migration status and zero audit
vulnerabilities. Real local booking/payment/cancellation/refund and admin journeys
used isolated test persistence and controlled external provider I/O. Actual
Razorpay account/settlement, Docker and remote CI remain unverified.
See [UI integration study notes](docs/ui-integration.md) for every module file,
request flow, source/design decisions, screenshot evidence and remaining limits.

`.env` and all `.env.*` files are ignored except `.env.example`.
Generated Prisma clients, dependencies and build output are also ignored.
Never place private keys in browser-side `VITE_*` values.

## Implementation sequence

Operational checks, auth rate limits, monitoring setup and the next manual release:
[Pointer 2 operations](docs/pointer2-operations.md).

Foundation -> Auth -> Movies/Theatres/Screens -> Shows/Seats -> Booking and
Redis locking -> Payments/webhooks -> Cancellation/refunds -> UI integration.
BookingService, SeatLockService and PaymentService remain separate modules.
See `docs/implementation-foundation.md` for inspection, decisions and checks.
See [implementation progress](docs/implementation-progress.md) for the current
module ledger, verification evidence, architecture gates and next steps.
