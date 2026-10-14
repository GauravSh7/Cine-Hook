# Dedicated event, comedy and sports booking — 2026-10-10

## Current checkpoint

Tasks 1–4 are implemented and reviewed: dedicated inventory, shared financial
fulfillment, guarded fictional event seeds and persisted stage/stadium/court UI.
Migrations11/12 were applied through the guarded launcher only to verified
`cinehook_dev/public` on PostgreSQL5432. Prior preservation evidence remains in
`docs/verification/2026-10-10-ui-polish/corrected-event-seed-preservation.md`:
9 events/612 seats/72 rolling sessions/216 prices after rollover; original rows
in both development and original databases remain preserved. Task5 does not
rerun development/original writes.

Final automated verification passed on 2026-10-11:675backend unit tests/42files,
194frontend tests/18files,118native/seed/fixture/smoke results with0skips;
typechecks/lint/final builds/Prisma12migration status/no-diff and both0-vulnerability
audits pass. A transient backend test worker crash was fully reported and the
unchanged complete rerun passed; exact evidence/limits are in the Task5 report.
The controlled browser
fixture is running on loopback55440 with a fresh test database, real compiled
services and RazorpayProvider over controlled HTTP. Browser acceptance is
explicitly pending the controller's evidence; no real payment/provider delivery
or responsive outcome is claimed by the verification worker.

## Why dedicated inventory and shared money handling

A cinema Screen is not a comedy auditorium or stadium. Movie/Show/Screen/Seat and
their SQL rules remain; a separate EventVenue/Session/Section/Seat represents event
inventory. Booking and Payment keep one global financial identity. The small
trusted BookingGateway selects the domain from persisted kind, never browser
payment flags. BookingService remains the movie service; EventBookingService
owns event fulfillment. Both delegate temporary holds to SeatLockService and
permanent data access to repositories.

The shared gateway's target/owner/history queries are owned by the injected
BookingTargetRepository. Financial repository scopes supply their own target
lookup and both domain stores on the same Prisma transaction; a financial call
never substitutes an out-of-transaction lookup.

## New models and relationships

- `Event`: id, unique slug, title/description, kind EVENTS/SPORTS/ACTIVITIES,
  optional sport, durationMinutes, imageUrl/imageAttribution, isSample/isActive,
  timestamps. EventPerformer stores performer name/biography; EventParticipant
  stores team/participant name. No claims of real public events are seeded.
- `City 1:N EventVenue`; venue is independent of Theatre/Screen. Venue kind is
  AUDITORIUM/STADIUM/ARENA with name/address/capacity.
- `EventVenue 1:N EventSection 1:N EventSeat`: section has unique venue/code,
  display name, bounded position and sort order. Seat has sectionId, rowName,
  seatNumber and STANDARD/PREMIUM/VIP tier; unique section/row/number. A permanent
  seat stores no AVAILABLE/LOCKED/BOOKED state.
- `Event 1:N EventSession` and `EventVenue 1:N EventSession`: normalized UTC
  start/end, status/timestamps. SQL snapshots end from stored event duration,
  rejects overlap for one active venue (including concurrent inserts), and
  requires complete physical layout/price coverage. Once any session depends on
  a venue, layout/capacity/city/parent identity cannot be silently changed.
- `EventSessionPrice(sessionId,ticketTier)` stores positive trusted INR paise.
- `Booking` adds MOVIE/EVENT discriminator (default MOVIE) and nullable
  eventSessionId; showId becomes nullable. SQL XOR enforces exactly one matching
  valid target. Existing movie rows retain IDs, target, money and quote history.
- `EventBookingSeat` stores booking/session/physical seat and immutable price
  snapshot. Composite identity and SQL checks reject wrong target/venue/price.
- `EventConfirmedSeat(sessionId,seatId)` is the unique permanent allocation and
  references the exact quote identity. Movie ConfirmedSeat remains separate.

Unconfigured empty venues are allowed; a configured nonempty physical layout must
equal declared capacity. A review regression caught parent lookup loss when a
section's seats and then section were deleted in the same transaction. Deferred
section validation now retains OLD.venue_id and rejects that partial layout.
The native rollback regression also proves full removal of an unused layout
remains allowed. No destructive layout API is exposed.

## APIs and DTOs

All responses preserve the existing success/error envelope and safe errors.
Dates serialize as UTC ISO strings; amounts are integer paise.

