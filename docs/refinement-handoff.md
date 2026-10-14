# CineHook — verified refinement handoff

Checkpoint: 2026-10-10. Existing checkout:
`C:\Users\gaura\OneDrive\Desktop\Cine-Hook`.

This completes the approved six-part media/UI structure request, including the
instruction to leave optional provider credentials blank, and the subsequent
five account/support/financial-status/homepage corrections. Earlier redesign
reports remain historical evidence. No commits, push, deployment, database reset
or personal credential edits were performed.

## Delivered

- Date of birth remains the stored source of truth. Age is read-only, calculated
  from the local calendar date, subtracting one when this year's birthday has
  not occurred. Missing/invalid DOB shows **Not provided**. A single timer refreshes
  at local midnight; focus/visibility refresh handles suspended tabs. All timers
  and listeners clean up on unmount. Existing DOB validation is unchanged.
- The help page has the exact five requested expandable questions, keyboard
  controls and `aria-expanded`/`aria-controls`. The “CineHook Support” eyebrow is
  gone. Chat With Us opens `/help/chat`, a full-height, clearly labelled future
  chatbot with no navbar, footer, message input or pretend replies.
- `/bookings/:id` contains no CineHook logo, tagline, internal-state paragraphs
  or Select Seats Again button. Back to My Bookings remains accessible.
  Only a confirmed booking is a ticket. Financial amounts/references come from
  the existing authenticated, owner-authorized summary API.
- Featured movie rotation uses one 5-second interval, smooth horizontal
  transitions and wraparound. Arrows/indicators work and pause automatic motion.
  Hover, keyboard focus and hidden tabs pause it. Reduced-motion preferences
  disable unattended rotation and CSS animation. Start is an explicit opt-in.
  Effect cleanup prevents duplicate intervals; Book Now uses the active movie ID.
- The two requested homepage filler lines are removed. Required demo/artwork and
  external-data credits remain unobtrusive and truthful.
- Login/register are focused full-height screens without browsing chrome;
  existing password auth, configured Google GIS and safe return navigation remain.
- Discovery footer contains exactly three graphical links: Customer Care,
  the approved developer portfolio and CineHook home/top. It appears only on `/`
  and `/movies`, with the educational-demo disclosure.
- 30 persisted original Hindi movie summaries accompany the existing English
  summaries. Safe official-trailer fields, importer, click-open privacy-enhanced
  YouTube dialog, Escape/close/focus restoration and player removal are implemented.
  Missing verified media remains unavailable, not invented.
- Stream/Events/Sports/Activities have themed, filtered, paginated PostgreSQL
  demo catalogues: six fictional listings each, original SVG illustrations,
  explicit DEMO/unavailable disclosures and no payment/play/booking actions.
  Offers categories remain promotional categories without invented discounts
  or collection of card/bank/UPI details.

## Financial detail presentation

| Persisted outcome | Customer heading and useful fields | Authority / restrictions |
| --- | --- | --- |
| Booking CONFIRMED, captured Payment SUCCESS | Payment Successful; film, venue/screen/show/seats, booking ID/status, actual provider payment ID, amount paid, valid ticket | Printing/cancellation use existing authority; no browser-derived paid flag |
| Payment FAILED, no captured money | Payment Failed; friendly explanation, booking/payment status; absent reference shown Not available | No amount-paid claim, refund ID or refund claim |
| Capture succeeded, booking FAILED/unfulfilled | Payment received / Booking could not be completed; Refund Processing when pending, full amount and actual references if present | No ticket, revival, seat reacquisition or internal failure code |
| Refund PENDING | Refund In Process; persisted refund amount, original payment ID, provider refund ID when available, status | Missing ID says Not yet available; retry invokes existing server workflow |
| Refund REFUNDED | Refund Completed; real provider refund ID, refunded amount, original payment ID, processed time when available | Provider completion is not a promise of immediate bank credit |

`RefundDetails` chooses the latest relevant provider attempt by sequence. For a
completed refund it uses processed provider evidence, not an internal obligation
UUID. Missing completion timestamps are omitted. A separately refunded extra
capture does not invalidate an otherwise confirmed ticket.

No production payment, booking, cancellation, refund or Redis state machine was
changed in this pass. Existing authorized DTOs already contained the needed
fields, so no new financial read endpoint or schema was necessary.

## Final customer FAQ content

1. **How do I book a movie ticket?**

   Choose a movie, your city, a date and a showtime. Select available seats, sign
   in and complete payment before the on-screen countdown ends. Your ticket is
   ready once your booking is confirmed.

2. **How do I select or change my city?**

   Select the location button near the top of a browsing page, search for your
   city, choose it and select Save location. The available movie showtimes will
   update for your choice.

3. **How can I cancel my booking and request a refund?**

   Open My Bookings, choose your confirmed booking and select Manage / cancel.
   You can cancel your own eligible booking only before the show starts. A paid
   cancellation receives a full refund of the amount paid. If payment was received
   but the booking could not be completed, a full refund is due even after showtime.

