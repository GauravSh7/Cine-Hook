# CineHook provider-ready refinement implementation plan

Goal: implement the six approved UI/content refinements now, with optional
provider credentials deliberately blank and safe unavailable states until the
operator configures them. The binding spec is the user's final UI refinements
attachment, amended by the instruction to leave keys blank and finish structure
and functionality. Execution is continuous in the existing checkout; no commits.

Architecture: preserve existing booking/financial authorities. Add a separate
read-only demo catalogue using Route -> validation -> Controller -> Service ->
Repository -> Prisma. Movie metadata is additive. Provider imports are explicit
development tools, never a browser secret or prerequisite for starting the app.

## Constraints and decisions

- Only guarded cinehook_dev on native PostgreSQL 5432 may receive dev migration
  and seed writes. Preserve all pre-existing data and the original cinehook DB.
- Optional credential placeholders belong in backend/.env.example, not in source
  constants. Do not overwrite ignored .env or use dummy successful providers.
- IMDb/Rotten Tomatoes scores remain unavailable without authorized access.
  TMDB cached ratings stay labelled TMDB, with required credits when used.
- Existing English Movie.description stays intact; add nullable descriptionHindi,
  trailerVideoId, trailerSourceUrl, trailerVerifiedAt. Public projection validates
  provider provenance and YouTube identifiers before exposing an embed.
- Add DemoListing with stable slug, kind STREAM/EVENTS/SPORTS/ACTIVITIES, title,
  description, category, cityName, venueName, startsAt (nullable), durationMinutes
  (nullable), imageUrl, imageAttribution, isActive, timestamps. All responses
  explicitly mark isDemo=true and bookingAvailable=false; no booking relationship.
- GET /api/demo-catalog/:kind?category=&search=&page=&limit= returns the existing
  page envelope. Backend kinds are lower-case route values. No mutation API.
- Original category SVG assets are permitted repo-native art and must be labelled
  illustrative. Real-movie art/rating/trailers stay unavailable or labelled existing
  demo art until authorized content is imported; no made-up media IDs or scores.

## Task 1: focused authentication, graphical footer, support

Files: frontend/src/App.tsx, components/PublicLayout.tsx, components/Brand.tsx,
pages/AuthPage.tsx, pages/HelpPage.tsx, new pages/ChatbotPage.tsx, new focused
styling/tests. Own this boundary separately from category and movie changes.

- [x] Write tests for auth chrome removal, safe protected return redirects,
  three graphical footer links only on discovery, five working FAQs, /help/chat
  focused placeholder and its back link; watch RED then implement and GREEN.
- [x] Full-height auth branding/background with no public navbar/footer;
  preserve email/password/GIS behavior. Accessible accordion from actual policy.

## Task 2: read-only demo catalogues

