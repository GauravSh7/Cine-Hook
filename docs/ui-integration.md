# UI integration: technical study notes

## 13 October 2026 — simulated cinema bill previews

Normal checkout now renders server-provided cinema simulation quotes/coupons
instead of the missing-policy error, explicitly labelled simulated/non-invoice.
Show Bill includes zero/nonzero discount, discounted inclusive amount, included
admission GST, separate fee/tax and final total. Payment button stays disabled
when server `paymentAllowed:false`; cancellation remains functional. No client
price/tax calculation or success flag. Frozen read capability follows current
context without changing the frozen financial snapshot. Actual Razorpay and
ordinary event checkout remain blocked. Targeted 23 frontend billing/booking
tests, typecheck/build pass; API preview verified HTTP200. No unrelated UI edits
or exhaustive browser sweep. See [simulation notes](development-gst-simulation.md).

## Latest UI polish and event work — 2026-10-11 (final verification)

The safe visual/read-only changes are implemented and browser-verified: 10.58%
shorter movie cards at the comparison viewport; smaller graphical footer with
centered support/developer labels; consistent city pin; all 24 sample details;
city-filtered category reads; natural safe response copy; lightweight motion and
reduced-motion behavior. Latest frontend166 tests/typecheck/lint/build pass.
Five Movies widths, 20 detail layouts and 12 city/category states showed no page
overflow/broken loaded images. See [UI polish](ui-polish.md) for exact evidence.

Genuine numbered-seat comedy/sports booking Tasks1–4 are implemented and reviewed:
dedicated inventory/read APIs, shared Booking/Payment fulfillment, guarded sample
seeds and persisted stage/stadium/court screens. Event selection sends IDs only;
the server reserves price snapshots, provider evidence fulfills the shared
financial transaction and owner cancellation uses the existing full-refund policy.
See [event model/API/seed notes](events-sports-booking.md) for current domain/files.

Task5 freshly passed675backend/194frontend unit tests and118native/seed/fixture/
smoke results with0skips; typechecks/lint/final builds/Prisma12migration status/
no-diff and both0-vulnerability audits pass. A transient Vitest fork crash was
retained/reported; unchanged shows49 and complete backend675 repeat passed.
Full suites/builds ran sequentially with one unit worker. Its isolated
browser server uses the latest built frontend/backend and real RazorpayProvider
with controlled transport. `/__test/recovery` sends a signed raw webhook through
the real API and replays identical bytes/event ID; secrets remain server-side.
These helpers live only in `backend/tests`, absent from production server/bundle.
The native fixture contract passed; controller browser and responsive acceptance
remains explicitly pending. Exact factual evidence is in
`.superpowers/sdd/2026-10-10-event-booking/task-5-report.md`.
Historical sample-only limitations below remain dated history.

## Current refinement checkpoint — 2026-10-10

The six-part provider-ready refinement and subsequent five customer corrections
are implemented and verified. This section supersedes the earlier dated UI/test
claims below; those sections remain historical learning notes.

Current results: 616 backend tests, 155 frontend tests, 73 native PostgreSQL/Redis
regressions, 2 base seed + 2 refinement native + 2 compiled smoke checks; all have
zero failed/skipped cases. Lint, typechecks (including seed sources), Prisma
validate/generate, both builds and audits pass. Current browser measurements cover
125 loaded states at 320/390/768/1024/1440, without page overflow or broken loaded
images. See [current handoff](refinement-handoff.md) and
[exact changed files](refinement-files.md).

Account age uses DOB plus the visitor's local calendar date, refreshes at midnight
and foreground, is read-only, and shows Not provided without DOB. Help has exactly
five customer-friendly expandable FAQs and a focused `/help/chat` placeholder.
The booking detail route removes its logo/tagline/rebooking CTA and displays
authorized payment/refund references, full amounts and processed timestamps.
No new financial DTO or production state-machine change was required.
The homepage rotates every five seconds with loop/manual/pause/reduced-motion
behavior, and no longer shows the two requested filler lines.

Login/register have no public browsing chrome. The footer has exactly three SVG
links only on discovery. Movie details add persisted English/Hindi summaries,
verified click-open trailers and source credits. Demo categories now consume the
separate read-only `/api/demo-catalog/:kind` module: six fictional listings each,
server filters/paging, original art, explicit unavailable booking/play states.
Their lack of real inventory is not hidden by a fake action.

The persistent cinehook_dev/public database on port 5432 has ten migrations,
30 Hindi-enriched movies and 24 demo listings. Repeat refinement seed creates
zero rows and changes zero existing summaries. Existing users/history and the
original cinehook database are preserved. Real media/provider delivery remains
configuration-gated; [provider setup](provider-setup.md) lists every blank key and
the approved logo slot. Missing Google/TMDB/Razorpay/Cloudinary values are not
substituted with successful mocks in the normal application.

Controlled local browser payment/cancel/refund, failure/compensation, owner
profile/wishlist and genuine five-minute expiry checks passed. Cancellation freed
only its own seats; another user's confirmed allocation stayed unavailable.
Expired checkout redirected to FAILED details without a payment action.
The backend architecture and permanent/temporary allocation authorities are
unchanged. The historical foundation document was not edited.

## Preceding redesign checkpoint (historical)

