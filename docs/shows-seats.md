# Shows / Seats: approved contract and implementation notes

## Approved scope

Movie 1:N Show; Screen 1:N Show; Screen 1:N physical Seat. A Seat stores id,
screenId, rowName, seatNumber and seatType, unique per screen/row/number. SeatType
is REGULAR, PREMIUM or RECLINER. No permanent availability status exists.
Show stores movieId, screenId, startsAt, endsAt, status and timestamps.
ShowSeatPrice stores one integer INR pricePaise per show/seatType, with a compound
primary key. BookingSeat.price snapshots belong to the later Booking module.

Timezone-aware startsAt input is normalized to UTC. endsAt is calculated once
from the movie duration. Active scheduled shows cannot overlap within a screen;
back-to-back intervals are permitted, with no additional turnover buffer.
Scheduling requires a complete physical layout matching capacity and exactly
one positive price for each seat type present in that layout. There is no flat
Show price. SCHEDULED is the initial Show status; CANCELLED is reserved for later
show lifecycle handling, not a ticket-cancellation implementation here.

## Implementation choices within the approved contract

Layout initialization is an ADMIN-only atomic batch, not individual seat edits.
An unconfigured screen may have zero seats but cannot host shows. Initialization
must create exactly capacity seats and cannot replace existing physical IDs.
There is no layout delete/replace API. Configured capacity cannot diverge from
the layout. Screen theatreId and Theatre cityId cannot change once dependent
shows exist (including retained historical/cancelled shows). Harmless name and
address edits are allowed. These rules are also protected in PostgreSQL.

Scheduling opens a repository-owned Prisma transaction. Database locks stabilize
the venue, screen, movie and layout. A service-supplied pure policy callback
checks the loaded context and derives the end-time/prices; the repository
performs all reads/writes. This keeps business rules in services without losing
the atomic boundary. PostgreSQL exclusion/constraint triggers protect other
database writers and racing requests. Controllers never import Prisma.
Both scheduling/layout transactions explicitly use READ COMMITTED. Protected
database writes reject other isolation modes: merely locking a parent does not
refresh a repeatable-read snapshot, which could hide a concurrently created
dependency. This is a Show/layout integrity guard, not the transaction policy
for the future Booking module. Alternate database writers must observe it too.

Implemented APIs:

```text
GET  /api/shows?movieId=&cityId=&theatreId=&date=&page=1&limit=20
GET  /api/shows/:id
GET  /api/shows/:id/seats
GET  /api/screens/:id/seats
POST /api/admin/shows
POST /api/admin/screens/:id/seats
```

Public lists show upcoming SCHEDULED shows of active movies. Date filters are
UTC calendar days. Show detail/layout reads hide cancelled shows and disabled
movies. A show seat response contains physical seats and their show-specific
pricePaise, not AVAILABLE/LOCKED/BOOKED claims. Admin writes reuse JWT,
current-database ADMIN checks, existing validation and safe error handling.

## Example requests

```json
{
  "seats": [
    { "rowName": "A", "seatNumber": 1, "seatType": "REGULAR" },
    { "rowName": "A", "seatNumber": 2, "seatType": "PREMIUM" }
  ]
}
```

Send that body to POST /api/admin/screens/:id/seats for a screen with capacity 2.
Rows are normalized to uppercase ASCII labels (1-10 letters). Seat numbers are
positive integers. Layouts have 1-1000 seats, matching the existing capacity
bound, and duplicate coordinates are rejected after normalization.

```json
{
  "movieId": "<movie UUID>",
  "screenId": "<screen UUID>",
  "startsAt": "2099-01-01T15:30:00+05:30",
  "prices": [
    { "seatType": "REGULAR", "pricePaise": 10000 },
    { "seatType": "PREMIUM", "pricePaise": 15000 }
  ]
}
```

POST /api/admin/shows returns 201 with data.show and its related movie, venue and
prices. For a 100-minute movie the above produces startsAt
2099-01-01T10:00:00.000Z and endsAt 2099-01-01T11:40:00.000Z.
The request cannot supply endsAt, status or a flat price. Prices are positive
PostgreSQL integers (maximum 2147483647); 10000 paise means INR 100.
Exactly the types present in the physical layout must be priced; duplicate,
missing or extraneous price categories are 400. A RECLINER screen can have its
own RECLINER price for each show. No currency conversion or fee policy is added.

## Exact request flows and layer responsibilities

