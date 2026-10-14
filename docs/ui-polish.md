# UI polish and category navigation — 2026-10-10

## Current status

The safe visual/read-only pass and Tasks1–4 of genuine comedy/sports booking are
implemented and reviewed, including checkout and stage/stadium/court geometry.
Final automated checks passed on 2026-10-11:194frontend/675backend unit tests,
118native/seed/fixture/smoke results with0skips; typechecks/lint/builds/Prisma
status/diff and both0-vulnerability audits. A reported transient worker crash
did not reproduce in the unchanged full backend repeat. Controller browser acceptance
at320/390/768/1024/1440 is pending and must be recorded separately. See the
[approved event design](superpowers/specs/2026-10-10-events-sports-booking-design.md)
and [event implementation plan](superpowers/plans/2026-10-10-event-booking.md).
Existing movie payment/refund behavior was not changed by the visual pass.

Task5 adds guarded native registration, five event browser fixtures and strict
signed raw recovery/replay helpers in tests only. Its full evidence is recorded
in `.superpowers/sdd/2026-10-10-event-booking/task-5-report.md`; no production
provider credentials, fake success flag, new financial policy or real payment
claim accompanies these checks. Historical screenshot results below retain
their original date/scope and do not certify the current event interfaces.

## Screens and interactions

- All six Movies landing rails use the same shorter poster/card proportions.
  Verified rating, title, language/year and booking action remain visible. A
  1280px before/after comparison measured card height 549.725 -> 491.575px
  (10.58% smaller), poster 323.625 -> 280.475px (13.33% smaller), with unchanged
  217.35px card width. The action remains at least 44px high.
- Every persisted Stream/Events/Sports/Activities sample card is a real detail
  link. Details display stored title, illustration, description, category,
  selected city, venue/date/duration when present, and artwork attribution.
  Unsupported tickets/playback remain explicitly unavailable, not fake actions.
- The same SVG location pin appears before every selected city. The existing
  saved-city selector supplies the server city ID; changes abort stale reads and
  reset list paging. Physical categories match stored city coverage; Stream is
  cityless and global. Unknown cities fail rather than creating apparent coverage.
- The footer remains exclusive to `/` and `/movies`: 50px support/developer icons,
  56px brand icon, centered Customer Care / Support and About Developer labels,
  `/help`, the approved portfolio URL, and homepage/top navigation. Other screens
  have no footer. The icons retain their original SVG identities.
- Public account-menu appearance/disappearance is animated without leaving hidden
  links keyboard-accessible. Escape closes it and restores focus to Menu. City
  modal Escape restores focus to its opening control.
- Customer copy no longer describes internal seat/price/state implementation.
  Invalid service responses now show “We couldn’t load this information. Please
  try again.” Error codes/status, current-session 401 handling and safe retry
  behavior remain intact. Required sample/media/sandbox limitations are retained.

## Motion and accessibility

`ui-polish.css` is the final small override layer: gentle card lift/image zoom,
border/shadow and button feedback, navigation underline, page entrance,
menu/modal fade/translation/scale and selected-seat feedback. The existing hero's
five-second interval, smooth transition, manual navigation and pause behavior
are retained. No heavy animation package or animated layout dimensions added.
Reduced-motion disables nonessential CSS animation/transitions and uses instant
homepage/top navigation. Unit tests exercise the reduced-motion branch; real
browser reduced-motion emulation has not yet been performed in this pass.
Existing skeletons, error/empty/retry states, focus styles and 44px touch controls
remain. Seat changes are immediate; effects do not determine availability.

## APIs and request flow

```text
CategoryPage -> demoCatalogApi.list(kind, {cityId,...})
 -> GET /api/demo-catalog/:kind?cityId=&category=&search=&page=&limit=
 -> validation -> DemoController -> DemoService
 -> DemoRepository -> Prisma -> PostgreSQL

Category link -> ListingPage -> demoCatalogApi.get(kind,id)
 -> GET /api/demo-catalog/:kind/:id
 -> validation -> DemoController -> DemoService
 -> DemoRepository scoped active(kind,id) read -> public DTO
```

City names are resolved on the server from existing City rows, never accepted as
a hidden browser query field. Search wildcard characters are treated literally.
Wrong kind, inactive or absent IDs return safe 404; malformed UUID/kind/query
returns 400. Pagination is bounded. No schema migration, Redis or financial write
belongs to this read-only module. The response preserves the normal success/error
envelope and `bookingAvailable:false` for sample-only listings.

## Created/changed files in the safe pass

Backend module changes:
`src/modules/demo-catalog/demo-catalog.{types,validation,repository,service,controller,routes}.ts`.
Tests: updated `tests/demo-catalog-http.test.ts`, `tests/refinement.integration.ts`;
new `tests/demo-catalog-details.test.ts`, `tests/demo-catalog-repository.test.ts`.

