# CineHook UI polish and read-only category details implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this approved safe
> pass. Permanent event booking is gated in the linked spec. No commits or pushes.

**Goal:** Complete all safe requested polish and category navigation without
inventing event inventory or changing movie financial behavior.

**Architecture:** Existing demo Route -> validation -> Controller -> Service ->
Repository -> Prisma reads, plus typed frontend adapters and dedicated detail UI.
No schema migration; no booking/payment/Redis writes from new categories.

**Tech Stack:** Existing React/Vite/TypeScript/Tailwind, Express/Prisma/PostgreSQL.

**Spec:** ../specs/2026-10-10-events-sports-booking-design.md; safe-work section
and the user's attached final UI polish request. Existing checkout execution
and continuous work are explicitly requested; no separate ordinary approval pause.

## Global constraints

- Preserve all data, provider secrets, movie flows and original cinehook database.
- Use cinehook_dev on port 5432; no reset, automatic production seed or deployment.
- Footer remains only on `/` and `/movies`; preserve graphical link identities.
- Keep required sample/media/legal/provider sandbox disclosures; no fake availability.
- Touch targets >=44px; reduced-motion disables unattended visual effects.
- No event booking tables or money/cutoff assumptions before the architecture gate.

## Review focus

- Cross-kind or inactive listing IDs must not leak a listing via the detail API.
- Unknown cities must fail safely, not imply support; wildcard search stays literal.
- City changes must reset paging/filter reads and discard stale results.
- Category navigation must not issue booking/payment requests for sample content.
- Removing copy must not hide fictional inventory, sandbox payment or media rights.

### Task 1: read-only detail and supported-city API

Files: modify backend/src/modules/demo-catalog/demo-catalog.{types,validation,
repository,service,controller,routes}.ts; extend tests/demo-catalog-http.test.ts;
new tests/demo-catalog-service.test.ts and repository tests; extend native
tests/refinement.integration.ts.

Interfaces: DemoStore.findActive(kind,id), DemoStore.findCityName(cityId),
DemoStore.list(query with server-resolved cityNames); DemoCatalog.get(kind,id)
returns {listing: public demo DTO}; list accepts validated cityId, while storage
cityNames is never browser input. Use exactly matched stored city or Delhi/New
Delhi alias for the existing development names; no new coverage or city writes.

- [ ] Write/run failing HTTP tests: details 200, malformed UUID/kind 400,
  wrong-kind/inactive/missing 404, no writes, unknown city 404; city query bounds.
- [ ] Implement scoped active repository reads, service projection and route.
- [ ] Tests: service unknown-city rejection, city-bound output, cityless Stream;
  repository predicates; native source-id/kind/filter checks.
- [ ] Run backend suite and typecheck; expected all pass, no hidden skip claims.

### Task 2: working category detail UI and copy

Files: frontend/src/api/demo-catalog.ts, pages/CategoryPage.tsx, new
pages/ListingPage.tsx, App.tsx; new tests/ui-polish.test.tsx; update existing
category/footer copy assertions only where intentional requirements changed.

Interfaces: detail adapter GET /demo-catalog/:kind/:id, list cityId; routes
/stream/:id, /events/:id, /sports/:id, /activities/:id. Details show persisted
title/art/description/category/city/venue/date/duration/credit plus selected-city
context and truthful disabled tickets/playback. No fabricated performer/price.

- [ ] Write/run RED navigation, city requery, error/retry/wrong-kind and
  unavailable action tests. Expect new detail navigation/API contract failures.
- [ ] Implement real links, details adapter/screen, current-city list refresh.
- [ ] Audit customer copy; keep necessary legal/sample/sandbox indications,
  replace technical state/price language with natural truthful explanations.
- [ ] Run frontend full suite; expected all pass, no booking authority changes.

### Task 3: compact proportions and consistent lightweight motion

Files: frontend/src/components/PublicLayout.tsx, new LocationPin.tsx,
components/RouteScope.tsx, new ui-polish.css imported by main.tsx; relevant
customer pages for copy. Tests cover rendered links/pin/menu focus behavior;
CSS proportions/motion are measured in the browser, not source-string tests.

- [ ] Test footer labels/click targets, SVG location pin, Escape restores focus,
  safe footer-only landing scope; watch RED then implement.
- [ ] Approximately 10–15% shorter cards at unchanged readable widths; compact
  typography/padding and image crop, uniform section heights, 44px actions.
- [ ] Icons 58->50px, brand64->56px; centered requested labels. CSS hover/focus,
  image zoom, nav underline, modal/page/menu entrance, seat feedback, skeletons;
  no heavyweight library, no animated layout dimensions, respect reduced motion.
- [ ] Browser compare baseline height549.73px/poster323.63px at1280px and all five
  requested widths; adapt safely if any labels/images/buttons become cramped.

### Task 4: verification, evidence and architecture checkpoint handoff

- [ ] Full tests/typechecks/lint/Prisma validate+generate/builds/audits/native
  tests/smoke; read every final result. No stale results claimed as this pass.
- [ ] Guarded seed rerun proves no duplicates; existing24 fictional listings
  remain intact; no new bookable seed before review. Check target identity first.
- [ ] Browser widths320/390/768/1024/1440, actual category detail links/city changes,
  footer/location/menu/motion, supported movie seat/auth/profile/wishlist/admin
  regressions; save snapshots/measurements. Controlled providers remain labelled.
- [ ] Update docs/ui-polish.md and implementation-progress.md with exact source/API
  inventory, current results, preserved data and explicitly gated unpaid event scope.
- [ ] Request approval of proposed event target/numbered seat/refund contract.

## Execution ledger

Task 1: complete. Task 2: complete. Task 3: complete.
Task 4: safe unit/native/build/city/details/responsive evidence complete;
full supported movie/provider/profile/admin browser regression is carried into
event plan Task 5 to avoid duplicating the same final pass. Architecture approval
received; event execution continues, no ordinary module pause.
Evidence: docs/ui-polish.md. Latest frontend166/17; backend safe635/38;
native79 with zero failures/skips. No schema/financial changes in this safe pass.
Pre-flight: Task1 public DTO/API consumed by Task2; backend-only resolved cityNames
must never become a client query option. Task2 route classes consumed by Task3
CSS; financial/seat pages are CSS/copy-only. No event payment interface changes.
Ruling: use the existing dirty checkout, not an empty worktree; the user explicitly
requires preservation and continuation here. No commit steps/workspace deletion
will run because existing work belongs to the user and commits are forbidden.