| API | Responsibility / access |
|---|---|
| GET `/api/events?kind=&cityId=&search=&page=&limit=` | Active persisted event catalog, bounded/literal search, existing city validation |
| GET `/api/events/:id` | Event, people, upcoming sessions/venues/cities/prices |
| GET `/api/event-sessions?eventId=&cityId=&page=&limit=` | Upcoming scheduled sessions with dedicated layout |
| GET `/api/event-sessions/:id` | Persisted session/event/venue/sections/seats/prices |
| GET `/api/event-sessions/:id/availability` | Physical seats + temporary Redis state + permanent allocation; no-store |
| POST `/api/event-bookings` | Authenticated hold/create; strict `{eventSessionId,seatIds}` only, distinct UUIDs,1–10 seats |
| GET `/api/bookings`, GET `/api/bookings/:id` | Owner-only mixed movie/event history/detail |
| DELETE `/api/bookings/:id/hold` | Owner-only unpaid abandonment, durable failure then fenced release |
| Existing payment order/verify/raw webhook APIs | Shared backend/provider evidence only |
| Existing owner cancellation/refund read/retry APIs | Target-aware cancellation and durable full refunds |
| Existing summary/admin reads | Historical event identity as well as movie identity |

Movie booking fields are retained with added `bookingKind:'MOVIE'` and
`eventSessionId:null`. Event bookings have `bookingKind:'EVENT'`, `showId:null`,
eventSessionId, the existing lifecycle/total/expiry fields, and quote seats with
seatId,rowName,seatNumber,ticketTier,sectionId/code/name,pricePaise. Basic event
availability omits private owner/hold tokens; each seat includes persisted section,
tier, server price, state and remainingHoldMs.

An event owner summary is `{booking,show:null,eventSession,payment,refunds}`.
eventSession includes historical event title/kind/sport/media/sample provenance,
venue/city and start/end. History does not use future-only public catalog reads.
Event admin booking rows use the same null-show/eventSession distinction. Legacy
movie summary/admin shape remains compatible; absent bookingKind means MOVIE.
Provider evidence/raw webhook payloads are never exposed in these read DTOs.

## Hold, capture, recovery and cancellation flow

Event creation: route -> auth/validation -> EventBookingController ->
EventBookingService -> EventBookingRepository -> Prisma/PostgreSQL. Service reads
bookability/physical seats/prices, acquires atomic Redis hold, then revalidates and
creates PENDING plus trusted quote in a short transaction. Failure releases only
its own fenced grant; no partial hold remains. A concurrent price change during
acquisition is re-quoted before persistence, not trusted from a browser total.

Redis key namespace: `cinehook:event-seat-lock:{sessionId}:seatId`; original movie
namespace is unchanged. The exact existing Lua, Redis TIME and 300000ms grant
remain. Owner token includes authenticated user and booking identity, so cleanup
from an expired old booking cannot remove a newer same-user hold (ABA protection).
No server-memory seat state, renewal or automatic reacquisition.

Availability inspects ALL persisted physical seats in Redis, then reads permanent
allocation last. BOOKED wins. This retains the cancellation/rebooking and
confirmation-cleanup race protection; Redis is temporary, PostgreSQL final.

Order/verify/webhook -> PaymentService/provider abstraction -> financial
repository transaction -> trusted gateway -> correct domain confirm on the SAME
transaction. Allocation/state/evidence commit together; Redis cleanup executes
only after commit. Provider HTTP never runs inside a transaction. Signature and
provider-captured amount/currency/order identity remain mandatory. Browser-close
recovery and duplicate evidence use the existing globally unique provider/event
identities. There is no public confirm/paid/refund-success endpoint.

Successful capture is financial SUCCESS even if fulfillment fails; a late/lost
hold or allocation conflict cannot revive/reacquire a seat. Durable full
compensation moves into the existing REFUND_PENDING infrastructure. Transient
concurrency/Redis failures stay retryable, not silently classified as permanent.
Native COMMIT SQLSTATE mapping preserves safe conflict/deadlock retry behavior.

Owner cancellation is strictly before session start, including a final deferred
commit-time check. CONFIRMED -> CANCELLED and deletion of its EventConfirmedSeat
allocations are atomic with full captured-source refund obligations. Quote and
financial history remain. Payment SUCCESS -> REFUND_PENDING -> REFUNDED requires
verified provider result; outage stays pending, never restores CONFIRMED. Paid
unfulfilled compensation is full regardless of start, without ticket revival.
Duplicate cancel/refund/capture/webhook effects remain idempotent.

## Code inventory (backend checkpoint)

Schema and additive migrations `20261010001100_event_inventory` and
`20261010001200_event_bookings`. New layered `src/modules/events` and
`src/modules/event-booking`; new booking gateway, target repository and financial
scope helper. Updated app/server factories, movie booking interface/target guards,
payment/refund scope wiring, seat-lock namespace, SQL error adapters and explicit
owner/admin event projections in `ui-read`.

