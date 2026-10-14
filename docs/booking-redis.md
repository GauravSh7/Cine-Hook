# Booking / Redis: approved contract and implementation record

Approved: five-minute Redis-only seat holds, show-specific keys, authenticated
owner identity, owner-checked release, atomic all-or-nothing multi-seat acquire,
no implicit renewal, and PENDING/CONFIRMED/FAILED/CANCELLED permanent bookings.
PostgreSQL is final authority for permanent allocation. BookingSeat keeps Show,
physical Seat and the server-derived price snapshot; browser totals are rejected.
Availability combines physical layout, confirmed allocations and live Redis holds.
No Razorpay, webhook, refund or provider-specific late-payment handling here.
Stop at this critical module's checkpoint before Payments.

## Implementation design

BookingService coordinates policy, SeatLockService owns Redis Lua operations,
and BookingRepository owns Prisma/PostgreSQL transactions. There is no shared
lock/session state or fallback cache in the API process.

Redis keys use a show hash tag. Value is authenticated user UUID plus booking
UUID; the latter fences old holds from newer holds owned by the same account.
Lua checks all keys before writing, sets exactly 300000ms, derives expiresAt
from Redis TIME, and cleans already-created keys if a write command fails.
Validate/release never renew a TTL. Missing, foreign or expired holds cannot
confirm. Two-second command deadlines fail closed; an ambiguous sent command
may execute after timeout, so cleanup is attempted without retrying acquisition.

Booking/BookingSeat retain immutable quote history. ConfirmedSeat is a normalized
allocation relation keyed by (showId, seatId), linked to the exact BookingSeat.
A database status trigger allocates every seat atomically on confirmation; a
conflict rolls back the whole confirmation. Only confirmed bookings can own
allocations. Reserved cancellation transitions remove allocations but retain
snapshots; no paid cancellation API or financial/refund policy is exposed here.

Creation checks Show/movie/seat/pricing, acquires Redis, then revalidates prices,
permanent allocations and live hold ownership inside the DB transaction before
creating PENDING. Database creation locks Show -> Movie -> sorted physical Seats.
Internal confirmation locks Booking -> Show -> Movie -> sorted Seats, checks live
Redis ownership, and transitions only with an unexpired database deadline.
SQL checks clock_timestamp both at transition and deferred before commit.
Redis and PostgreSQL are not one distributed transaction; server checks plus
deadline/unique constraints and compensating owner-release protect this boundary.
Redis and database clocks must be synchronized for the common UTC expiry.

Confirmation is a trusted internal BookingService operation for the later
verified PaymentService. There is NO public confirm endpoint or client-supplied
paid flag. Idempotent replay of an already CONFIRMED booking does not create a
new allocation or require its old, naturally expired Redis hold.

Public API: GET /api/shows/:id/availability (no owner IDs returned).
Protected API: POST /api/bookings, GET /api/bookings, GET /api/bookings/:id,
DELETE /api/bookings/:id/hold (PENDING-only release -> FAILED, no paid cancellation).
Requests accept only Show/Seat IDs, bounded to ten distinct seats per booking.
Money uses integer paise, with BIGINT booking totals and bounded safe JSON numbers.
Expired/lost pending holds become FAILED when observed; no process timer renews
or owns a hold. Historical bookings remain owner-readable despite hidden movies.

## Exact file inventory

Created in this module:

- `backend/src/modules/booking/booking.types.ts`: repository contracts, contexts,
  quote and transition types, dependency bundle.
- `backend/src/modules/booking/booking.validation.ts`: strict Show/Seat UUID body,
  one to ten distinct seats, rejecting browser totals and unknown fields.
- `backend/src/modules/booking/booking.repository.ts`: Prisma I/O, explicit READ
  COMMITTED transactions, fixed parent/seat lock order and database clock.
- `backend/src/modules/booking/booking.service.ts`: quote, create, history,
  release, trusted confirmation, compensation and combined availability policy.
- `backend/src/modules/booking/booking-write.ts`: safe database-conflict mapping,
  reusing the existing scheduling error boundary.
- `backend/src/modules/booking/booking.controller.ts`: validated HTTP input and
  response status/envelope only.