Final redesign follow-up, 2026-10-10: persistent `cinehook_dev` is migrated and
populated with 30 movies, 102 retained shows (96 upcoming at verification),
288 physical seats and 306 per-type prices. Frontend, backend readiness and
proxied movie discovery return 200. The attached screenshot/handwritten design
now supersedes the older screenshot and MagicPath sections below. The original
database was not changed; genuine external provider delivery remains separate.

The current shell has no top search box. Navigation order is Movies, Stream,
Events, Sports, Activities, Offers. Home uses a wide cinematic auto-rotating
hero that displays only the movie title and Book Now action, followed by
Recommended, Bollywood Blockbusters, South Hits, Now Showing, Popular Movies
and Our Picks rails. Movie details expose only persisted metadata/provenance and
real show availability. Seats, checkout and ticket pages use the focused layout
without public navigation/footer. The public footer appears only on `/` and
`/movies` and contains Customer Care, the approved developer portfolio link,
CineHook branding and the exact educational-demo statement.

Google sign-in is a genuine GIS credential flow with backend token verification;
without local credentials the control states that it is not configured. The
account and wishlist additions use authenticated APIs and PostgreSQL. Unsupported
entertainment categories, offers and Help & Support are clearly labelled rather
than simulating inventory, discounts or a chatbot.

Fresh browser continuation covered 105 states at 320/390/768/1024/1440: public
discovery/category/auth/detail/seat routes, authenticated profile/wishlist/history/
help/refund routes, all admin routes, checkout and confirmed ticket. No page
exceeded its viewport; seat maps/admin tables keep intentional local scrolling.
The initial 320px overflow was reproduced, traced to the old body minimum width,
fixed and rerun. This corrects the earlier Oct9 blanket responsive claim. The
footer appears only on Home/Movies; focused booking routes have neither category
navigation nor footer. Inspected browser warning/error logs were empty.

Real PostgreSQL/Redis browser journeys verified captured booking, cancellation,
pending/processed refund, re-available seats, and a genuine five-minute expired
hold with no renewal. DOB persisted after reload and age remained derived;
email was read-only. Wishlist persisted across reload. Test checkout explicitly
labels itself LOCAL TEST CHECKOUT; no real money or provider account was used.
Native tests additionally verify signed raw-webhook browser-close recovery,
financial/concurrency races and Cloudinary image decoding/ownership.
Fresh results: 581 backend tests, 108 frontend tests, 73 native integration,
2 seed and 2 smoke tests pass; typechecks, lint, Prisma checks, builds and both
audits pass. See [final handoff](redesign-handoff.md), [exact files](redesign-files.md),
[Google setup](google-auth.md), and [responsive measurements](verification/responsive-results.json).

Historical Oct8/Oct9 sections below are dated evidence, not current setup
instructions. The temporary Oct9 QA user/wishlist cleanup affected only
task-created data; current verification used isolated `_test` fixtures and
preserved their records. The existing personal database was not reset.

## Screenshot-based UI checkpoint — 2026-10-08

The eight user-approved screenshots supersede MagicPath where they differ.
The new implementation and isolated local verification are complete; persistent
development database creation and genuine external provider delivery remain
setup prerequisites, not simulated success. See [Account/Wishlist](account-wishlist.md)
for backend APIs/models, [development setup](development-seed.md) for the exact
safe launch commands, and the [Task2 file/report inventory](superpowers/plans/2026-10-08-task-2-report.md).

### Implemented screens and visual structure

The teal-black/red cinematic shell uses a film-reel CineHook wordmark,
search/location/sign-in/menu header, active-underlined category navigation,
poster-led hero/cards, bordered account panels and an auditorium footer.
Movies, movie details, actual shows/seats, checkout, booking detail/history,
login/register, account and movie wishlist consume real backend APIs. Account
and wishlist share the sidebar. Stream, Events, Sports and Activities have
theme heroes and category sections with explicit unavailable inventory.
Offers has All/UPI/Net Banking/Credit Card/Debit Card keyboard-accessible filters
and truthful empty states. Help & Support is only a labelled future chatbot.

Location selection loads actual cities, supports search and explicit save,
restores focus, traps modal focus and supports Escape. It does not invent a
default location. Profile supports editable name/DOB/phone and photo upload;
email is read-only and age is derived from DOB, never persisted as a fixed value.
Saved movies belong to the authenticated owner in PostgreSQL, not guest memory.
Disabled saved movies remain removable but cannot initiate a booking.

### New frontend file inventory

Modified: `frontend/src/App.tsx`, `src/index.css`, `src/api/client.ts`,
`src/api/types.ts`, `src/app/session-context.ts`, `src/app/SessionProvider.tsx`,
`src/components/PublicLayout.tsx`, `src/components/MovieCard.tsx`,
`src/pages/HomePage.tsx`, `src/pages/MoviePage.tsx`, `src/pages/AuthPage.tsx`,
`src/pages/BookingsPage.tsx`.

Created: `frontend/public/auditorium.svg`; `src/api/account.ts`,
`src/api/wishlist.ts`, `src/domain/profile.ts`; `src/components/Brand.tsx`,
`AccountLayout.tsx`, `LocationDialog.tsx`, `ThematicArt.tsx`, `WishlistButton.tsx`;
`src/pages/AccountPage.tsx`, `WishlistPage.tsx`, `CategoryPage.tsx`,
`OffersPage.tsx`, `HelpPage.tsx`; `frontend/tests/account-wishlist.test.tsx`,
`screenshot-ui.test.tsx`, `profile-domain.test.ts`.
The module documents, task reports and native screenshots were also added/updated.
The seed and backend inventories are in their separate linked notes.