4. **How long does it take to receive my refund?**

   Crediting time depends on your payment provider, payment method and bank.
   Check View status / refund in My Bookings for progress and your refund reference
   when available. A completed refund may take additional time to appear in your
   account; we cannot promise a fixed arrival date.

5. **Where can I see my booked tickets and payment status?**

   Sign in and open My Bookings. Select View ticket for a confirmed booking, or
   View status / refund to check payment and refund progress. Only a confirmed
   booking is a valid ticket.

Refund timing was checked against [Razorpay normal-refund guidance](https://razorpay.com/docs/payments/refunds/normal/).
The UI deliberately avoids a fixed bank-credit deadline. Product policy remains
owner cancellation strictly before show start and full captured-amount refund;
paid-but-unfulfilled compensation is full regardless of showtime.

## APIs, data and request flow

New public read:
`GET /api/demo-catalog/:kind?category=&search=&page=&limit=`.
Kinds: `stream`, `events`, `sports`, `activities`; validates route/query,
returns active-only stable pages and explicitly `isDemo: true`,
`bookingAvailable: false`. No mutation, purchase or streaming API exists.

Flow: CategoryPage -> typed demo API adapter -> Express Route -> validation
middleware -> DemoCatalogController -> DemoCatalogService -> DemoCatalogRepository
-> Prisma -> PostgreSQL. The repository owns filtering/order/paging; the service
owns safe public demo projection. No Redis is involved in this read-only module.

Additive models: nullable Movie descriptionHindi/trailerVideoId/trailerSourceUrl/
trailerVerifiedAt and independent DemoListing/DemoListingKind. Trailer fields
must be absent together or complete with valid YouTube ID, exact TMDB-film source
and timestamp. DemoListing has unique slug, kind/activity/category lookup index,
optional city/venue/date/duration and image attribution; it has no Show/Booking
relationship. The development tools preserve modified existing rows.

Existing financial flow stays:
UI -> booking summary/cancel/refund-retry adapter -> authenticated owner routes
-> controller -> BookingService/PaymentService/refund service -> repositories
-> Prisma/PostgreSQL; external evidence goes through PaymentProvider. Atomic
ConfirmedSeat release and Redis owner-fenced temporary holds remain unchanged.

The manual TMDB importer checks exact title, release year and original language;
only official YouTube Trailer results from that film's videos response are stored.
Provider errors/missing results preserve existing metadata. Source-labelled TMDB
ratings keep the existing seven-day cache policy. No IMDb/Rotten Tomatoes score,
real poster or trailer ID was fabricated. API credentials do not grant media rights.

## Fresh verification evidence

| Check | Final result |
| --- | --- |
| Backend unit / HTTP / repository tests | 616 passed, 36 files; 0 failed / 0 skipped |
| Frontend tests | 155 passed, 16 files; 0 failed / 0 skipped |
| Backend typecheck, including new seed/test sources | Passed |
| Frontend lint and source/test typecheck | Passed |
| Prisma validate / generate | Passed; generated client 7.10.0 |
| Backend / frontend builds | Passed |
| Backend / frontend npm audits | 0 vulnerabilities |
| Native PostgreSQL / Redis domain regressions | 73 passed; 0 failed / 0 skipped |
| Base seed, refinement seed/native projection, compiled smoke | 2 + 2 + 2 passed; 0 failed / 0 skipped |
| Browser responsive matrix after customer corrections | 125 loaded page states, all five requested widths; 0 page overflow / broken loaded images |
| Guarded development content seed rerun | 0 listings created, 0 summaries overwritten |

Native tests use fresh explicitly named `_test` databases on a separate temporary
loopback PostgreSQL 55438 cluster and Redis 55439 database 15, not personal data.
All ten migrations were deployed on those targets. Test records remain recoverable;
no existing database was reset or dropped. Native tests emit a pinned pg-client
query deprecation warning; the Windows verification Redis emits a local resource
warning. Neither is a failed check. Docker/CI/deployment were not executed.

Browser measurements saved under `docs/verification/`:

- `customer-public-responsive.json`: 13 public routes x 5 widths = 65.
- `customer-status-responsive.json`: profile/wishlist/history and four financial
  detail routes x 5 widths = 35.
- `customer-admin-responsive.json`: dashboard/movies/shows/bookings/payments x 5
  widths = 25.

Widths: 320, 390, 768, 1024, 1440px. Seat maps and administrative tables intentionally
scroll within their own regions, without page-wide overflow. Measurements wait
for loaded content, not skeletons. Earlier `refinement-*.json` screenshots/results
pre-date the five additional corrections and must not replace this newer evidence.

Controlled browser journeys used the compiled frontend, real Express services,
PostgreSQL and Redis with a clearly labelled LOCAL TEST CHECKOUT provider. No real
money, live Razorpay account or personal login was used. Verified:

- Password login, owner profile DOB save/reload, computed age 25 for DOB
  2000-10-11 on 2026-10-10, read-only email/age, wishlist save/reload/remove.
- Real show selection -> A3/A4 hold -> trusted ₹600 order -> signed capture ->
  Payment SUCCESS / Booking CONFIRMED -> cancellation -> REFUND_PENDING ->
  provider-processed REFUNDED. Actual payment/refund IDs and completion time
  rendered. Early retry remained pending; later evidence completed the refund.
- A3/A4 became available after cancellation; another user's A1 stayed booked.
- Controlled signed failed-payment evidence: Payment Failed, no refund claim.
- Captured-but-unfulfilled case: FAILED booking, full refund pending, actual
  financial references, no valid ticket or seat reacquisition.
- A genuine new A5 five-minute unpaid hold expired naturally; owner history
  became FAILED, checkout redirected to the failed detail page with no Pay or
  rebooking button, and A5 became available. No clock/TTL was changed.
- All five FAQ cards expanded/collapsed with keyboard support; Chat With Us
  and return navigation worked, placeholder had no browsing chrome.
- Banner advance at approximately 5 seconds, last-to-first loop, manual controls
  and correct movie links. The browser requested reduced motion, so initial
  unattended rotation correctly stayed paused; Start explicitly enabled it.

Current screenshots include `customer-home-desktop.png`, `customer-help-desktop.png`,
`customer-account-mobile.png`, `customer-payment-success-mobile.png`,
`customer-payment-failed-mobile.png`, `customer-compensation-mobile.png`,
`customer-refund-pending-mobile.png`, `customer-refund-completed-mobile.png` and
`customer-expired-hold-mobile.png`. Financial references in these images belong
only to isolated local test records.

Review: targeted self-review and regression/browser verification were completed
for ownership, financial truth, timer cleanup, media provenance, seed preservation
and unavailable-state boundaries. An attempted independent reviewer could not run
because its account usage limit was reached; no independent-review verdict is claimed.

## Development data / provider boundaries

Verified native target: cinehook_dev/public, port 5432, ten applied migrations.
30 movies have English/Hindi summaries; 24 demo listings, 3 cities, 3 demo theatres,
6 screens, 288 physical seats, 102 retained shows and 306 seat-type prices.
At the final inventory read 90 shows were future, with future availability for
all 30 movies (six earlier morning shows had started during verification).
Past shows/booking history and existing users are retained; runtime counts may
grow with normal local use. The original cinehook database remains on its original
six migrations with unchanged empty domain-table counts.

Optional Google, TMDB, Razorpay and Cloudinary configuration is absent in this
checkout. Implemented integrations fail closed when absent. No real Google login,
Cloudinary upload, TMDB import/trailer playback, provider charge/refund or public
webhook delivery is claimed. Real posters/current provider ratings/trailers require
authorized content and configuration. IMDb/Rotten Tomatoes authorized adapters,
non-movie purchases, streaming, actual promotions and a working chatbot remain
deliberately deferred. No scalability work was added.

The exact blank settings and media-logo slot are listed in
[provider-setup.md](provider-setup.md). Exact created/changed source files are in
[refinement-files.md](refinement-files.md). The historical foundation document
was not modified.

## Ordinary local restart (no reseeding needed)

PostgreSQL 5432 and Redis 6379 must stay running. Do not start a second app copy
if ports 4000/5173 are already healthy. The final app processes are hidden
background helpers launched separately from the verification terminal.
If restarting these background helpers, identify the exact 4000/5173 process first
or use the Windows process controls; do not stop PostgreSQL/Redis or unrelated Node
processes. For a normal terminal-owned launch, keep these two terminals open:

```powershell
# Backend terminal
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
npm run dev:populated
```

```powershell
# Frontend terminal
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\frontend"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open [CineHook](http://localhost:5173). Backend readiness:
`http://localhost:4000/api/health/ready`. Vite forwards `/api` to 4000.

For a new setup/additive content update, first run the guarded check/migration,
Prisma generation, `db:seed:dev` and `dev:content:seed` commands in
[provider-setup.md](provider-setup.md). Do not overwrite `.env`, migrate/reset the
original database or seed automatically in production. Temporary verification
services are separate from the normal app and are stopped at handoff without
deleting their database records.

Final runtime handoff: temporary PostgreSQL 55438, Redis 55439 and browser fixture
55440 were stopped. Normal PostgreSQL 5432, Redis 6379, backend 4000 and frontend
5173 remain running. Frontend, backend readiness and proxied movie/demo reads
returned HTTP 200 after test-service shutdown. Git HEAD remains
`54ac39c18037c0ffb851c3644e267f0fc658c556`; local work remains uncommitted.

A final runtime check found both earlier Node launchers absent, with no fatal
application error in their logs; PostgreSQL/Redis were healthy. They were restarted
as hidden, detached Windows helpers and readiness/proxy/browser checks repeated.
No database or credential workaround was used. The exact cause of the earlier
process exit was not established; normal terminal restart commands above remain
the reproducible way to run with visible logs.
