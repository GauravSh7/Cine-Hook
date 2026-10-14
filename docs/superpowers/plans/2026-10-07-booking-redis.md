# Booking / Redis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver approved temporary holds, permanent priced bookings/allocation and combined availability, then stop before Payments.

**Architecture:** Route -> Middleware -> Controller -> BookingService -> BookingRepository -> Prisma -> PostgreSQL. BookingService also calls separate SeatLockService -> Redis atomic Lua. Repository-owned transactions and status/uniqueness guards protect permanent state.

**Tech Stack:** Existing Express/TypeScript, Prisma/PostgreSQL, redis6.3, Zod, Vitest/Supertest; no provider SDK or new npm dependency.

**Spec:** docs/booking-redis.md and the user's approved Booking/Redis contract.

## Global Constraints

- 300000ms holds; Redis-only, show-specific, atomic all-or-nothing, owner-checked, no renewal.
- PENDING/CONFIRMED/FAILED/CANCELLED; immutable Show/Seat/server-price snapshots.
- PostgreSQL enforces confirmed uniqueness; no Seat availability column.
- No public confirmation or Razorpay/webhook/refund/late-payment handling.
- Preserve existing uncommitted work; no secrets, commits, pushes or synced-source edits.
- Existing-checkout/automatic-execution authorization overrides ordinary skill approval/commit steps.

## Review Focus

- Busy second seat/runtime failure leaves no partial acquired keys; old same-user release cannot clear a new hold.
- Expiry between Redis validation and DB transition/commit rejects confirmation without renewing.
- Concurrent confirmed bookings cannot allocate the same seat, including partial collision rollback.
- Unknown Redis/DB outcomes trigger fenced cleanup without false paid confirmation or permanent state overwrite.
- Ownership/hidden histories, BIGINT money and Redis outages yield safe bounded responses.

---

### Task 1: Redis atomic boundary

**Files:** backend/src/modules/seat-lock/{seat-lock.types,seat-lock.service,seat-lock.scripts}.ts; backend/tests/seat-lock.test.ts; backend/tests/seat-lock.integration.mjs.

**Interfaces:** SeatLocks.acquire(showId,seatIds,userId,holdId)->expiresAt; release->count; validate->boolean; inspect->Map of locked/remainingMs. Actual redis client sendCommand is the I/O port.

- [x] Observe RED successful acquire versus fail-closed stub; implement bounded Lua/service validation.
- [x] Run20unit and8realRedis tests, including rollback, expiry, races and owner fencing.

### Task 2: Permanent model and database guards

**Files:** backend/prisma/schema.prisma; backend/prisma/migrations/20261006000400_booking_allocations/migration.sql; backend/tests/booking-database.integration.mjs.

**Interfaces:** Booking(totalPaise BIGINT, expiresAt), BookingSeat(price integerpaise), ConfirmedSeat PK(showId,seatId). SQL triggers atomically allocate on PENDING->CONFIRMED, enforce history/totals/state/expiry and protect dependent Show identity.

- [x] Booking HTTP RED: expected201/actual404 with existing Auth/Show fixtures.
- [x] Add schema/migration/native tests without touching an existing user database.
- [x] Generate/validate and apply all migrations to a fresh isolated test database; run native tests.

### Task 3: Booking layers and failure paths

**Files:** backend/src/modules/booking/{booking.types,booking.validation,booking.repository,booking.service,booking.controller,booking.routes,booking-write,create-booking}.ts; backend/src/middleware/require-current-user.ts; app.ts/server.ts; tests/booking.test.ts/helpers/booking.ts/booking.integration.mjs; package.json/CI.

**Interfaces:** BookingStore.context/createPending/transition/findById/listByUser/failPending/expirePendingForUser. Context callbacks enforce policy, while repository owns database locks/I/O. BookingService public create/get/list/releaseHold/availability plus internal confirm.

- [x] Write failing ownership, pricing, expiry, cleanup, confirmation and availability tests.
- [x] Implement layers with live Redis validation and fixed lock order; wire existing middleware/server.
- [x] Verify no public confirm route; run full suite plus combined live PostgreSQL/Redis API tests.

### Task 4: Verification and required checkpoint

**Files:** docs/booking-redis.md, docs/implementation-progress.md, README.md and this plan.

- [x] Independent final review and regression fixes.
- [x] Full tests/typecheck/Prisma/build/audit/runtime/frontend/native+Redis verification.
- [x] Document exact files, flows, allocation/expiry/compensation decisions and known limitations.
- [x] Stop at Booking/Redis checkpoint before Payments; no automatic Payments work this turn.

## Ledger

2026-10-07: Resumed after helper usage interruption. Partial Redis/schema work saved.
InitialBookingHTTPRED404confirmed; Redis20unit+8live pass. CoreBooking not complete.
Ruling: normalized ConfirmedSeat enforces uniqueness without losing historical
BookingSeat snapshots. Cost: one additional allocation relation and integrity guards.
Ruling: Book UUID supplements authenticated user ownership to prevent ABA release;
no renewal policy or user authority changes. Cost: hold values include an internal fence.

2026-10-07 final: 195 unit/HTTP, 23 live integration (0 skips), 2 smoke tests;
Prisma validate/generate/status, typecheck/build, frontend lint/build and both
audits pass. Review fixes observed RED -> GREEN: final PG availability read and
serialized create recovery before cleanup. UTC pooled sessions fix native epoch
mismatch; direct SQL assertions verify actual instants, not deceptive ORM DTOs.
Independent final review: no current-module blockers. No dependency/lockfile/
frontend source changes in this module, secrets, commits/pushes or Payments work.
Stopped at required checkpoint. Details/limitations in docs/booking-redis.md.