### Request flow and authority

UI components call typed adapters rather than embedding requests or database
logic. Movies/shows/availability use existing catalog and booking read APIs.
Authentication calls existing register/login/me endpoints. Profile uses
`PATCH /api/account/profile` and multipart `POST /api/account/avatar` with one
`image`; FormData leaves the boundary to the browser. Wishlist uses
`GET /api/wishlist/movies`, `GET/PUT/DELETE /api/wishlist/movies/:id`.
Profile responses wrap `{user}` consistently with `/api/auth/me`.

These requests preserve Route → Middleware → Controller → Service → Repository
→ Prisma → PostgreSQL. The avatar provider stays outside the short row-update
transaction. Booking creation still obtains the atomic owner-bound Redis hold,
then persists trusted per-seat quotes; payment/refund confirmation remains
provider/backend-authoritative. No BookingService, SeatLockService, payment,
refund or original financial migration behavior was changed.

Profile and wishlist requests are cancelled on identity/token changes. Duplicate
movie controls synchronize only after real API success; pre-mutation status
reads are aborted, then fresh authoritative reads remain effective. Deletion
refills the current server-offset wishlist page instead of hiding permanent
tombstones or skipping the21st item. Auth header preserves the original return
destination on login/register pages. These edge cases were reproduced with
RED→GREEN regression tests and the scoped review approved their fixes.

### Fresh verification, not prototype evidence

- Frontend: **86 tests/9files**, lint, application/test typecheck and production
  build pass; audit reports **0 vulnerabilities**. Existing56 tests were retained.
- Backend: **521 tests/27files**, application/seed typecheck, Prisma validate/
  generate, build and audit pass; **72 live integration results,0skips** and
  **2 compiled smoke tests** pass. Native seed tests pass **2/2,0skips**.
- Seven migrations were deployed only into verified isolated test databases.
  A current-date seed created6films/3cities/6screens/288seats/42futureShows;
  its same-day rerun added zero rows. Express4000 and Vite5173 used that real
  PostgreSQL inventory and actual Redis for browser tests—no mocked catalog API.
- Browser: registration, incorrect-password error, login, profile name/phone/
  DOB persistence with calculated25-year age, read-only email, city selection,
  wishlist save/reload, movie/show selection and48physical seats were verified.
  Selecting regular A1 and premium E1 created a pending booking with the
  **server total ₹650** and a backend-derived countdown starting near05:00.
  Missing Razorpay configuration returned unavailable, not a ticket. Actual
  expiry changed the booking to FAILED, preserved its quote/history and
  displayed that the hold would not be renewed or reacquired automatically.
- Responsive checks: Movies, Stream, Events, Sports, Activities, Offers,
  Wishlist, Account, Bookings, Help, Login, Register, movie detail and seat
  selection at **390/768/1440px**: document scroll width equalled client width
  in all42checks. The seat map uses local horizontal overflow on mobile.
  Checkout was also exercised/captured on390px. This is browser evidence for
  common widths, not a claim of every physical device tested.

Native proof files: [desktop home](screenshots/screenshot-ui-home-desktop.jpg),
[mobile home](screenshots/screenshot-ui-home-mobile.jpg),
[profile](screenshots/screenshot-ui-account-desktop.jpg),
[mobile seats](screenshots/screenshot-ui-seats-mobile.jpg),
[mobile checkout](screenshots/screenshot-ui-checkout-mobile.jpg),
[mobile bookings](screenshots/screenshot-ui-bookings-mobile.jpg).
Some long full-page captures were unavailable; the history/home proof uses
ordinary viewport captures. Temporary browser tabs interrupted between checks
were reopened; no screenshot capture was treated as a passed API test.

### Deliberate differences and remaining setup

Unsupported categories use native thematic vector art rather than the
screenshots' photorealistic celebrity/event banners. The footer uses a vector
auditorium. Actual movie posters/title ordering, demo schedules, city list,
booking values and statuses come from the database, not screenshot mock data.
The simple account has only approved backend-supported profile fields; no saved
cards/addresses, preferences, notification/security controls or social login is
presented as working. No promotions, streaming playback, event/sport/activity
booking, chatbot, fixed refund-delivery estimate or client payment-success
flag is invented. These content differences are intentional; they are not
newly approved business modules.

`cinehook_dev` on the user's existing5432 service is still absent; its app role
lacks CREATEDB. The original `cinehook` retains six migrations and0domain rows.
The guarded setup command fails closed before writes. A local administrator
must create the separate database with the existing app role as owner, then
follow [the exact launch commands](development-seed.md). Cloudinary and Razorpay
credential groups are absent; live image/payment/refund delivery was not tested.
Controlled-provider integration tests do not imply real provider delivery.
Foundation history and Git HEAD are unchanged; no commit/push, actual `.env`
edit, destructive original-database operation or synced-reference edit occurred.

## Historical MagicPath first-pass record

The implementation/evidence below is retained as dated history, not the visual
source or fresh verification of the screenshot refresh.

Checkpoint: **2026-10-08**. Implementation began on 2026-10-07. This module
connects the approved CineHook screens to the existing Auth, Catalog, Shows,
Booking, Payment and Refund services. It adds ordinary read projections for
owner summaries and operations screens; it does not change financial policy.

## Sources and scope