- `backend/src/modules/booking/booking.routes.ts`: route/middleware assembly;
  booking and availability responses use `Cache-Control: no-store`.
- `backend/src/modules/booking/create-booking.ts`: dependency injection factory.
- `backend/src/modules/seat-lock/seat-lock.types.ts`: lock I/O port and TTL.
- `backend/src/modules/seat-lock/seat-lock.scripts.ts`: atomic Lua scripts.
- `backend/src/modules/seat-lock/seat-lock.service.ts`: bounded Redis operations,
  canonical identifiers, strict response decoding and safe errors.
- `backend/src/middleware/require-current-user.ts`: checks the JWT subject still
  exists through AuthService and uses its canonical database identity.
- `backend/prisma/migrations/20261006000400_booking_allocations/migration.sql`:
  additive tables, constraints and permanent allocation/lifecycle guards.
- `backend/tests/booking.test.ts`: unit/service/HTTP behavior.
- `backend/tests/helpers/booking.ts`: test-only repository/lock fixtures.
- `backend/tests/booking.integration.mjs`: real HTTP/Prisma/PostgreSQL/Redis flow.
- `backend/tests/booking-database.integration.mjs`: native database guards/races.
- `backend/tests/seat-lock.test.ts`: focused Redis service tests.
- `backend/tests/seat-lock.integration.mjs`: two-client atomicity, TTL, Lua failure,
  owner fencing and real Redis failure tests.
- `docs/booking-redis.md`: this implementation/learning record.
- `docs/superpowers/plans/2026-10-07-booking-redis.md`: implementation/test ledger.

Modified:

- `backend/prisma/schema.prisma`: BookingStatus, Booking, BookingSeat,
  ConfirmedSeat and User/Show/Seat back-relations.
- `backend/src/app.ts`: mounts injected Booking routes alongside existing modules.
- `backend/src/server.ts`: constructs Booking dependencies from shared clients.
- `backend/src/lib/prisma.ts`: enforces UTC on every pooled database session;
  keeps the existing connection/statement timeout bounds.
- `backend/package.json`: includes native Booking, Redis and combined integration
  suites in the existing integration command; no dependency version changes.
- `.github/workflows/ci.yml`: disposable Redis service plus explicit test URLs.
- `docs/implementation-progress.md`: module ledger and required checkpoint.
- `README.md`: public/protected APIs and local verification instructions.

Generated Prisma client and compiled output are ignored artifacts, not source
files to commit. Earlier foundation/module work already present in the dirty
checkout was preserved; the inventory above is this module's scope only.

## Request and code flows

```text
POST /api/bookings { showId, seatIds }
  Route -> JWT middleware -> current-user check -> strict body validation
  -> BookingController.create -> BookingService.create
  -> BookingRepository.context -> Prisma -> PostgreSQL (server quote)
  -> SeatLockService.acquire -> Redis Lua (all seats or none; 300000ms)
  -> BookingRepository.createPending -> Prisma READ COMMITTED transaction
     -> lock Show / Movie / sorted Seats -> fresh quote + live hold check
     -> Booking + BookingSeat insert -> deferred quote integrity -> commit
  -> 201 PENDING + totalPaise + exact expiresAt + per-seat price snapshot

GET /api/bookings or /api/bookings/:id
  Route -> JWT -> current user -> query/parameter validation -> Controller
  -> BookingService -> Repository expires own stale PENDING bookings
  -> owner-scoped history -> live hold validation for PENDING only
  -> FAILED if hold is lost; otherwise return authoritative booking DTO

DELETE /api/bookings/:id/hold
  Route -> JWT -> current user -> ID validation -> Controller -> BookingService
  -> Repository locks Booking then parents/seats -> ownership/state policy
  -> Redis owner/fence-checked release -> PENDING becomes FAILED -> commit
  -> 200; CONFIRMED/CANCELLED rejected, no financial cancellation here

GET /api/shows/:id/availability
  Route -> ID validation -> Controller -> BookingService
  -> Repository -> PostgreSQL physical seats/prices + confirmed allocations
  -> SeatLockService.inspect -> Redis live PTTL for unallocated seats
  -> Repository -> PostgreSQL allocation re-read after Redis inspection
  -> BOOKED takes precedence, then LOCKED, otherwise AVAILABLE; no owner data

Internal BookingService.confirm (NOT an HTTP route)
  -> Repository locks Booking -> Show -> Movie -> sorted physical Seats
  -> validate future active Show + deadline + Redis owner/fence on all seats
  -> PENDING -> CONFIRMED -> SQL atomically inserts all ConfirmedSeat rows
  -> deferred deadline/bookability/allocation integrity -> commit
  -> owner-checked Redis release; repeat CONFIRMED call returns same booking
```

