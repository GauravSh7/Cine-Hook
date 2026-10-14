# CineHook dedicated event booking implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by
> task, with scoped review. Do not commit, push or deploy. The user explicitly
> approved continuous execution in the existing checkout.

**Goal:** Genuine numbered-seat comedy/sports booking with dedicated persisted
inventory and the existing financial evidence/refund engine.

**Architecture:** Dedicated Event catalog/venue/session/seat and EventBookingService;
shared Booking/Payment financial identity with a PostgreSQL XOR target check.
Movie services and physical movie inventory remain separate. A trusted booking
gateway routes confirmation/cancellation by durable target inside repository-owned
short transactions; external provider calls never occur inside transactions.

**Tech Stack:** Existing React/Vite/TypeScript/Tailwind, Express/Prisma/PostgreSQL,
Redis Lua, Razorpay provider abstraction. No new heavyweight dependencies.

**Spec:** ../specs/2026-10-10-events-sports-booking-design.md (approved).

## Global constraints

- Preserve all existing records and the original cinehook database. Only the
  verified cinehook_dev database on port5432 receives additive reviewed migrations.
- No resets, deletes of user/history records, secrets in reports, commits or pushes.
- Route -> Middleware -> Controller -> Service -> Repository -> Prisma -> PostgreSQL.
- Dedicated event inventory, never a movie Screen. Five-minute atomic fenced Redis
  holds, independent event namespace, no memory fallback or implicit renewal.
- Exactly one Booking target: movie Show or EventSession. Retain movie-specific
  guards, immutable quote history and allocation uniqueness.
- Captured financial outcome remains SUCCESS even if fulfillment fails; durable
  full compensation without seat revival. Shared provider/event/refund idempotency.
- Owner cancellation strictly before event session start; 100% trusted capture
  refund; paid-unfulfilled full compensation regardless of start time.
- Individually numbered reserved seats only; no standing/general-admission blocks.
- Fictional sample data disclosed, original/permitted artwork, no claims of live events.
- No organizer-cancellation/rescheduling policy or scalability expansion.
- Existing dirty checkout is the required workspace; no worktree, cleanup or commit.

## Review focus

- Cross-target booking seats and foreign venue seats must fail in SQL as well as service.
- Confirmation/cancellation/replay races must preserve financial truth and allocation uniqueness.
- Event mutation after a dependent session/booking must not silently destroy identity/layout.
- Availability reads inspect every physical seat then read allocation last after Redis,
  preventing cancellation/rebooking and confirmation-cleanup races.
- Unsupported non-seated activities and cityless Stream must remain non-bookable.

### Task 1: dedicated catalog and physical inventory

Files: backend/prisma/schema.prisma; new migration20261010001100_event_inventory;
new backend/src/modules/events/{event.types,event.validation,event.repository,
event.service,event.controller,event.routes,create-events}.ts; app/server wiring;
backend/tests/event-catalog.test.ts and event-inventory.integration.mjs.

Interfaces: EventKind EVENTS/SPORTS/ACTIVITIES; EventVenueKind AUDITORIUM/STADIUM/ARENA;
EventTicketTier STANDARD/PREMIUM/VIP. Event(id,slug,title,description,kind,sport?,
durationMinutes,imageUrl,imageAttribution,isSample,isActive,timestamps); EventPerformer(eventId,name,
biography); EventParticipant(eventId,name); EventVenue(id,cityId,name,address,kind,
capacity); EventSection(id,venueId,code,name,position,sortOrder); EventSeat(id,sectionId,
rowName,seatNumber,ticketTier); EventSession(id,eventId,venueId,startsAt,endsAt,status);
EventSessionPrice(sessionId,ticketTier,pricePaise).

Public GET /api/events?kind=&cityId=&search=&page=&limit= returns Page<EventSummary>;
GET /api/events/:id returns {event:EventDetail}; GET /api/event-sessions?eventId=&cityId=
returns Page<EventSessionDetail>; GET /api/event-sessions/:id returns {session}.
Summary/detail includes persisted performer/participants, upcoming sessions with
venue.city and typed prices. Session detail includes venue.sections with physical
seats and typed prices. Do not call any session bookable yet: fulfillment is Task2.