```text
POST /api/admin/screens/:id/seats
  app -> showRoutes -> authMiddleware -> TokenService.verify
  -> requireRole(ADMIN) -> AuthService.getMe -> UserRepository -> Prisma -> DB
  -> validateRequest(UUID) -> validateBody(layoutSchema)
  -> SeatController.initialize -> SeatService.initialize
  -> SeatRepository.initialize -> Prisma transaction (READ COMMITTED)
     -> lock Screen FOR UPDATE; read Screen, existing seats, Show count
     -> synchronous service policy: exists, empty, no shows, exact capacity
     -> Prisma.seat.createMany -> PostgreSQL insert/check/unique/count guards
     -> Prisma.seat.findMany -> commit
  -> Controller: 201 { success, data: { seats } }

POST /api/admin/shows
  app -> showRoutes -> existing JWT/current-role checks -> showCreateSchema
  -> ShowController.create -> ShowService.create -> ShowRepository.schedule
  -> Prisma transaction (READ COMMITTED)
     -> find theatre identity; lock Theatre FOR SHARE, Screen FOR UPDATE
     -> re-read Screen; reject a changed parent with retryable 409
     -> lock Movie FOR SHARE; read Movie and physical seats
     -> synchronous service policy: active Movie, complete layout, exact prices
     -> service calculates endsAt snapshot from durationMinutes
     -> Prisma.show.create with nested ShowSeatPrice rows
     -> PostgreSQL interval exclusion + dependency/deferred pricing checks
     -> commit -> Controller: 201 { success, data: { show } }

GET /api/shows
  showRoutes -> validateRequest(showQuerySchema)
  -> ShowController.list -> ShowService.list -> ShowRepository.list
  -> Prisma.show.findMany -> PostgreSQL (active movie, SCHEDULED, upcoming,
     combined filters, UTC day, startsAt/id order, bounded pagination)
  -> Controller: 200 { success, data: { items, page, limit } }

GET /api/shows/:id
  showRoutes -> UUID validation -> ShowController.get -> ShowService.getById
  -> ShowRepository.findById -> Prisma -> DB
  -> service hides CANCELLED/disabled-movie shows -> Controller: data.show

GET /api/shows/:id/seats
  route -> UUID validation -> ShowController.getSeats -> ShowService.getSeats
  -> getById validation -> ShowRepository.listSeats -> Prisma -> DB
  -> service joins seatType to this show's prices -> data: { showId, seats }

GET /api/screens/:id/seats
  route -> UUID validation -> SeatController.list -> SeatService.list
  -> SeatRepository.list -> Prisma -> DB -> data: { seats }

PATCH existing Screen / Theatre admin routes
  existing Catalog routes/ADMIN checks/validation -> Controller -> Service
  -> corresponding Repository -> Prisma.update -> PostgreSQL dependency guard
  -> safe 409 on forbidden capacity/layout/parent changes

All rejected operations -> existing errorHandler -> safe code/message/requestId
```

There is no Prisma/HTTP logic in service policy callbacks. They are synchronous,
with no network calls, so the repository's transaction remains short and the
business validation sees the same locked context as its writes. Public layout
and show prices are not an assertion that a seat can currently be booked.

## Database relationships and constraints

```text
Movie  1 -> N Show <- N : 1 Screen <- N : 1 Theatre <- N : 1 City
                |                |
                | 1              | 1
                v N              v N
           ShowSeatPrice        Seat
           PK(showId,seatType)   UNIQUE(screenId,rowName,seatNumber)
           pricePaise           seatType; physical layout only
```

Prisma models hold relations and indexes. SQL migration adds the checks,
exclusion and triggers Prisma cannot represent. `btree_gist` supplies the UUID
equality operator class for a GiST exclusion over screen and timestamp range.
Scheduled ranges are half-open [startsAt, endsAt), permitting exact adjacency.
Movie/start and Screen/start indexes serve filtered discovery; startsAt/id serves
the default list. Pricing has a compound primary key and cascade deletion with
its Show; other domain parents use restrictive deletion. Foreign-key update
behavior matches Prisma's cascade default.

## Decisions / differences from conceptual LLD

- ShowSeatPrice is the normalized per-show seat-type relation requested by the
  user. Seat never stores a price or availability status. Future BookingSeat
  will keep the actually charged price snapshot; not implemented here.
- Initial layout is a single complete transaction. No delete, replacement or
  individual seat-update API is exposed, even before shows. Direct SQL may
  perform a complete pre-show replacement in a transaction, but cannot alter a
  layout while any Show row remains. An empty screen is explicitly unconfigured.
- Venue guards include retained CANCELLED/historical shows, not just future
  active ones. Same-value capacity/parent patches and harmless names/addresses
  remain valid. Changing a movie duration leaves existing endsAt untouched.
- Show status has SCHEDULED/CANCELLED, but no cancellation/rescheduling endpoint
  is added. That future workflow must coordinate dependent bookings rather than
  silently changing them in this module.
- Public list is upcoming-only; detail can read an older SCHEDULED show. Admin
  can create historical records with valid intervals; future Booking must
  reject purchases after its approved sales cutoff.
- `date` means UTC calendar day. Timezone-aware input accepts Z or explicit
  offsets up to +/-14:00 and milliseconds. Local calendar components and the
  normalized UTC year are validated to reject Date normalization surprises.