Frontend: updated `src/api/demo-catalog.ts`, `src/api/client.ts`, `src/App.tsx`,
`src/main.tsx`, `src/components/PublicLayout.tsx`, `src/components/MovieCard.tsx`,
`src/pages/CategoryPage.tsx`, and customer copy in Movie/Seats/Checkout/Booking/
Bookings pages, `src/components/BookingFacts.tsx` and `src/pages/AdminPage.tsx`;
new `src/pages/ListingPage.tsx`, `src/components/LocationPin.tsx`,
`src/ui-polish.css`. Tests: new `tests/ui-polish.test.tsx`; extended
`tests/api.test.ts`; intentional label/copy assertions updated in
`demo-category`, `screenshot-ui`, `redesign`, `refinement-navigation` and
`customer-corrections` test files. Security/unavailable assertions were retained.
Supplemental copy tests extended `tests/admin.test.tsx` and narrowed existing
literal fixture types in `tests/fixtures.ts` without bypassing DTO typechecking.

## Verification evidence (safe-pass baseline, not final event verification)

TDD failures preceded implementation: details routes, city requery/loading gate,
footer/pin/menu/reduced-motion, and natural invalid-response guidance. The
malformed detail ID expectation was corrected to the existing validation contract
(400), not used to weaken validation.

- Backend safe baseline: 635 tests / 38 files passed.
- Frontend latest safe baseline: 166 tests / 17 files passed, including 15 API
  boundary cases; typecheck, lint and production build exit 0.
- Native safe baseline: 73 existing PostgreSQL/Redis + 2 base seed + 2 refinement
  + 2 compiled smoke checks = 79 passed, no failed/skipped cases.
- Both source/seed typechecks and builds, Prisma validate/generate and audits
  passed before the separate event expansion. Both audits reported zero findings.
- Development target check confirmed `cinehook_dev/public` on 5432; repeat content
  seed created zero listings and enriched zero summaries. Original `cinehook`
  and all existing user/financial history were preserved.

Browser measurements on the actual Express-backed app:

| Viewport | Movie card height | Poster height | Page overflow | Broken loaded images |
|---|---:|---:|---|---|
| 320px | 385.4375px | 153.1875px | none | none |
| 390px | 390.6125px | 190.9125px | none | none |
| 768px | 451.425px | 203.575px | none | none |
| 1024px | 497.875px | 286.775px | none | none |
| 1440px | 516.3375px | 305.2375px | none | none |

All 24 distinct sample card links opened matching persisted details with correct
disabled ticket/playback actions and usable back navigation. The four detail
types at all five widths (20 states) had no page overflow, broken loaded images
or footer. Three supported cities x four categories (12 loaded states) returned
two local physical-category samples per city and six global Stream samples;
location pin remained present. Mobile Escape/focus restoration, footer labels/
URLs and restored All cities were checked at 390px.

The local backend's development watcher briefly restarted during schema/client
generation; a category retry recovered afterward. No persistent outage is
claimed from that transient response. New invalid-response wording is separately
covered by three passing regression cases. Final integrated event verification
will rerun the full checks after the last implementation change.

### Latest full run and scoped review

The final safe frontend run was `npm test -- --maxWorkers=1`: 166/166 tests,
17 files, 75.42s. All original assertions/timeouts remain. An earlier run
overlapping builds/backend checks had two timing failures; unchanged focused
cases and the entire suite passed sequentially. Read-only system evidence at
that point showed 7.82 GiB total RAM, only 0.49 GiB free. Resource contention is
consistent with the failures; no application behavior was changed to hide them.
Frontend typecheck, lint and production build subsequently passed.

The scoped independent UI/API review found no actionable issues. It excluded
concurrent event financial work and actual external provider delivery, which
require the separate final verification. Current-file review could not establish
a historical diff for the already untracked baseline; preservation claims rely
on scoped edits and regression evidence rather than invented commit history.
Screenshots saved under `docs/verification/2026-10-10-ui-polish/`:
`movies-desktop.jpg`, `movie-cards-desktop.jpg`.

## Historical Task1–2 event checkpoint (superseded above)

Dedicated Event inventory/read APIs passed scoped review after a native regression
found and fixed a deferred layout check that lost its parent section on deletion.
648 backend unit tests and three event native suites pass at that checkpoint.
The inventory migration is still unapplied to `cinehook_dev` pending the shared
financial module review. Task 2 is implementing target-aware event fulfillment.
Do not confuse future inventory DTOs with completed customer event booking.
No commits, pushes, deployment, foundation-history edits or scalability work.
