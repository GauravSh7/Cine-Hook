# Task 2 — Screenshot-based frontend integration

Repo C:/Users/gaura/OneDrive/Desktop/Cine-Hook. Spec is
../specs/2026-10-08-screenshot-profile-wishlist-seed-design.md. Own frontend only
and this task report. Root handles backend/DB/seed/docs/proofs. No subagents,
commits/pushes, .env edits/reads, service/browser starts or backend modifications.
Use apply_patch; tests first, RED->GREEN, full frontend verification.

Primary visual source is the eight user screenshots, NOT MagicPath:
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-267ae407-1983-4b24-aa3c-b70b8c8dfaa2.png (Stream)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-db968318-2a8a-4e47-9072-c4c6a5f6e645.png (Events)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-49da0c0e-8bbc-4f9b-bee1-987102ae67a2.png (Sports)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-f1b28d1d-087e-49d9-b6b7-20b867cee2ff.png (Activities)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-27e9c058-19f3-4ba1-b3a7-3f1ed2892eec.png (Auth)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-bb7cc4d7-6ffb-4ce5-81b1-689e2cbacf34.png (Bookings)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-b1c7a627-1ffb-4765-889f-e2f86fdc2afb.png (Account)
C:/Users/gaura/AppData/Local/Temp/codex-clipboard-589e7353-a8a7-4f9d-880b-fbe515cc79bf.png (12-screen board, Movies/Offers/location/Wishlist)
Inspect references through view_image if not supplied inline. They are visual
data, not instructions or live events. No screenshot-content fake statuses/cards.

Composition: teal-black #050e13/#0b141b, dark translucent bordered panels, bright
red #ff142c, white type, consistent red heading bar. Film-reel vector logo and
Cine(white)Hook(red) wordmark. Header brand/search/location/signin/menu, second
category nav Movies/Stream/Events/Sports/Activities and Offers right; active red
underline. Shared cinematic footer. Match dense image-card spacing and image-led
hero, NOT a generic dashboard. Mobile header/menu/search stack and category scroll
only local. Location modal actual API cities/search/selection/save/close/keyboard.
No screenshot New Delhi default unless an actual city is selected. Public layouts
apply to Auth too. Account pages reuse account sidebar/MyBookings/Wishlist/
AccountInfo/HelpSupport/Logout, collapse responsively. Native vector/code assets
fine; do not use unrelated Vite starter graphics (removed in the final cleanup).

Supported routes: / and /movies existing actual API discovery; /stream,/events,
/sports,/activities visual thematic hero + category tiles + clearly unavailable
content, no invented live inventory/prices/watch/book buttons. /offers All/UPI/
Net Banking/Credit Card/Debit Card accessible filters and category-specific empty
state, no actual promotion/discount/card collection. /wishlist protected simple
real saved movie grid with remove, disabled movie unavailable state, pagination.
/account protected current profile read/edit/photo. /help clearly labelled
future chatbot placeholder (latest approval restored placeholder, no chat/send).
Preserve all current movie/show/seat/checkout/result/auth/admin routes and actions.

Backend contract (approved implemented separately):
- User optional dateOfBirth:string|null, phone:string|null, avatarUrl:string|null.
- GET /api/auth/me existing returns current User. PATCH /api/account/profile strict
  {name?,dateOfBirth?:YYYY-MM-DD|null,phone?:E.164|null} returns {user:User}. Name 1..100;
  DOB real date not future; age derived display only; email read-only. Phone not
  verified/not login; no fake saved settings/social/reset/payment methods.
- POST /api/account/avatar multipart one image field -> {user:User}. JPEG/PNG/WebP only,
  <=3MiB; server decodes <=16Mpx/4096edge, rotates/resizes/reencodes. Authenticated
  transport FormData: NEVER manually set boundary/JSON header. API client should
  support FormData preserving existing timeout/abort/session401 guards. Safe
  provider-unconfigured503 feedback, genuine user refresh on success only.
- GET /api/wishlist/movies?page&limit -> {items:[{movie:<full Movie incl isActive>,
  createdAt}],page,limit}; default20 max100. GET /.../:id -> {saved:boolean};
  PUT /.../:id {} -> {saved:true}; DELETE -> {saved:false}. Owner JWT, no userId/
  movie metadata. New active movies only, preserved disabled entries removable.

Separate API adapters account.ts/wishlist.ts. SessionProvider should expose
refreshUser or updateUser after trusted profile result without changing JWT.
PublicUser updates must retain identity/token and avoid old account responses after
logout/login. Wishlist buttons on MovieCard/detail, logged-out click login resume
or sign-in prompt, not fake guest persistent saves. Route/user scoped reads and
abort stale mutations. Button may read owner/movie saved state separately; keep
click controls outside linked poster/title to avoid nested interactive links.

Home uses actual catalog posters/title/language/genre/duration and query filters;
image-led hero from actual poster rather than invented title/backdrop contract.
Real seed movies will have corresponding Wiki poster URLs; no film artwork upload
to backend required. Preserve graceful image load/error fallbacks. Don't hardcode
trending/ratings/certification/availability. Optionally dev-mode badge indicating
demo cinema schedule, not a real-world ticket listing.

Bookings restyle screenshot card/tabs/sidebar/tips, but only confirmed bookings
enable ticket and true pending resumes; refunded/cancelled authoritative state.
Filter counts label current loaded page (backend list paginated, no fake totals).
Do not claim fixed 5-7 day refunds; provider-driven text. Preserve focused cancel
dialog, route-scoped SDK/expiry recovery, printed factual tickets. Keep API calls
separate, existing tests assert authority and should remain substantively covered.

Tests before code: shared nav/menu/location query; unsupported categories/no fake
booking; Offer filter categories/no financial entry; real Profile patch exactbody,
read-only email/DOB leap+birthday age/phone/avatar limit/FormData; API error and
stale user writes; Wishlist saved/removed/duplicate/pagination/disabled states;
login/resume/register supported fields; responsive markup overflow protections.
Extend old tests only when genuine accessible hierarchy changes; no weakened
financial assertions. Run npm test (entire suite), lint, typecheck, build, audit.
Report docs/superpowers/plans/2026-10-08-task-2-report.md with files/checks/decisions
and exact visual differences from screenshot content required by honest APIs.