Tests: event-catalog unit, event-booking unit, event-inventory native,
event-booking native. Original movie tests and first eleven migrations remain
unchanged (controller hash comparison75 baseline files, zero changes/missing).
Generated Prisma/dist regenerated; no new dependency.
Exact task-specific file inventories/constructor/DTO contracts and TDD evidence
are retained in `.superpowers/sdd/2026-10-10-event-booking/task-{1,2}-report.md`.
The scratch is intentionally retained because the user forbids commits and no
committed recovery record exists.

## Historical Task1–2 verification (superseded by Task5 evidence)

- Inventory:648 backend unit tests;3 native inventory suites; validate/generate,
  typecheck/build/schema diff pass. Native RED exposed section-deletion hole,
  corrected SQL then GREEN on a new isolated database.
- Financial before scoped layering fix:652 unit,23 event native,73 original
  native,3 inventory native; validate/generate/typecheck/build/schema diff pass.
- Layering fix:7 focused unit,23 native event,655 full unit/40 files, typecheck
  and build pass. Review confirms no schema/financial-scope change. Original
  full native suite will rerun in final integrated Task5 after all remaining edits.
- Scoped financial review and fix review are clean; no claimed independent suite
  rerun by reviewers. Test provider, not real external payment/money.
- Native tests include two-owner contention/atomicity, target/foreign seat/quote
  rejection, real expiry, invalid evidence, mixed history, webhook/browser-close
  recovery, replay, allocation conflicts, commit rollback/expiry/cutoff, full late
  compensation, duplicate refund/capture, ABA fencing, cancellation/rebooking/
  read races, and no provider calls inside transactions.
- Migration preservation:12 development migrations now applied, all previous
  table counts unchanged, original database unchanged. Readiness and proxied
  event catalog return success. No seed has yet run for dedicated events.

## Boundaries / next steps

Full controller browser/responsive acceptance remains. No public inventory admin writer, organizer cancellation/rescheduling,
unseated/standing blocks, streaming playback, real promotions or scalability phase
was added. Real provider/media credentials remain optional blank configuration
slots documented in [provider setup](provider-setup.md), never fake successes.
No commit, push, deploy, original-database migration/reset or history deletion.

## Current frontend and Task5 verification inventory

Frontend domain/API files: `src/api/event-types.ts`, `src/api/events.ts`,
`src/domain/booking-target.ts`; pages `src/pages/EventPage.tsx`, `EventSeatsPage.tsx`;
geometry `src/components/EventVenueMap.tsx`/`EventArtwork.tsx`, styling `src/events.css`.
Category discovery merges persisted event sessions with explicitly unavailable
read-only sample details. Checkout, outcomes, tickets, owner history and admin
reads use the durable MOVIE/EVENT target and historical summary. Event writes
contain only session/seat IDs; prices and successful fulfillment come from server.
Source request flow remains routes/middleware/controller/service/repository.

Task5 changes only `backend/package.json`, test fixture/orchestration files and
factual docs. `tests/ui-browser-server.mjs` wires EventBookingService with separate
event SeatLockService, BookingGateway/BookingTargetRepository, createEvents and
the same shared payment/refund/read dependencies as server.ts. It seeds five
fictional 36-seat layouts (stage, comedy, cricket, football, court), all tier
prices and real service-created confirmed/owner-held/other-held states.
`tests/ui-browser-native.integration.mjs` verifies inventory and strict signed
raw webhook recovery/replay with a single persisted event and allocation.
`tests/ui-browser-fixture.test.ts` covers dedicated-target guards, helper input
validation, actual provider signature parsing and transaction exclusion.
`tests/refinement-verify.mjs`/`verification-targets.mjs` register fresh target
creation/migrations and all existing movie + event + seed + fixture + smoke
suites. Exact commands/results/targets are in
`.superpowers/sdd/2026-10-10-event-booking/task-5-report.md`.

## Seed: explicit fictional development inventory

The seed implementation is separate from server startup, build and migrations.
The controller ran the reviewed seed once (63 sessions) and immediately reran it
(zero additions). The technical checkpoint above records the earlier unseeded
development state. A subsequent timezone fix is awaiting scoped review; the
already persisted v1 dates and identities are retained.
Run from `backend` only after the guarded development migrations are applied and
the existing New Delhi/Delhi, Mumbai/Maharashtra and Bengaluru/Karnataka city
records are present. It never creates cities, users or administrator credentials.

```powershell
$env:NODE_ENV='development'
npm run dev:db:check
npm run dev:events:seed
```

