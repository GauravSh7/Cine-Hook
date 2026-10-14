# CineHook UI Integration Implementation Plan

> **For agentic workers:** Use executing-plans + TDD. Independent read projection
> and frontend API-domain work may run under dispatching-parallel-agents. No Git
> mutations. Existing checkout/user automatic execution contract is authoritative.

**Goal:** Implement approved cinematic UI with real backend truth/recovery.
**Architecture:** API/domain adapters -> focused React pages; unchanged backend
layers with read-only projection module. Provider SDK is not payment authority.
**Tech Stack:** React/Vite/TypeScript/Tailwind; React Router; Vitest/RTL for tests.
**Spec:** docs/superpowers/specs/2026-10-07-ui-integration-design.md.

## Global constraints

Pinned MagicPath revision458212875450880001; original dark/red composition.
No authoritative client price sum or paid/refunded flag. Backend expiry controls
hold; no renewal. No passwords/provider secrets persisted. /me current role
controls admin navigation, backend guards all permissions. No new domain state,
schema, financial policy, Redis semantics, background queues/scaling/monitoring.
No commit/push, destructive migration, environment or foundation-record change.

## Review focus

- Late/stale async response after route/user change must not display prior data.
- Payment callback/network failure must not fabricate CONFIRMED or duplicate order.
- Expired/lost holds across reload/payment close must fail cleanly and recover DB.
- CANCELLED/REFUND_PENDING/REFUNDED vs legitimate primary funding/extra compensation.
- Admin includes historical/disabled data and never leaks it to normal users.

## Task1: Read-only backend UI projections (independent)

Create backend/src/modules/ui-read/{ui-read.types,ui-read.repository,
ui-read.service,ui-read.controller,ui-read.routes,create-ui-read}.ts and
backend/tests/ui-read.test.ts. Root wires app.ts/server.ts after completion.
Produces createUiRead(prisma,bookings), uiReadRoutes(services,auth); service
bookingSummary(owner,id), dashboard(), movies(query), shows(query),
bookings({page,limit,search?}), payments({page,limit}). Owner summary envelope
data={booking,show,payment:null|DTO,refunds:DTO[]}; money integer paise Numbers.

- [x] RED owner/foreign/unauth/admin-role/validation/disabled-history/nullable
  payment/no-secret DTOs; UTC stats and integer conversions.
- [x] GREEN read repository DB projections and safe service mapping; no writes
  except existing BookingService observation before read transaction.
- [x] Focused/full backend unit/typecheck/build; root read-source review.

## Task2: Frontend API/domain foundation (independent after contracts)

Create frontend/src/api/{client,types,catalog,booking,payment,auth,admin}.ts,
frontend/src/domain/{booking-state,time,razorpay}.ts and frontend/tests/domain.test.ts,
api.test.ts. Root owns package/config, auth context, pages/layout/router.
client api<T>(path,{method,body,signal,token?}) returns Promise<T>; setAccessToken
and getServerNow. Dedicated methods never serialize browser amounts/flags.
types BookingSummary{booking,show,payment,refunds}, admin Page<T>, OrderResult.

- [x] RED trusted payload/HTTP-safe errors/401/timeout/Abort/Date offset, exact
  hold boundary/invalid dates, no client success inference, SDK loader failure.
- [x] GREEN typed fetch/DTOs/domain state and official SDK loader.
- [x] Run all frontend tests/typecheck; no pages/package edits by helper.

## Task3: Home / movie / shows / seats

Root: modify App.tsx/index.css; create app/session context, layout/components,
pages/HomePage.tsx, MoviePage.tsx, SeatsPage.tsx; frontend/tests/discovery.test.tsx.
React Router links /movies/:id, /shows/:id/seats. City preference changes queries,
no fabricated GreaterNoida data. Reproduce hero/cards/date/theatre/seat footer.

- [x] RED render API movies/details/UTC show selection; empty/error/retry;
  booked/locked disabled, selected AVAILABLE IDs only, 10-seat limit and login
  resume; POST body IDs only; trusted checkout navigation/quote.
- [x] GREEN real data/hooks/loading/skeleton and responsive visual composition.
- [x] Focused/full frontend tests and lint/build before next feature.

## Task4: Checkout / result / bookings / refunds / auth

