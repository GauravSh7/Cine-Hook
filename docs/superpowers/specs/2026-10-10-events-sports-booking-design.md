# CineHook live event / sports booking architecture checkpoint

Status: **APPROVED — implementation in progress**.
The user approved the recommended shared booking contract on 2026-10-10,
including dedicated inventory, exclusive movie/event target, numbered reserved
seats and the existing full-refund/cancellation policy. This approval is not a
claim that event payments or migrations have already been implemented.

## User intent and current evidence

The user wants shorter movie cards, labelled graphical footer links, a location
pin, natural customer copy, working details for every category card, tasteful
motion, and genuine numbered-seat comedy/sports booking. Preserve the existing
checkout, financial truth, refund rules, owner access and all personal records.
No commits/push/deployment or scalability work.

The inspected schema requires `Booking.showId -> Show -> Movie + Screen`.
`BookingSeat` has composite booking/show identity; physical `Seat` belongs to
Screen. `ConfirmedSeat(showId,seatId)` is permanent allocation authority.
SQL constraints/triggers additionally enforce movie seat/pricing/state integrity.
Payment has a unique required Booking reference; capture reconciliation/refunds
and current summary/cancellation derive fulfillment and cutoff from that Show.
`DemoListing` has no booking relation and only city/venue names, not inventory.
It cannot become bookable by changing a button or borrowing a cinema Screen.

## Options

1. **Recommended: shared Booking/Payment identity, dedicated event inventory.**
   Add an event target to Booking with a database-enforced exclusive-or target,
   retaining movie-specific BookingSeat/ConfirmedSeat constraints. Separate event
   quote/fulfillment/allocation tables and services share the existing financial
   pipeline through a trusted target-aware fulfillment gateway. Unified history,
   provider event identity and compensation avoid two competing financial engines.
   Cost: additive but significant changes to raw SQL guards, booking read DTOs and
   payment/refund target resolution. Requires complete native race regressions.
2. **Separate EventBooking/EventPayment/refund subsystem.**
   Least change to existing movie tables, but duplicates financial identity,
   evidence/webhook routing/reconciliation/retry logic and needs merged history.
   This is larger and risks divergence of payment/refund policies.
3. **Generic replacement inventory/booking redesign.** Not recommended.
   Replacing Show/Screen/Seat with generic sessions would weaken/change the
   approved movie constraints and require unnecessary migration of existing data.

## Recommended v1 permanent contract — for review

- Event: stable identity/title/description/kind/sport; explicit fictional sample
  flag and media provenance. Performer records for comedy and participant/team
  records for sport are persisted, not scraped/invented claims about public events.
- EventVenue: belongs to an existing supported City; venue kind AUDITORIUM,
  STADIUM or ARENA, name/address, declared capacity and immutable layout once used.
  It is independent of Theatre/Screen.
- EventSection: belongs to venue; unique venue/code, display name and bounded
  map geometry/order. EventSeat belongs to section, with rowName/seatNumber and
  event ticket tier STANDARD/PREMIUM/VIP; unique section/row/number.
  These are permanent physical seats, never LOCKED/BOOKED rows.
- EventSession: belongs to Event + EventVenue, normalized UTC startsAt/endsAt,
  status/timestamps. Reject overlapping active sessions for one venue, including
  PostgreSQL exclusion protection. Capacity must equal physical seat count;
  venue-parent/layout changes are blocked after dependent sessions.
- EventSessionPrice(sessionId,ticketTier): unique typed server price in INR paise.
  EventBookingSeat stores session/seat/final price snapshot, immutable thereafter.
- Booking adds bookingKind and nullable eventSessionId; showId becomes nullable.
  PostgreSQL CHECK and target FKs require **exactly one** valid target. Old movie
  rows stay unchanged; no historical data conversion or deletion is needed.
- EventConfirmedSeat(sessionId,eventSeatId) has a unique primary allocation and
  composite FK to EventBookingSeat. Native SQL enforces seat venue/session match,
  price snapshot, target kind and valid parent status, parallel to movie guards.
  Movie guards remain mandatory for MOVIE bookings, not removed or generalized away.
- All physical-seat holds use atomic all-or-nothing Lua with five-minute Redis
  TIME expiry and authenticated user/booking owner-fenced release. Event namespace
  is separate (for example `cinehook:event-seat-lock:{sessionId}:seatId`). No memory
  fallback, implicit extension or reacquisition; DB stays allocation authority.
- Keep movie BookingService; add EventBookingService and event repositories.
  A small trusted fulfillment/target gateway reads durable Booking kind, never
  client `paid` data, to route PaymentService confirmation. Provider calls stay
  outside transactions; capture/evidence and finalization use short DB transactions.
  Provider identifiers remain globally unique across movie/event captures/refunds.
- Cancellation releases the appropriate permanent allocation rows atomically with
  Booking CANCELLED; quote history survives. Payment financial truth remains
  SUCCESS -> REFUND_PENDING -> REFUNDED. Failed fulfillment gets durable full
  compensation, never a revived ticket. No new client-controlled success API.

## Material decisions requiring the user's approval

1. Adopt option 1 (shared Booking/Payment with dedicated event inventory), rather
   than option 2's separate financial engine.
2. Use **reserved individually numbered seats** for v1 comedy/sports. No
   general-admission counters/standing blocks/mixed cart yet. Seated Events or
   Activities may use this contract; unseated experiences remain non-bookable.
3. Apply the existing v1 policy to event sessions: owner cancellation strictly
   before session start, 100% trusted captured-amount refund, no fees; full
   paid-but-unfulfilled compensation regardless of session time. Organizer
   cancellation/rescheduling is not silently assigned a new policy.

These choices change permanent target constraints and cutoff/refund semantics,
so the user's requested architecture gate applies. No such migration is written
or applied before review. After approval, a reviewed implementation plan will
cover schema/constraints, module APIs, adapter integration, repeatable fictional
venue/session/seat/pricing seed and complete concurrency/native/browser tests.

## UI and API shape after approval (proposed, not current)

Public Event/session/venue/availability reads use the existing layered structure;
owner-authenticated event booking creation and the shared booking financial APIs
use trusted server quotes. A separate stage/performer renderer displays actual
persisted auditorium rows/aisles; stadium renderer uses persisted sections around
a cricket pitch/football field/court. Geometry is display-only; database seat IDs,
server prices and current availability determine selectable inventory.

Movies keep `/shows/:id/seats`. New event sessions will have dedicated seat-map
routes, not a cinema screen ID. Unified My Bookings and admin reads distinguish
movie/event targets. No dummy stadium map becomes an operational purchase UI.

## Safe work permitted before the gate

Complete the requested visual/copy/accessibility polish and public read-only
`GET /api/demo-catalog/:kind/:id` details on existing DemoListing data. Add verified
supported-city filtering to catalogue reads; cityless online concepts stay global.
Every category card links to a real detail route with an honest unavailable state.
Maintain sample disclosures and artwork/legal/provider sandbox indicators.
This changes no Prisma schema, money flow, Redis behavior or booking allocation.