- [ ] Write/run failing catalog validation/scoped read tests; native tests for seat
  uniqueness, positive prices, capacity consistency, overlapping active sessions,
  timezone/end snapshot, locked layout/city/parent identity after sessions.
- [ ] Add normalized models and additive SQL constraints/exclusion/identity/coverage
  guards. Active sessions require complete physical layout/price coverage. Event
  duration snapshot drives end time; timezone-aware scheduling follows Shows.
- [ ] Layered read APIs, safe errors, bounds and current existing-city filtering;
  public active only; no financial/Redis or booking modifications in this task.
- [ ] Prisma validate/generate, focused tests, backend typecheck/build; inspect SQL
  by applying all migrations on a fresh isolated *_test database only.
- [ ] Report exact files/interfaces/results; scoped spec and quality review.

### Task 2: shared booking identity and financial fulfillment

Files: additive migration20261010001200_event_bookings/schema; new modules/event-booking,
booking/booking-gateway.ts; target-aware existing payment/refund transaction scopes;
seat-lock service parameterized namespace; ui-read summary/history/admin projections;
server/create-app wiring; unit/native event-booking/payment/refund tests.

Interfaces: Booking bookingKind MOVIE|EVENT (default MOVIE), nullable showId and
eventSessionId with SQL exclusive-or and composite identity keys. EventBookingSeat
(id,bookingId,eventSessionId,eventSeatId,price); EventConfirmedSeat PK(sessionId,seatId).
EventBookingService create(userId,{eventSessionId,seatIds}), getById/list/payable,
confirm(id,scope),failUnfulfilled(id,reason,scope),cancel(userId,id,scope),releaseHold,
availability(sessionId). Trusted gateway exposes the existing methods consumed by
PaymentService/RefundService, selecting domain from persisted Booking kind.
Existing movie API remains compatible; POST /api/event-bookings creates holds;
GET /api/event-sessions/:id/availability uses permanent+Redis read. Shared payment,
cancel,refund and history APIs handle either target without client success flags.

- [ ] Write/run RED tests for domain routing, owner validation, quote/hold TTL,
  wrong venue/target, expiry, final allocation, cancellation cutoff/seat release.
- [ ] Implement additive target checks and separate event quote/allocation guards;
  adapt common booking state triggers without weakening original movie guards.
- [ ] Reuse exact all-or-nothing Lua with separate namespace, inspect all seats and
  durable allocation last. Repository locks Booking then parents/seats in stable
  order; scopes share the same transaction, cleanup runs only after commit.
- [ ] Existing provider evidence, unique identities and durable refund rules route
  to target-aware confirmation/cancellation. No DB transaction around provider HTTP.
- [ ] Native concurrency: two owners, atomic multi-seat failure, TTL expiry,
  allocation collision, replay/browser-close recovery, late capture compensation,
  duplicate cancellation/refund retry, cancellation/rebooking/read races.
- [ ] Existing movie full tests/native suite must pass unchanged security checks.
- [ ] Scoped spec and quality review before downstream integration.

### Task 3: guarded repeatable event seeds

Files: backend/prisma/event-seed{,-core,-manifest}.ts; npm command; event-seed unit
and native integration tests; docs/events-sports-booking.md setup.

- [ ] RED guard/idempotency/identity collision and historical data preservation tests.
- [ ] Original fictional performer/team metadata and original CC0 illustrations;
  existing NewDelhi/Mumbai/Bengaluru cities only. Per city, at least one comedy,
  cricket/football/arena sport and seated workshop: persisted venue sections,
  numbered physical rows/capacity, future sessions and STANDARD/PREMIUM/VIP prices.
- [ ] Never overwrite existing catalog edits/history/credentials; reject identity
  collisions. Explicit dev-only command, never automatic production invocation.