Files: backend/prisma/schema.prisma (append DemoListing only), dedicated additive
migration, backend/src/modules/demo-catalog/*, app.ts/server.ts integration,
prisma/refinement-seed-core.ts and guarded CLI/npm command; frontend/api/demo-catalog.ts,
pages/CategoryPage.tsx, category CSS/art/tests. Do not edit Movie model or media.

- [x] TDD page/filter validation, active-only projection, non-bookable responses,
  missing/error/loading states. Seed six meaningful examples per category (24)
  with stable slugs, explicit DEMO labels and future dates for event examples.
- [x] Seed creates missing rows only under advisory transaction/identity guard;
  preserve modified existing records and test idempotency and collisions.
- [x] Thematic hero, filter chips, information-rich responsive grids with no fake
  Play or Book actions. Correct cities/venues/time labels and illustrative credits.

## Task 3: provider-ready movie media and bilingual synopsis

Files: Movie additive fields/migration, public-movie.ts, media import core/tool,
30-summary development manifest/enrichment tool, frontend MovieCard/MoviePage,
new TrailerDialog/MediaCredits and movie-media tests.

- [x] TDD public Hindi/trailer projection, exact YouTube ID/provenance validation,
  no credentials/provider failures preserving metadata, wrong-film rejection.
- [x] TDD card rating attribution/year, bilingual details, trailer modal accessible
  focus trap/Escape/close/unmount; no autoplay before explicit user click.
- [x] Original accurate Hindi summaries derived from existing verified film facts;
  guarded enrichment fills empty fields only and preserves user edits.
- [x] Extend manual TMDB import for verified official Trailer results only; operator
  supplies exact film IDs. Add permitted About/Credits attribution integration.

## Task 4: credential guide and full verification

Files: docs/provider-setup.md, docs/ui-integration.md, development-seed.md,
implementation-progress.md, final refinement report/file inventory/evidence.

- [x] List exact blank variables for Google, TMDB, Razorpay, Cloudinary and required
  local infrastructure/signing config. Explain API key is not image/data licence.
- [x] Backend/frontend suites, native PostgreSQL/Redis integration, migrations,
  seed reruns/data preservation, Prisma validate/generate, typechecks/lint/build,
  smoke/audits. No historical tests presented as new verification.
- [x] Real browser at 320/390/768/1024/1440: updated public/auth/help/catalogue/media,
  profile/wishlist, booking/hold/provider-controlled payment/cancel/refund/admin.
  Save screenshots and results; separate fixture playback from external acceptance.

## Review focus

Missing credentials must never prevent local auth/catalog startup. Unknown kinds,
unsafe trailer URLs and malformed pagination must fail safely. Empty seed enrichment
must not overwrite custom content. Modal closure must remove player/focus restore.
No demo non-movie record may be mistaken for a payable real public event.

## Execution ledger

2026-10-10: scope amended by user; former credential blocker waived for structure
and guarded integration. Native implementation plus independent parallel boundaries
authorized by the dispatching-parallel-agents skill. No extra approval pause required
by the user's continuous-execution instruction. That initial status is now
superseded by the final evidence below.

## Added customer-facing corrections — 2026-10-10

The user supplied five exact corrections while final verification was underway.
These extend this pass, not a restart. Native inline execution continues under
the existing continuous-execution/no-commit contract. No financial/schema change
is needed: the owner-authorized summary already returns payment IDs, refund
attempt provider IDs and processed timestamps.

- [x] Test and implement `AccountPage` missing-DOB `Not provided`, read-only age,
  birthday boundaries and refresh at local midnight/foreground using a small
  `app/use-current-date.ts` hook. DOB remains the only persisted age input.
- [x] Replace HelpPage's five questions with the exact requested customer FAQ
  topics; remove its eyebrow, technical words and unsupported refund deadlines.
  Verify Razorpay's official normal-refund guidance; retain accessible accordion
  and focused `/help/chat` with no fake support.
- [x] Test cases A–E through the existing `/bookings/:id` screen. Change
  FocusedLayout to hide brand/tagline only on this detail route and link back to
  My Bookings. BookingPage/BookingFacts render trusted payment/refund IDs, full
  amounts, statuses and processed timestamps; remove rebooking CTA and internal
  explanations. Preserve confirmed tickets/cancel/retry authority. No new DTO.
- [x] Test FeaturedCarousel advance/loop at 5000ms, manual arrows/indicators,
  hover/focus/visibility/reduced motion, cleanup. Remove specified HomePage
  filler but retain actual demo/artwork/media disclosures.
- [x] Rerun complete suites/builds/audits and affected browser screens at all
  five widths. Repeat controlled paid-booking/refund and expired-hold UI checks.
  Update current handoff/progress/seed/UI notes and exact file inventory.

Tests: new frontend/tests/customer-corrections.test.tsx plus existing carousel,
booking-flow and profile-domain coverage. Review focus: failed payment must not
look refunded; compensation must not look like a valid ticket; extra captured
payment compensation must preserve a confirmed ticket; missing IDs/timestamps
must not be fabricated; reduced-motion/hidden tabs must not start unattended
animation. The original cinehook database and all provider secrets stay untouched.

## Final execution evidence

616 backend tests, 155 frontend tests and 79 native/seed/compiled-smoke checks
pass, zero failures/skips. Typechecks, lint, Prisma validation/generation, builds
and audits pass. Browser: 125 current loaded responsive states at five widths,
real controlled signed capture/cancel/refund, failed capture, compensation,
actual references, genuine hold expiry, FAQ/chat navigation, carousel loop and
profile/wishlist persistence verified. Guarded content seed rerun added zero.
See [handoff](../refinement-handoff.md) and [files](../refinement-files.md).

Test-first failures were observed for new expected auth/category/media/financial
presentation and 5-second timing before their respective fixes. Existing birthday
calculation was preserved; new tests add read-only/missing-DOB and midnight refresh.
The independent reviewer could not execute due to usage limits. Targeted
self-review plus full regressions are documented, not an invented review verdict.
External provider account/media-rights acceptance remains operator setup, with
blank safe slots and a precise guide; it is not represented as tested delivery.