## Prisma relationships and HLD/LLD correspondence

```text
User 1 ---- N Booking N ---- 1 Show N ---- 1 Movie
                    |          |
                    |          N
                    N          |
              BookingSeat      1
                    |        Screen 1 ---- N physical Seat
                    N                         1
                    |                         |
                    +-------------------------+

BookingSeat 1 ---- 0..1 ConfirmedSeat
ConfirmedSeat primary key = (showId, seatId)
```

BookingSeat's composite Booking foreign key fixes its Show to the parent's
Show. ConfirmedSeat's composite foreign key fixes its Show and physical Seat to
the exact historical BookingSeat. The unique primary key makes PostgreSQL the
final arbiter even if Redis is restarted, data is lost or callers race.

This preserves the approved domain relationships and Route -> Middleware ->
Controller -> Service -> Repository -> Prisma -> PostgreSQL layering. Redis is
the approved side boundary from BookingService to SeatLockService; there are
no Redis calls in controllers or database repositories and no SQL in services.

Implementation refinements, not changes to the approved contract:

- A normalized ConfirmedSeat relation separates active permanent allocation
  from immutable historical BookingSeat rows; otherwise a unique historical
  `(showId, seatId)` would prevent rebooking after eventual cancellation.
- Owner identity additionally includes the booking UUID as a fence. It prevents
  an old release from deleting a newer hold by the same authenticated account.
- Database triggers protect allocations, transitions, quote totals, expiry and
  Show identity even for direct SQL writes. Booking/seat mutations require READ
  COMMITTED, matching the existing scheduling safeguards.
- Totals are BIGINT because several valid integer seat prices can exceed a
  32-bit total. Stored bounds remain safely representable in JSON numbers.
- PostgreSQL context time is read as numeric UTC epoch. Pooled connections also
  force UTC: integration tests proved the existing adapter otherwise wrote
  timezone-less Date parameters as database-local instants while returning
  deceptively correct Date DTOs. Native SQL epoch assertions cover both Show
  start and Redis-derived Booking expiry; confirmation timestamp is checked
  against the current instant. No timezone schema or UTC contract changed.
- Availability reads permanent allocation again after Redis inspection. A
  concurrent confirmation can remove its hold between reads; without the final
  database read it could misleadingly appear AVAILABLE. A barrier regression
  now covers this race. Availability remains an advisory snapshot, not a hold.
- Expired/lost pending bookings are marked FAILED lazily on authenticated reads
  or confirmation; Redis TTL releases seats independently. There is no in-memory
  expiry timer or implicit renewal, and no background worker in this module.
- Releasing an unpaid hold uses FAILED/HOLD_RELEASED; CANCELLED is reserved for
  the later cancellation/refund policy. No unpaid action can cancel a confirmed
  booking. The trusted confirmation method is not proof of payment by itself.

## Failure behavior and remaining boundaries

No-lock fallback is never used. Busy seats return 409; Redis unavailable or
timed-out commands return 503. Malformed input returns 400, invalid identity
401, and another user's booking looks absent (404). Database errors go through
the existing safe boundary, without SQL details, passwords or lock owners.

Creation failure attempts both fenced Redis release and a conditional PENDING
failure transition. It serializes the failure transition before releasing a
hold when the creation commit acknowledgement is unknown, preventing concurrent
trusted confirmation from using a hold that cleanup has just removed.
Confirmation recovery never overwrites CONFIRMED. If a DB
commit outcome is unknown, a reread can establish already-confirmed success;
otherwise the original failure remains. Cleanup outages may leave keys until
their original TTL; safe event-only warnings contain no identifiers/secrets.