The approved [MagicPath reference](https://designs.magicpath.ai/v1/serene-flood-9884)
was accessible through the native read-only integration and browser. The source
was project `458212679702687744`, component `458212875450880000`, pinned revision
`458212875450880001`, **CineHook Complete UI**. Its component source, styles and
native render established the visual composition. No remote design was changed.

The binding engineering sources are the existing module contracts and the
[UI design spec](superpowers/specs/2026-10-07-ui-integration-design.md) and
[implementation plan](superpowers/plans/2026-10-07-ui-integration.md). The approved
reference establishes appearance, not unsupported API fields or money rules.
Synced project references remain read-only. The foundation record was preserved.

## Exact module file inventory

All paths below are repository-relative. This inventory covers this UI module,
not earlier backend modules. Existing starter assets, `App.css`, `main.tsx`,
`eslint.config.js` and `vite.config.ts` were not changed by this module.

### Created frontend source files

| File | Responsibility |
| --- | --- |
| `frontend/src/api/client.ts` | Same-origin API envelopes, safe errors, token snapshots, cancellation, timeout and server clock offset. |
| `frontend/src/api/types.ts` | Public catalog, booking/payment/refund, auth and admin DTOs. |
| `frontend/src/api/catalog.ts` | Catalog, cities, venues, shows, availability and physical seat reads. |
| `frontend/src/api/booking.ts` | Owner hold, history, summary, release, cancellation and refund APIs. |
| `frontend/src/api/payment.ts` | Server order creation and exact provider-signature verification payloads. |
| `frontend/src/api/auth.ts` | Login/register/current-user calls; credentials never inherit a bearer token. |
| `frontend/src/api/admin.ts` | Global read projections and existing movie/show/refund operations. |
| `frontend/src/app/SessionProvider.tsx` | Session-scoped JWT, `/me` restoration, current-user errors, logout and 401 handling. |
| `frontend/src/app/session-context.ts` | Session contract and hook. |
| `frontend/src/app/CityProvider.tsx` | API-derived city choices and optional tab-scoped preference. |
| `frontend/src/app/city-context.ts` | City preference contract and hook. |
| `frontend/src/app/use-async.ts` | Abortable reads, resource identity, retries, focus refresh and optional polling. |
| `frontend/src/app/use-countdown.ts` | Backend-deadline display refreshed once per second. |
| `frontend/src/app/NavigationEffects.tsx` | Reset scroll position on pathname navigation. |
| `frontend/src/domain/booking-state.ts` | Interpret booking and financial states without inventing ticket validity. |
| `frontend/src/domain/time.ts` | Integer-paise display, UTC date filters, IST times and hold countdown. |
| `frontend/src/domain/razorpay.ts` | Typed official Checkout SDK loader, shared load and bounded failure/retry. |
| `frontend/src/components/PublicLayout.tsx` | Approved header, city selector, mobile navigation and current-role admin link. |
| `frontend/src/components/Protected.tsx` | Session restoration, login return route and current-user admin gate. |
| `frontend/src/components/RouteScope.tsx` | Remount forms/dialogs/SDK owners when route, query or session changes. |
| `frontend/src/components/MovieCard.tsx` | Catalog card and poster with a factual missing-image fallback. |
| `frontend/src/components/BookingFacts.tsx` | Shared persisted quote, historical metadata and payment facts. |
| `frontend/src/components/ConfirmDialog.tsx` | Cancellation dialog, initial/restored focus, Tab trap and Escape handling. |
| `frontend/src/components/feedback.tsx` | Loading skeletons, retry/error/empty states and status badges. |
| `frontend/src/components/AdminTable.tsx` | Semantic headings and keyboard-accessible local table scrolling. |
| `frontend/src/components/MovieForm.tsx` | Real catalog create/edit fields and validation feedback. |
| `frontend/src/components/ShowForm.tsx` | Venue/screen/layout choices, UTC scheduling and per-seat-type prices. |
| `frontend/src/pages/HomePage.tsx` | API-derived featured release, filtered catalog and city-show sections. |
| `frontend/src/pages/MoviePage.tsx` | Movie detail, UTC date filters and theatre-grouped real shows. |
| `frontend/src/pages/SeatsPage.tsx` | Physical availability, selection/resume, IDs-only hold request and server-quote navigation. |
| `frontend/src/pages/CheckoutPage.tsx` | Authoritative quote/deadline, server order, SDK lifecycle, verification and recovery. |
| `frontend/src/pages/BookingPage.tsx` | Backend outcome, confirmed ticket, release/cancel/refund and fresh-seat recovery. |
| `frontend/src/pages/BookingsPage.tsx` | Owner history with current per-card summaries and recovery actions. |
| `frontend/src/pages/AuthPage.tsx` | Login/register, matching passwords, safe return route and aborted obsolete login. |
| `frontend/src/pages/AdminPage.tsx` | Dashboard, movies, shows, global bookings/payments and bounded reconciliation. |

### Created frontend test/configuration files

| File | Responsibility |
| --- | --- |
| `frontend/vitest.config.ts` | React/jsdom test environment and setup. |
| `frontend/tsconfig.tests.json` | Typecheck production source and test fixtures. |
| `frontend/tests/setup.ts` | Shared DOM setup, cleanup and browser stubs. |
| `frontend/tests/fixtures.ts` | Complete typed DTO fixtures and controlled API responses. |
| `frontend/tests/api.test.ts` | Payload allowlists, safe errors, abort/timeout, server clock and session-specific 401 races. |
| `frontend/tests/domain.test.ts` | Expiry boundary, state authority, money/time display and SDK loading failures. |
| `frontend/tests/discovery.test.tsx` | Real/empty/error catalog, released hero, scroll reset and seat hold payload. |
| `frontend/tests/booking-flow.test.tsx` | Quote/payment/recovery, route races, cancellation focus, refund/compensation and current history actions. |
| `frontend/tests/auth-ui.test.tsx` | Login/resume, credential handling, obsolete login, registration mismatch and expired session. |
| `frontend/tests/admin.test.tsx` | Current-role denial, server metrics, historical data, real forms and resolved compensation. |

### Changed frontend files

| File | Change |
| --- | --- |
| `frontend/index.html` | CineHook title, description and dark theme metadata. |
| `frontend/package.json` | Router and DOM-testing dependencies; local test/typecheck commands. |
| `frontend/package-lock.json` | Locked those dependency changes. |
| `frontend/src/App.tsx` | Real routes, providers, layouts, session/route scopes and not-found page. |
| `frontend/src/index.css` | Approved palette/composition, responsive seats/admin, focus, reduced motion and print styles. |

### Created/changed backend UI support

| File | Status and responsibility |
| --- | --- |
| `backend/src/modules/ui-read/ui-read.types.ts` | Created: minimal store/read DTO contracts. |
| `backend/src/modules/ui-read/ui-read.repository.ts` | Created: explicit Prisma selections, coherent owner summary, historical lists and UTC aggregates. |
| `backend/src/modules/ui-read/ui-read.service.ts` | Created: observe existing hold state, safe integer conversion and public projections. |
| `backend/src/modules/ui-read/ui-read.controller.ts` | Created: existing success envelope and HTTP-to-service adapter. |
| `backend/src/modules/ui-read/ui-read.routes.ts` | Created: auth/current-role, UUID/query validation, pagination and no-store headers. |
| `backend/src/modules/ui-read/create-ui-read.ts` | Created: construct repository/service using shared Prisma and BookingService. |
| `backend/tests/ui-read.test.ts` | Created: real HTTP/service/repository projections with external persistence replaced in units. |
| `backend/tests/ui-browser-server.mjs` | Created: isolated real-app browser fixture and controlled provider/SDK transport. |
| `backend/tests/ui-browser-fixture.test.ts` | Created: reject unsafe targets and test actual adapter capture/signature/refund idempotency. |
| `backend/src/app.ts` | Changed: mount optional read routes before existing booking/catalog routes. |
| `backend/src/server.ts` | Changed: wire `createUiRead(prisma, booking.bookings)` into the production app. |

This is 45 created and five changed frontend files, plus nine created and two
changed backend files. Backend package files, schema, six migrations, CI workflow,
`.gitignore`, secrets and environment files were not changed by this UI module.
Generated clients, build outputs and installed dependencies remain ignored artifacts.

Documentation: created this file and the spec/plan linked above; updated
`README.md` and `docs/implementation-progress.md` for the module checkpoint.
Browser evidence files under `docs/ui-proof/`: `home-desktop.jpg`,
`home-mobile.jpg`, `seats-mobile.jpg`, `checkout-tablet.jpg`, `ticket-desktop.jpg`,
`ticket-final-desktop.jpg`, `refund-pending-desktop.jpg`,
`refund-complete-desktop.jpg`, `hold-expired-mobile.jpg`, `admin-mobile.jpg` and
`payments-final-desktop.jpg`; final rerun evidence adds `ticket-current-desktop.jpg`
and `home-final-desktop.jpg`. The main verification run maintains the final
progress ledger and plan checks.

## Architecture and request flows

React pages use typed API adapters; presentation/domain helpers contain no
database, lock, provider-secret or payment authority. Existing backend layers
remain Route → Middleware → Controller → Service → Repository → Prisma → PostgreSQL.
BookingService/SeatLockService own reservation and Redis; PaymentService and
RefundService own provider evidence and money transitions.

The new read routes return the existing `{ success: true, data }` envelope:

| Endpoint | Access and result |
| --- | --- |
| `GET /api/bookings/:id/summary` | Current owner; `{ booking, show, payment: null or DTO, refunds }`, including historical disabled movie data. |
| `GET /api/admin/dashboard` | Current database ADMIN; total movies, active shows, bookings today, primary captured amount today. |
| `GET /api/admin/movies` | ADMIN; all movies, including disabled; existing movie filters and pagination. |
| `GET /api/admin/shows` | ADMIN; historical/cancelled shows, existing show filters and pagination. |
| `GET /api/admin/bookings` | ADMIN; global booking/seat/payment facts; literal user-name or exact UUID search. |
| `GET /api/admin/payments` | ADMIN; global payment/reconciliation/refund facts and pagination. |

Lists default to 20, maximum 100; unknown query fields/invalid UUIDs are rejected.
Public DTOs select fields explicitly, omit hashes/JWTs/private credentials/raw
provider events, and convert BigInt money/counts only when safe integers.
Protected projections have `Cache-Control: no-store`.

1. **Discovery:** `/` loads cities and filtered movies. Selecting a city loads
   actual shows for the near-you section. `/movies/:id` loads detail and paged
   shows by movie/city/UTC date, grouped by theatre. Human times display IST.
2. **Seats/hold:** `/shows/:id/seats` loads show and availability. Only AVAILABLE
   IDs can be selected (maximum ten). Selection stored for login resume is not a
   hold. Continue sends `POST /api/bookings { showId, seatIds }`; the existing
   BookingService quotes prices and acquires fenced Redis locks. Only its success
   response navigates to `/bookings/:id/checkout` with persisted server money.
3. **Owner summary:** auth → current-user/UUID validation → UiReadController →
   UiReadService → existing `BookingService.getById(owner,id)` observes expired or
   lost holds → UiReadRepository. Its short READ COMMITTED transaction locks
   Booking `FOR SHARE`, rechecks ownership and reads booking/show/payment/refunds
   coherently in the same lock order used by financial writers. No Redis/provider
   call occurs inside this projection transaction. Foreign/absent IDs return 404.
4. **Payment:** checkout reads summary and sends `POST /api/payments/order
   { bookingId }`. Key ID, provider order ID, currency, amount and deadline come
   from the server. Production loads `https://checkout.razorpay.com/v1/checkout.js`.
   The SDK callback sends only booking ID and Razorpay order/payment/signature
   fields to `POST /api/payments/verify`. Existing signature/capture/fulfillment
   services run; the outcome page rereads summary. SDK success is never a ticket.
5. **Recovery:** SDK dismissal/failure, uncertain verify, page reload, focus and
   five-second GET polling reread backend state. Writes are never automatically
   retried by the client. A captured but unfulfilled payment shows compensation;
   a CONFIRMED booking alone enables ticket print. Extra-capture refunds do not
   invalidate a correctly funded confirmed booking. Failed expired/lost/released
   holds explain the loss and offer a new seat-selection route before show start.
6. **History/refunds:** `/bookings` reads owner history, then each visible card
   reads a summary. Current summary drives its action labels. Confirmed-ticket
   cancellation sends `POST /api/bookings/:id/cancel {}`; seats release and Booking
   stays CANCELLED while payment is REFUND_PENDING. `POST .../refund/retry {}`
   fetches/retries existing durable obligations; verified processed evidence makes
   payment REFUNDED. `DELETE .../hold` releases an unpaid hold. No client amount,
   refund-success or booking-status field is sent.
7. **Auth/admin:** login/register use existing Auth APIs; only JWT is stored in
   sessionStorage. Reload calls `/api/auth/me` for current database identity/role.
   Logout/401 clear session identity. ADMIN routes independently enforce current
   database role. Admin forms reuse POST/PATCH/DELETE movie endpoints and POST
   show; refund reconciliation reuses `POST /api/admin/refunds/reconcile {}`.

## Important decisions and design differences

Palette: background `#0b0b0f`, panels `#15151c`, inputs `#1b1b24`, borders
`#2a2a34`, muted text `#a6a6af`, red `#e50914`, white type. Rounded cards, hero,
header, seat footer, checkout/ticket panels and admin sidebar follow the pinned
composition. Public content caps at 1280px; cards use 1/2/4 columns. Actual API
data determines card titles/count/order; no static Interstellar promise remains.
The hero uses the first released movie in the sorted API page, falling back to
an upcoming movie if none is released. Near-you means real city shows, not a
fabricated popularity ranking. Missing/broken poster URLs use a title initial;
the hero uses the approved dark composition without invented artwork.

The actual browser fixture has 48 physical seats rather than the prototype's 18.
Seat buttons stay 48px wide and at least 44px high, with local horizontal scrolling.
The footer says total is confirmed at checkout: per-seat price labels are advisory
until the server creates the immutable quote. No prototype ₹50 fee is added.
Trailers, ratings/popularity, coupons, password reset, show editing/cancellation
and admission QR validation have no approved backend support; controls are
disabled/explained or omitted. Movie disable is historical soft-disable.

UTC date filtering and scheduling preserve backend contracts; display is explicitly
IST (`Asia/Kolkata`). Show creation discovers the screen's actual seat types and
submits one integer-paise price for each present type. There is no invented flat
price. Dashboard “Captured Today” uses the database UTC day and primary Payment
capture evidence, including later-refunded captures; it is not net revenue or
settlement. Payments “Payment amount” remains factual for pending/refunded rows.
An outstanding compensation label also requires `resolvedAt` to be absent.

Countdown derives from exact `expiresAt` and HTTP Date clock offset. HTTP Date
has whole-second precision; display is capped at `05:00` to avoid a rounding
artifact. The actual expiry check is unchanged and never renews a Redis hold.
RouteScope keys path/query/session internally, resetting obsolete forms/dialogs/
SDK ownership. Aborted Auth requests cannot accept a late identity; obsolete SDK
callbacks check lifecycle before verification/navigation. Cancellation traps focus,
restores the trigger and handles Escape; navigation resets page scroll.

Tickets contain backend booking/venue/show/seats/amount facts. Download/print opens
the browser print dialog (Save as PDF where available); no generated PDF service
or admission QR system was added. Session storage supports tab reload, not a
remember-me/refresh-token scheme. After browser close, login and server history
recover bookings. Polling is bounded at five seconds for live seat/outcome views;
there is no SSE/WebSocket or background refund worker. My Bookings uses a bounded
20-card summary fan-out (N+1 reads); scalability upgrades remain deferred.

## Verification and its limits

Earlier full checks established the same 56 frontend tests, 409 backend unit tests,
68 live integration results and two smoke tests. The main run freshly reconfirmed
the following on **2026-10-08** after the final UI review changes:

| Check | Fresh result |
| --- | --- |
| Frontend lint/typecheck/test/build | Passed; 56 tests across six test files. |
| Backend typecheck/unit/build | Passed; 409 tests across 19 test files. |
| Actual PostgreSQL/Redis integration | 68 results passed, zero skipped. |
| Compiled-server smoke | Two passed. |
| Prisma validate/generate/migration status | Passed; client 7.10.0 and all six existing migrations current. |
| Frontend/backend dependency audit | Zero vulnerabilities in both. |
| Independent final UI review | Two important regressions fixed with RED→GREEN tests; payment amount wording corrected. |

Units cover source authority, IDs-only writes, hold boundaries, safe error/empty/
retry states, delayed requests, SDK failures, compensation, role checks and native
read projections. Existing live suites continue to cover real transactions, Redis
scripts, payment/refund recovery and concurrency; a skipped run is not live proof.

Browser runs used PostgreSQL on loopback 55438 (`cinehook_ui_test`, then fresh
`cinehook_ui_final_test`), Redis on 55439/DB15 and test app on 55440. The actual
Booking/Payment/Refund services, Prisma, Redis and Razorpay adapter ran. Only
external provider HTTPS transport and Checkout SDK were controlled and clearly
labelled **LOCAL TEST CHECKOUT — no real money**. The normal database on 5432
was not modified. Real fan login → show → A3/A4 hold → server 60000-paise order →
verify → confirmed ticket → reload/dismiss recovery → cancel → REFUND_PENDING →
retry/provider fetch → REFUNDED → history was exercised. A3/A4 became available
again; an unpaid B1 hold elapsed for its actual five-minute lifetime and became
FAILED. Admin real movie create/edit, per-type UTC show create (19:30 IST display),
global lists/stats/search, reconcile-zero and historical movie disable were exercised.

The final responsive matrix passed 42 screen/breakpoint states at 390/768/1440:
five admin screens (15), Home/Movie-shows/Seats/My Bookings/refund result (15),
checkout (3), confirmed ticket (3), login/register (6). Every document's
`scrollWidth` equalled `clientWidth`; seat maps and admin navigation/tables scroll
locally. The mobile map was 327px wide with 524px content; an off-screen A8 was
selected after scrolling without page overflow. Final current-code recovery also
showed the other owner's confirmed A1 ticket at all widths. A new B2 30000-paise
hold displayed `05:00` and owner release made it FAILED/HOLD_RELEASED with no
provider payment. Real local registration showed truthful empty owner history.
The test app, task-owned Redis and temporary PostgreSQL were stopped; ports
55438/55439/55440 had no listeners afterward. The existing 5432 service retained
its original process. Temporary PG files and both test databases remain
recoverable; no database was dropped/reset. Only the task-owned ephemeral Redis
locks were discarded. Owned browser tabs were closed and the viewport restored.
Representative proofs: [desktop home](ui-proof/home-desktop.jpg),
[mobile seats](ui-proof/seats-mobile.jpg), [tablet checkout](ui-proof/checkout-tablet.jpg),
[confirmed ticket](ui-proof/ticket-current-desktop.jpg),
[refund complete](ui-proof/refund-complete-desktop.jpg),
[expired hold](ui-proof/hold-expired-mobile.jpg), [mobile admin](ui-proof/admin-mobile.jpg).

Fixture safety rejects non-loopback/non-`*_test` PG and Redis other than DB15
before opening connections. Build frontend/backend **before** starting it:
its HTML entry point is cached at startup, so rebuilding requires restart. A
restart needs a fresh migrated empty test database; existing seeded fixture data
cannot be reused. Shutdown leaves DB records recoverable and releases only its
fenced surviving holds, with no flush/reset. Runtime JWT/provider signing keys
are ephemeral; fixture-account credentials are test-only, and the seeded account
hashes remain in the recoverable isolated database, never a production database.
This fixture and `/__test/*` routes never enter the production server/bundle.

Actual Razorpay account test-mode orders, real SDK/network delivery, internet
webhooks, settlement/refund timing, Docker and remote CI remain unverified.
Cloudinary upload is not integrated; HTTPS poster URLs are display-only. The
existing production Vite `/api` proxy to port 4000 was preserved. CI configuration
was unchanged; local frontend UI tests are not claimed as remotely executed.
No real-money request, schema change, secret edit, commit, push or remote write
was part of this module. Foundation content and Git HEAD were unchanged; final
whitespace checks passed with informational LF/CRLF warnings. This completes
the first-pass local UI checkpoint; scalability work remains deferred.

### 2026-10-12: customer copy and artwork corrections

Movie cards expose the next scheduled show time from the catalogue API. Reserved-seat
experience cards show their next session date. The explicit development seed upgrades
only exact generated movie artwork to sourced poster URLs; all 30 movies were verified
through the running API with HTTPS posters and upcoming dates.
Seat legends use Available, Selected and Unavailable. Held seats remain disabled,
with Redis and PostgreSQL behavior unchanged. Removed internal development descriptions,
seat-hold paragraphs, focused-layout tagline and featured-carousel rotation control.
Featured posters fit in full without blur; category and experience cards use photo
assets where their stored media was generic SVG artwork. Dates and booking controls remain.

### 2026-10-12 approved pricing and media pass

Offers reveal/copy FIRST50 and SAVE10 across retained payment-method filters.
Movie/event checkout uses authenticated backend quotes, coupon apply/remove,
frozen states and itemised Show Bill; UI never calculates an authoritative total.
Included admission GST and separately charged fee GST are labeled distinctly.
Payment controls disable while changing a coupon; displayed totals use the returned
quote. Booking history prefers actual Payment.amountPaise when present.

Homepage features the five newest released Hindi/English films first, ordered
by release date; upcoming films stay in their own shelf. No availability warning in hero,
no redundant city or decorative category/brand banner badges. Dates remain on
details/session selectors, not discovery cards, following the later instructions.
Per-entry seed photographs replace generic category artwork only at exact known
old seed URLs. Existing custom images are preserved. Thirty-three photo endpoints
were checked successfully; browser activity cards loaded distinct pottery,
climbing, guitar, photography, science and VR imagery. These are contextual stock
photos, not claims of official promotional artwork. Unknown entries get distinct
abstract SVG fallback instead of an unrelated hash-selected photograph.

Tax settings are NOT inferred from selected city. New quote checkout is disabled
until supplier/admission/fee settings are verified; the importer/template and
source/rounding details are in checkout-pricing.md. No GST invoice, fake bank
promotion or simulated provider success is shown. Foundation record unchanged.

### 12 October — Functional cancel and scrolling follow-up

Cancel Payment now performs authenticated backend checkout cancellation before
navigating to authoritative status. Pending bookings become Cancelled; captured
races preserve financial truth and full refund obligations. Countdown/resume
actions disappear and My Bookings includes cancellation even if detail retrieval
temporarily fails. See checkout-cancellation-scrolling.md for APIs and races.

Replaced all numbered pagination in paginated screens/admin lists with shared
use-paged-async and ScrollMore. Append preserves prior items, deduplicates IDs,
aborts obsolete filter/account loads and provides retry on next-page failures.
Mutation/filter actions reset the list safely. Verified 51 targeted frontend
tests, lint/typecheck/build and live browser history 20 -> 26 items without page
controls. Verified cancelled detail had neither timer nor checkout link.

Tax error deliberately retained: exact current missing configuration and official
sources are documented in tax-configuration-required.md. No fake tax settings,
provider success, new licensed assets or redesign introduced.

13 October: checkout now groups admission GST, shows the waived platform fee
as struck-through ₹7 / green Free for new simulated bookings, uses Pay within,
and adds a read-only full physical screen preview below booking facts. Account
Info supports approved password-confirmed Google linking without creating a
second account. See checkout-polish-google-linking.md for flows and limitations.

14 October: matched TMDB ratings for all30; State/City selection and user-action
nearest-city detection; richer cinema/stadium/stage visuals; shared non-movie
TEST coupons/bills. Mobile390/desktop1440 checks found no page overflow. Google
selection popup opens; personal login not claimed. See product-refinements-2026-10-14.md.

14 October follow-up: the existing location control now offers every Indian state
and union territory, matches Muzaffarnagar (including common misspellings), and
keeps city selection limited to database-backed cities. `npm run
dev:locations:seed` safely adds Muzaffarnagar to `cinehook_dev`; the city has no
invented venue or show inventory. Homepage movie groups are disjoint: featured
titles are excluded from shelves, releases within the past year and upcoming
releases are separated, and older titles live only in CineHook Classics. The
guarded `npm run dev:catalog:upcoming` imports up to eight current India-region
TMDB titles with available metadata, no fabricated ratings and no showtimes.
Re-running both commands skips existing rows.

### 14 October — homepage restored and regional catalogue expanded

The auto-rotating hero now features five recent Hindi/English releases, ordered
by release date, rather than future titles. Hero entries are excluded from the
shelves so films appear once; upcoming titles and older-than-one-year classics
remain separate. Recent Tamil, Telugu, Kannada and Malayalam metadata was added
from TMDB, populating South Hits without inventing showtimes. A repeat import
created zero rows and skipped all 28 existing metadata matches. City search
continues to include the supported Muzaffarnagar record and spelling variants;
booking remains limited to actual city showtimes.
# 14 October 2026 follow-up

The location dialog distinguishes a detected Greater Noida area from New Delhi,
which remains the nearest city with supported show inventory. The existing
location button, city search and supported-city choices remain in place.

The movie catalogue now contains 47 distinct titles and 17 new future showtimes.
Posters and ratings for the added titles come from TMDB. Homepage shelves consume
titles once before the remainder grid, reducing repeated cards. Booking detail
pages link to Help & Support. Cancellation controls follow the server's 24-hour
eligibility policy and disappear when the booking is no longer eligible.

Google sign-in is on Login only; existing password accounts can prove ownership
there without a permanent Account Info panel. Shared featured carousels animate
Stream, Events, Sports and Activities, while unsupported listings remain browse
only. Two real 144-seat cinema halls now expose tiered physical layouts; visual
glow, stage/stadium depth and mobile panning preserve seat IDs and availability.

The location control starts with five supported popular cities and searches the
full supported city list, including Muzaffarnagar. Category pages have one
search field; featured banners auto-rotate without pause/start controls. FIRST50
and SAVE10 are shown only in All; payment-method filters remain empty until
supported offers exist. Help & Support no longer displays the specified
technical placeholder copy. Live checks returned Hindi descriptions for 77/77
movie records and TMDB ratings for 69/77; unrated titles remain without an
invented score.