The command uses the existing local `.env` connection settings and dev-target
guard: only loopback `cinehook_dev/public` on PostgreSQL5432. An explicit
`DEV_DATABASE_URL`, when configured, must already name `cinehook_dev`. Production
environment, remote/overridden URLs and identity mismatches stop before writes.
The core verifies the actual database/schema/port/loopback server address inside
its transaction, then sets transaction-local UTC before sending Date parameters.
The CLI reuses the application's UTC-configured Prisma connection factory so
database timezone defaults cannot shift the intended instants. Inside the verified
seed transaction, statement timeout is locally 120 seconds to allow shared-lock
serialization within the existing 120-second transaction budget; commit/rollback
restores the app factory's normal two-second default. Global/app defaults are
unchanged. The isolated native test path additionally requires
the task-specific `cinehook_event_seed_*_test` name, PostgreSQL55438 and actual
`cinehook_verify` role; the normal command cannot select that test path.

Each city has one original fictional comedy performer, one fictional sport match
with two invented participants, and one seated paper-craft workshop. These are
development samples; names, venues and schedules make no real-world event claims.
New Delhi has cricket in a STADIUM, Mumbai football in a STADIUM, and Bengaluru
basketball in an ARENA. Comedy and workshop venues are dedicated AUDITORIUMs.

| Per-city example | Physical layout | Seats | INR prices: STANDARD / PREMIUM / VIP |
|---|---|---:|---|
| Comedy | FRONT VIP, MIDDLE PREMIUM, REAR STANDARD; each section rows A/B, seats 1–12 |72|₹400 / ₹650 / ₹950|
| Sport | NORTH/SOUTH STANDARD, EAST PREMIUM, WEST VIP; each stand rows A/B, seats 1–12 |96|₹300 / ₹500 / ₹800|
| Seated workshop | FRONT VIP, MIDDLE PREMIUM, REAR STANDARD; each section rows A/B, seats 1–6 |36|₹250 / ₹400 / ₹600|

Middle auditorium rows persist position REAR with their own code and sortOrder;
the bounded schema has FRONT/REAR plus the four compass positions. Repeated row
letters are scoped to their section, and every physical seat has a stable UUID.
The initial complete inventory is 9 events, 3 performers, 6 participants, 9 venues,
30 sections and 612 numbered seats. Declared capacities equal the seat counts.
Each event gets seven next IST calendar days at 13:00 IST (07:30 UTC): 63 sessions and 189 typed
positive INR-paise prices. Duration snapshots are 75 minutes for comedy, 90 for
workshops, 180 for cricket and 120 for football/basketball.

Existing records are never updated, deleted, re-enabled, reseated or rescheduled.
The transaction and shared development seed advisory lock serialize concurrent
runs. Stable identities and absolute date-based session IDs prevent duplicates.
The explicit v1 session-ID helper retains the original date token at 13:00 UTC,
which is only an identity anchor; the operational start is 07:30 UTC / 13:00 IST.
This preserves the IDs already used by the personal-database seed without moving
any session. Exact event/venue/start validation still rejects arbitrary collisions;
later runs add only missing future dates and keep all historical/cancelled dates,
edited people/catalog/venue addresses/prices and existing duration snapshots.
New sessions use the event's current stored duration. Inactive or no-longer-sample
events receive no new sessions. An event, venue, session or physical-layout
identity collision aborts the whole run; there is no automatic repair.

Artwork reuses existing local original CC0 category illustrations in
`frontend/public/demo-category-art/{events,sports,activities}.svg`, with explicit
sample/provenance metadata. No external media, model, provider or payment call is
used. No public inventory writer or new financial policy accompanies this seed.

Native verification uses a new isolated task database with all 12 migrations:

```powershell
$env:EVENT_SEED_TEST_DATABASE_URL='postgresql://cinehook_verify@127.0.0.1:55438/cinehook_event_seed_new_run_test'
npm run test:events:seed:integration
```

The example names a NEW test target: create it and apply the 12 migrations first,
after verifying actual role/database/port. That command's main test requires a
fresh database; use a NEW matching test database
for another whole-suite run, without resetting retained fixtures. Task 3 evidence
and exact test setup are recorded in
`.superpowers/sdd/2026-10-10-event-booking/task-3-report.md`. Native checks prove
reruns/concurrent additions under an explicit Asia/Kolkata pool default, returned
and SQL UTC instants, rollback on collisions, and unchanged edited catalog,
credentials, failed quote and captured/refund-pending financial history. The
optional `EVENT_SEED_LEGACY_TEST_DATABASE_URL` runs the exact pre-fix v1 fixture
preservation check; the report identifies that retained test-only evidence target.