- App factory accepts optional Show dependencies for existing focused Auth/
  Catalog tests. Production server always supplies createShows(prisma). New
  routes mount before Catalog's broad admin router, avoiding duplicate role
  queries for these writes. No existing middleware is duplicated.
- Database errors reuse Catalog's existing databaseWrite mappings plus a thin
  scheduling mapper for constraint/exclusion/concurrency failures. Operational
  failures still become safe 500 responses instead of being disguised as 409.
- RC guards are a safety refinement within the requested race protection.
  No Redis concurrency behavior, payment policy or stack component changed.

## Every created / modified file

Paths are relative to C:/Users/gaura/OneDrive/Desktop/Cine-Hook. Created means new
in this module; previously uncommitted Foundation/Auth/Catalog work is preserved.

| Action | File |
| --- | --- |
| Created | backend/prisma/migrations/20261006000300_shows_seats/migration.sql |
| Created | backend/src/modules/shows/show.types.ts |
| Created | backend/src/modules/shows/show.validation.ts |
| Created | backend/src/modules/shows/show.repository.ts |
| Created | backend/src/modules/shows/show.service.ts |
| Created | backend/src/modules/shows/show.controller.ts |
| Created | backend/src/modules/shows/show.routes.ts |
| Created | backend/src/modules/shows/seat.repository.ts |
| Created | backend/src/modules/shows/seat.service.ts |
| Created | backend/src/modules/shows/seat.controller.ts |
| Created | backend/src/modules/shows/create-shows.ts |
| Created | backend/src/modules/shows/scheduling-write.ts |
| Created | backend/tests/helpers/shows.ts |
| Created | backend/tests/shows.test.ts |
| Created | backend/tests/scheduling-write.test.ts |
| Created | backend/tests/shows.integration.mjs |
| Created | docs/shows-seats.md |
| Created | docs/superpowers/plans/2026-10-06-shows-seats.md |
| Modified | backend/prisma/schema.prisma |
| Modified | backend/src/app.ts |
| Modified | backend/src/server.ts |
| Modified | backend/src/modules/catalog/screen.repository.ts |
| Modified | backend/src/modules/catalog/theatre.repository.ts |
| Modified | backend/package.json |
| Modified | README.md |
| Modified | docs/implementation-progress.md |

No npm dependencies, lockfiles, frontend source, environment files or synced
sources changed. Ignored generated Prisma/compiled artifacts were refreshed.
No commit/push occurred. No migration was applied to an existing user database.

## Verification / review evidence

- First HTTP regression failed with expected 201 / actual 404 on the missing
  layout route. Expanded tests caught HTTP error-policy mismatches, corrected
  to 400 invalid input / 404 inactive Movie / 409 dependency or overlap conflict.
- A UTC boundary regression showed year-1 local input with +14:00 normalizing
  into year 0; it failed (201 instead of 400), then passed after UTC-year checks.
- Final backend unit/HTTP suite: 143 passed across 8 files, including all prior
  tests. New Show HTTP cases: 49; scheduling-error cases: 4.
- Typecheck/build, Prisma validate/generate, 2 compiled runtime tests, frontend
  lint/build and backend/frontend audits passed; both audits have zero findings.
- All 3 migrations applied to a fresh cinehook_shows_test database on a separate
  temporary PostgreSQL 18.4 cluster at localhost:55438. Existing port-5432
  service/database was untouched. Full live integration: 4 passed, 0 skipped.
- Real Show tests cover HTTP layout/scheduling races; REGULAR/PREMIUM/RECLINER
  prices; snapshots/filtering; native exclusion races; incomplete/invalid pricing
  rollback; complete layout; forbidden parent/city/capacity/seat changes; forced
  layout-initialization versus capacity change, first-Show versus parent/city
  changes; and Repeatable Read rejection.
- Live Prisma 7.10 reports check violations as P2039 with nested originalCode
  23514, not the initially assumed P2004. Native evidence corrected the test;
  API mapping correctly returns safe 409 without exposing database metadata.
- Independent final review found no current blocker; typecheck and 53 focused
  tests independently passed. SQL mode enforcement and default discovery index
  address the review findings. Git diff whitespace checks pass.
- A pg deprecation warning remains inside Prisma's adapter during nested writes
  (query pipelining). Tests pass; no warnings were suppressed or dependency
  versions changed. Recheck adapter compatibility before upgrading to pg 9.
- Positive Redis, Docker and CI execution remain unverified. These checks do
  not claim production deployment, Redis seat locking or payment correctness.

Planning/TDD, parallel review, systematic debugging and verification skills
guided the implementation. The user's automatic/no-commit contract overrides
ordinary skill approval/commit steps. See implementation-progress.md for the
next Booking/Redis architecture gate.

References: [PostgreSQL exclusion/range constraints](https://www.postgresql.org/docs/18/rangetypes.html#RANGETYPES-CONSTRAINT),
[row locking](https://www.postgresql.org/docs/18/explicit-locking.html),
[Repeatable Read snapshots](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ),
[Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions).