Availability is an advisory snapshot, not a reservation; only atomic acquisition
plus permanent allocation constraints decide a write. Redis and PostgreSQL
cannot commit atomically together. The shared absolute deadline requires clock
synchronization. Redis loss fails pending confirmations closed but does not
remove PostgreSQL confirmed allocations. Redis replication/failover durability,
operational monitoring and rate limits need deployment hardening separately.

When the future paid cancellation module can free allocations concurrently,
revisit availability's initial BOOKED-seat Redis inspection exclusion: inspect
all physical seats or explicitly inspect allocations removed during the read.
No cancellation route exists today; this is a recorded next-module follow-up,
not permission to invent a cancellation/refund policy now.

No Razorpay order, webhook, signature verification, financial reconciliation,
late-payment handling, cancellation/refund orchestration or UI integration is
implemented. Those modules must build on this trusted internal boundary and
make their approved decisions at the later critical checkpoint.

## Verification and implementation status

Completed at the required Booking/Redis checkpoint on 2026-10-07. STOPPED before
Payments/Webhooks, as explicitly requested. No commits/pushes, secret files,
existing-user-database changes or Payments work.

| Fresh check | Result |
| --- | --- |
| Prisma validate / generate | Passed; client 7.10.0 |
| Backend typecheck / build | Passed |
| Full unit/service/HTTP suite | 195 passed, 10 files |
| Compiled-server smoke tests | 2 passed |
| Full live integration command | 23 passed, 0 failed, 0 skipped |
| Backend audit | 0 vulnerabilities |
| Frontend lint / TypeScript + Vite build / audit | Passed; 0 vulnerabilities |
| Git whitespace / ignored environment paths | Passed; informational LF/CRLF warnings |
| Four migrations on fresh isolated database | Applied; Prisma status up to date |
| Independent final review | No current-module blockers; 52 focused tests and typecheck independently passed |

The 23 live results comprise Auth (1), Catalog (1), Shows HTTP/native (2), native
Booking database guards (1), actual Redis scripts (8 including parent), and
combined Booking API/PostgreSQL/Redis (10 including parent). Parent grouping is
included in Node's reported test total; the native single test contains multiple
constraint/race assertions. There are 32 Booking and 20 SeatLock unit cases.

Observed RED -> GREEN regressions include initial POST absence, deferred
show-start rejection, native epoch mismatch between Prisma and Redis, availability
while confirmation cleans Redis, and recovery after an ambiguous creation commit.
Live checks prove five-minute Redis TIME/PEXPIRETIME agreement without renewal,
two-client all-or-nothing contention, second-write Lua rollback, show isolation,
owner/ABA fencing, eight confirmation/release races, immutable pricing, BIGINT
totals, permanent collision rollback without partial allocation, direct SQL state
guards, expiry between transition/commit, and owner-safe outage/cleanup behavior.
The actual adapter allocation collision is P2002 and reaches safe SEAT_BOOKED 409.

Verification used native PostgreSQL 18.4 on task-only localhost:55438, with all
four additive migrations applied to a new `cinehook_booking_final_test` database.
The existing PostgreSQL service/database on 5432 was not touched. Redis ran
loopback-only on task port 55439, DB 15, without persistence or global service
installation. Windows lacks the Docker runtime here, so the live Redis was the
community `redis-windows` portable 8.10.2 Cygwin build, downloaded from its
GitHub release and SHA-256 checked against release metadata; it is not an
official Redis Windows distribution. Tests delete only their own fixture IDs
and keys, never reset a database or FLUSHDB. Task-only test services are stopped
after verification; temporary test data remains recoverable.

CI is configured for PostgreSQL 17 and official Redis 8 Alpine, but remote CI
and Docker execution were not performed. A non-failing pg deprecation warning
from Prisma's nested-query adapter remains visible; resolve compatibility before
a future pg 9 upgrade. Deliberate outage tests emit sanitized event-only logs.

The test-driven-development and systematic-debugging workflows influenced the
work by requiring demonstrated regressions before fixes. Independent parallel
review found the availability and recovery races; verification-before-completion
required the full live suite, rather than accepting mocked or skipped results.
