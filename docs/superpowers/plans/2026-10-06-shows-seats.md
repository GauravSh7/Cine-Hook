# Shows / Seats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver approved physical layouts, show scheduling and normalized seat-type prices without booking/Redis/payment logic.

**Architecture:** Preserve Route -> Middleware -> Controller -> Service -> Repository -> Prisma -> PostgreSQL. Repository transactions load stable scheduling contexts; service callbacks enforce policy. Database exclusion and integrity guards protect races and alternate writers.

**Tech Stack:** Existing Express/TypeScript, Prisma/PostgreSQL, Zod, Vitest/Supertest; no new npm dependencies.

**Spec:** docs/shows-seats.md and the user's approved Shows/Seats contract.

## Global Constraints

- Do not commit/push, expose secrets, or edit synced sources.
- Seat has no permanent availability status; no Redis/bookings/payments here.
- Seat types: REGULAR/PREMIUM/RECLINER, unique screen/row/number.
- Per-show seat-type prices; timezone-aware input, UTC persistence, duration snapshot.
- Race-safe screen overlap prevention and protected layout/venue dependencies.
- Work in the existing checkout as requested; preserve existing uncommitted work.
- The user authorized automatic ordinary execution; no additional plan approval gate.

## Review Focus

- Simultaneous schedules cannot both occupy overlapping screen intervals.
- Parent moves/layout/capacity writes racing with scheduling cannot invalidate it.
- Every present seat type has exactly one positive integer price; incomplete writes roll back.
- Calendar-invalid or timezone-free inputs receive safe 400 responses, not normalization surprises.
- Movie-duration edits do not change existing endsAt snapshots; disabled movies are hidden.

---

### Task 1: Behavior tests and database model

**Files:** Create backend/tests/shows.test.ts and backend/tests/shows.integration.mjs; modify backend/prisma/schema.prisma; create backend/prisma/migrations/20261006000300_shows_seats/migration.sql.

**Interfaces:** ShowStore.schedule(input, prepare(context)) returns ShowDetail. SeatStore.initialize(screenId, seats, validate(context)) returns Seat[]. Schema delegates: show, seat, showSeatPrice; enum SeatType and ShowStatus.

- [x] Write/run failing HTTP tests and real database regressions for schedule creation, pricing, complete layout, UTC/end-time snapshot, overlaps, access/validation and venue guards.
- [x] Add Seat, Show, ShowSeatPrice, enums/relations/indexes and additive SQL integrity guards.
- [x] Generate/validate Prisma and inspect SQL changes; apply only to a fresh isolated test cluster.

### Task 2: Layers and wiring

**Files:** Create backend/src/modules/shows/{show.types,show.validation,show.repository,show.service,show.controller,show.routes,seat.repository,seat.service,seat.controller,create-shows}.ts and backend/src/modules/shows/scheduling-write.ts. Modify backend/src/{app,server}.ts, catalog.routes.ts, catalog venue repositories, existing test fixtures, backend/package.json.

**Interfaces:** createShows(prisma): ShowServices; ShowService.create/list/getById/getSeats; SeatService.initialize/list. Prices input is [{seatType,pricePaise}]; layout input is {seats:[{rowName,seatNumber,seatType}]}.

- [x] Implement transactional repositories and pure service policy callbacks with typed contexts.
- [x] Add strict validation, HTTP-only controllers, public routes and path-scoped existing ADMIN middleware.
- [x] Protect existing venue writes using database guards; translate known integrity conflicts into safe 409 errors.
- [x] Run all unit/HTTP tests to green, then typecheck/build and compiled runtime tests.

### Task 3: Verification, review and checkpoint

**Files:** Update docs/shows-seats.md, docs/implementation-progress.md, README.md and this plan.

- [x] Run Prisma validation/generation, typecheck, all tests, build, smoke, live database integration, audit, frontend checks and diff checks.
- [x] Obtain fresh independent code/concurrency review, address important findings with regression tests, rerun checks.
- [x] Record every changed/created file, exact request flow, schema relationships, decisions and actual verification.
- [x] Inspect the next Booking/Redis context. Continue if its contract is known; otherwise stop only at the user's approved ambiguity gate.

## Execution ledger

Task 1 complete: initial layout HTTP RED (expected201/actual404), native model
and guards, schema generation/validation, fresh-test migration succeeds.
Task 2 complete: full suite143passed; typecheck/build/smoke pass. Native/HTTP
Shows tests pass alongside existing Auth/Catalog; no external/user DB changed.
Task 3 complete: independent review has no current blocker; full live integration
4passed; both audits0; frontend checks pass. See docs/shows-seats.md for details.

Ruling: direct SQL pre-show layout replacement may occur in a complete
transaction; API remains one-time initialization only. Existing Show rows
freeze the physical layout and venue identity. No physical IDs are silently
replaced by any API, and there is no destructive layout endpoint.
Ruling: protected writes explicitly require READ COMMITTED, with matching SQL
enforcement, to avoid repeatable-read cross-table stale snapshots. Alternate
writer isolation modes fail safely; Booking transaction policy is not decided.
Ruling: optional Show DI in the app factory preserves focused old-module tests;
the production server always supplies the module. Catalog's broad admin router
is unchanged; Show path-specific guards run before it.
Ruling: HTTP body-policy errors use400; inactiveMovie uses404 consistently with
Catalog; dependency/concurrency/overlap errors use409. Actual Prisma7.10 P2039
metadata supplies PostgreSQL codes for safe translation.

Next: Booking/Redis contract not recovered; user-authorized architecture gate
recorded in implementation-progress.md. No Booking/Redis code started.
