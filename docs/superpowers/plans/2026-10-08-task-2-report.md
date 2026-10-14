# Task 2 — Frontend implementation report

Implemented in the existing frontend against the completed backend account and wishlist contracts. All eight user screenshots were inspected through image viewing. No backend, database, service, browser, Git, environment or synced reference files were changed by this task.

## Implementation

- PublicLayout: screenshot-based teal-black/red shell, film-reel vector CineHook wordmark, search/location/sign-in/menu header, Movies/Stream/Events/Sports/Activities secondary navigation with active underline, Offers link and shared cinema footer. Mobile header stacks search and location; category overflow remains local.
- LocationDialog: actual API cities, local query, explicit selection/save, close/Escape, focus trap/restoration and stored city preference. No invented default city.
- HomePage/MovieCard/MoviePage: actual API movie posters and metadata, poster-led feature hero with error fallback, dense responsive movie grids, independent wishlist controls outside links, existing discovery/show filtering and booking actions preserved.
- CategoryPage/ThematicArt: native vector concert/stadium/adventure theme heroes and category tiles; unavailable inventory is clearly stated. No invented content, ticket price or watch/book success.
- OffersPage: All/UPI/Net Banking/Credit Card/Debit Card tabs with keyboard navigation, corresponding truthful empty state and no financial collection.
- AuthPage: shared public shell, screenshot-inspired two-column form/illustration, working real login/register and original return destination. Header sign-in on an auth route preserves returnTo rather than nesting it.
- AccountPage/account adapter/profile domain: current profile, strict supported PATCH body, read-only email, validated DOB/derived age and international phone, supported photo chooser/limit, actual multipart upload and trusted returned user update without replacing JWT. Failed uploads do not claim success. Abandoned account requests are aborted and cannot restore a logged-out identity.
- WishlistPage/wishlist adapter/WishlistButton: real owner-scoped status/save/delete/list with pagination, unavailable saved movies still removable, anonymous sign-in resume, duplicate-write guard and aborted stale writes. Repeated cards for the same movie synchronize through an owner-scoped internal event only after a real API success. On that event each button synchronously aborts its earlier status GET and starts a fresh one; older reads cannot overwrite the successful mutation, while later authoritative reads remain effective. Successful DELETE invalidates/refills the current server page rather than retaining local removal tombstones, preserving offset pagination and allowing a movie saved again to reappear on refresh. No guest persistence or client-supplied owner/metadata.
- BookingsPage/AccountLayout: account sidebar, authoritative booking summary cards with posters, current-page All/Upcoming/Past/Cancelled/Refunds filters, ticket actions only for confirmed summaries and checkout only for pending active holds. Provider-driven refund tips and current loaded page count label. Existing financial lifecycle and cancellation/detail flows retain their tests.
- API client: FormData transport leaves Content-Type/boundary to the browser; existing JSON, timeout, abort and token-scoped 401 behavior retained.

## Files

Modified: frontend/src/App.tsx; src/index.css; src/api/client.ts; src/api/types.ts; src/app/session-context.ts; src/app/SessionProvider.tsx; src/components/PublicLayout.tsx; src/components/MovieCard.tsx; src/pages/HomePage.tsx; src/pages/MoviePage.tsx; src/pages/AuthPage.tsx; src/pages/BookingsPage.tsx; tests/fixtures.ts (test API overrides now receive the request URL for real pagination-query assertions).

Added: frontend/public/auditorium.svg; src/api/account.ts; src/api/wishlist.ts; src/domain/profile.ts; src/components/Brand.tsx; src/components/AccountLayout.tsx; src/components/LocationDialog.tsx; src/components/ThematicArt.tsx; src/components/WishlistButton.tsx; src/pages/AccountPage.tsx; src/pages/WishlistPage.tsx; src/pages/CategoryPage.tsx; src/pages/OffersPage.tsx; src/pages/HelpPage.tsx; tests/account-wishlist.test.tsx; tests/screenshot-ui.test.tsx; tests/profile-domain.test.ts; this report.

## Verification

Final checks all exited 0 on the final implementation:

- `npm test`: 9 files, 86 tests passed. Existing 56 tests retained; 30 added covering the new behavior and boundaries. Original account/wishlist/shell tests were observed RED before implementation. The booking-tabs, duplicated wishlist card and auth-header returnTo regressions were also observed failing before their fixes. Scoped review follow-up added four observed RED-to-GREEN regressions: 21-row deletion/refill/pagination, re-save visibility on refresh, a deferred pre-save status GET followed by a valid later authoritative change, and international phone numbers below the backend's eight-digit minimum. Focused account/wishlist suite: 13 tests passed.
- `npm run lint`: no errors or warnings.
- `npm run typecheck`: application and test types passed.
- `npm run build`: Vite production build passed, 139 modules; final JS 351.00 kB (106.37 kB gzip), CSS 33.71 kB (8.34 kB gzip).
- `npm audit --audit-level=moderate`: found 0 vulnerabilities.

This task did not operate a browser. Root owns real API/browser, viewport and screenshot evidence. No claim of independent visual browser verification is made here.

## Deliberate differences from screenshot content

The screenshot's fictional stream/event/sport/activity inventory, prices, featured celebrities, watch/book buttons, promotions, static city, identity, card details, preferences, notification/security controls, social authentication and fixed refund timing were not copied as functional or live data. Unsupported categories use native thematic vector artwork and explicit empty states, rather than screenshot artwork containing fabricated listings. Auth supports email/password and the backend registration fields. Account offers only supported profile/photo fields. Movies and bookings use actual API data, so titles, imagery, cities, totals, dates and statuses differ from the references. The footer uses a native auditorium illustration and real internal destinations rather than unverifiable developer/social links. Wishlist remains the approved simple real saved-movie grid.

The code matches the reference layout, colors, bordered panels, navigation hierarchy, cinematic hero/footer and account/sidebar composition; native vector theme imagery is illustrative rather than the screenshots' photorealistic banners. Financial and ticket success is always server-authoritative. Live avatar upload depends on the backend provider configuration and a genuine valid image; 503 is reported safely.