- [ ] Native rerun/concurrent seed proves no duplicates or history mutation;
  target verification precedes dev migrations/seed. Scoped review.

### Task 4: event details, stage/stadium seating and shared checkout UI

Files: new frontend/api/events.ts, event DTOs, EventPage/EventSeatsPage/venue renderer;
CategoryPage/App adapters, existing checkout/history/booking facts target-aware;
event/UI tests and responsive CSS. Preserve existing sample-only details routes.

- [ ] RED tests for real persisted event details, city session choice and prices,
  owner login/hold, no browser total, payment verification/recovery, history/refund.
- [ ] Cards show supported event listings plus accurate sample-only unavailable
  items; no duplicates of same seed concept. All visible cards have working details.
- [ ] Stage with standing performer/mic; stadium/cricket/football/court visualization
  and persisted sections/rows/tier seats, accessible state legends. Geometry only
  affects display, never fabricates identity/price/availability. Touch scroll/zoom
  uses proper viewport container; page itself must not overflow.
- [ ] Shared booking checkout/ticket/cancellation uses backend discriminated target,
  backend expiry and verified provider/payment state. No fake payment success.
- [ ] Full frontend tests/typecheck/lint/build and scoped review.

### Task 5: full verification and handoff

- [ ] Fresh all unit/native movie+event concurrency/provider/refund/seed tests,
  Prisma/migrations, typechecks/lint/build/smoke/audits with zero unreported skips.
- [ ] Browser controlled-provider movie and event journeys, login/profile/wishlist,
  admin/help, all category cards and cities; no real live payment claim.
- [ ] Widths320/390/768/1024/1440 including card proportions/footer/pin/dialogs,
  stage/stadium/checkout/ticket/history; reduced-motion/hover/skeleton/image checks.
- [ ] docs/ui-polish.md, events-sports-booking.md, ui-integration.md and
  implementation-progress.md: exact files/models/APIs/inventory/evidence/limitations.
- [ ] Whole-pass review and any findings handled; no commit/deploy/cleanup of records.
- [ ] Keep localhost populated services running and give exact launch commands.

## Preflight and execution ledger

Base:54ac39c18037c0ffb851c3644e267f0fc658c556; uncommitted existing work preserved.

| Task/interface pair | Producer -> consumer | Check |
|---|---|---|
| 1 alone | inventory models -> read DTOs | no bookability/financial writes |
| 2 alone | XOR/separate event allocations -> shared evidence | movie guards retained |
| 3 alone | deterministic seeds -> actual persisted inventory | no existing edits overwritten |
| 4 alone | persisted DTOs -> geometry/checkout | client never owns price/success |
| 5 alone | command/browser evidence -> report | no stale results as new evidence |
| 1/2 | session/physical seat/prices -> quote/confirmation | event and movie inventory separate |
| 1/3 | schema/domain constraints -> complete-layout seeds | capacity and tier coverage agree |
| 1/4 | public DTOs -> adapters/details | document exact shape before UI coding |
| 2/4 | discriminated booking summary -> checkout/history | common provider APIs unchanged |
| 3/4 | demo + supported event examples -> category cards | genuine inventory vs unavailable labelled |
| 1–4/5 | integrated source -> regression evidence | rebuild after last changes |

Ruling: user requested this dirty existing checkout and forbids commits; preserve
the checkout and document/review working files, not empty commit ranges. No scratch
cleanup since no committed recovery exists. Cost if wrong: additional manual diff
review required, rather than losing existing user work.
Ruling: public inventory creation/admin writes are not needed for v1 customer event
booking; guarded seeds supply inventory. No organizer reschedule/cancel APIs until
policy approved. Cost if wrong: admin event editing requires a later scoped module.

Task 1 complete after scoped fix review (deferred section-deletion capacity gap fixed).
Task 2 complete after scoped repository-boundary fix review. Task 3 in progress;
Task 4 pending; Task 5 pending. Final full-suite/browser acceptance remains Task 5.