Create pages/CheckoutPage.tsx, BookingPage.tsx, BookingsPage.tsx, AuthPage.tsx;
shared booking/ticket/status/countdown components; tests/booking-flow.test.tsx.
Route /bookings/:id/checkout and /bookings/:id; all reload/recovery by owner API.

- [x] RED countdown/backend prices, no fee/coupon fabrication, SDK->verify->
  refreshed authoritative booking, callback failure and browser-close recovery,
  no ticket for merely captured/failed, expire/lost hold, cancelled/refund states,
  retry and cancellation body{}, login/register/current role/return route.
- [x] GREEN focused pages, bounded polling/focus refresh, no auto POST retry,
  no password persistence; print/download factual confirmed ticket.
- [x] Focused/full tests/typecheck/lint/build before admin integration.

## Task5: Approved admin surfaces

Create pages/AdminPage.tsx with focused forms/table components, tests/admin.test.tsx.
Read server stats/all-movies/shows/bookings/payments; use existing create/edit/
disable Movie and create Show APIs. Show fields use timezone-aware ISO and
per-present-type prices; no fake flat price. Current /me ADMIN gating and safe
denial. Unsupported Show edit is explicitly disabled, not silent mock success.

- [x] RED admin denial, actual read fields, safe forms and writes, disabled/past
  records, provider/refund states and server totals; mobile tables/nav accessible.
- [x] GREEN approved sidebar/cards/tables, responsive forms, read/retry states.
- [x] Full frontend/backend regression tests and source review.

## Task6: Real local journeys / responsive / checkpoint

Create test-only backend/tests/ui-browser-server.mjs (validated isolated PG/Redis,
real app/adapter with controlled provider and labelled fake SDK); no production
test endpoints. Seed exact disposable fixtures, normal user + ADMIN, scheduled
typed seats, locked/booked examples; owner full flow/compensation/admin tested.
Root owns service lifecycle + CUA browser; nobody else starts/stops services.

- [x] Browser actual home->auth->show->seat->booking->checkout->fake-provider
  verify->ticket->history->cancellation/refund, reload recovery; admin reads/forms;
  no real provider transaction. Include unavailable/empty/failure states.
- [x] Responsive390/768/1440, touch seat scroll, keyboard names/focus and table
  overflow. Fresh independent read-only final review, RED->GREEN important fixes.
- [x] Full frontend lint/typecheck/test/build, backend tests/integration/smoke,
  Prisma validate/generate/status, both audits. Stop own verified test services.
- [x] docs/ui-integration.md exact inventory/API/visual differences and progress;
  foundation unchanged/no commits/no push; report external-provider limitations.

## Ledger / preflight rulings

Final checkpoint: 2026-10-08. All six tasks completed locally, including final
independent review and RED->GREEN fixes. Fresh verification: 56 frontend tests,
409 backend unit tests, 68 live integration results (zero skipped), two compiled
smoke tests, lint/typechecks/builds, Prisma validate/generate/six-migration status
and both audits (zero vulnerabilities). Browser journeys used the actual app and
isolated PG/Redis with controlled external provider delivery, not real money.
All 42 responsive states at 390/768/1440 had no document-level horizontal overflow.
Task services were stopped, browser tabs closed and viewport restored. Foundation
and Git HEAD are unchanged. See ../../ui-integration.md and
../../implementation-progress.md for inventory, flow, evidence and remaining
external-provider/deployment boundaries. No scalability work started.

Ruling: User already approved visual/architecture and explicit automatic execution;
routine skill artifact gates/commits/worktree steps do not reauthorize/restructure
the product. Spec/plan record actual integration boundaries; work stays inline.
Ruling: Missing read projections are ordinary same-layer UI support, not a new
money policy. No schema migration or domain writes; existing financial APIs reused.
Ruling: Prototype unsupported fields remain unavailable/disabled and documented,
not new invented ratings/coupons/fees/trailers. Cost: limited prototype controls.
Ruling: Session storage token is scoped to tab/reload; browser close can re-login
and recover DB bookings. No durable plaintext password or unverified JWT role.
Cost: no refresh-token/remember-me feature; backend no new authentication scheme.

Preflight interfaces: read projection -> frontend types -> pages share exact DTOs;
new module independently owns files, root owns app wiring. Frontend API helper
owns no pages/styles/config. All tests use complete literal DTO fixtures.
