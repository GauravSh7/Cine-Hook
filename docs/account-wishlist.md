# Account Profile and Movie Wishlist

Backend checkpoint: 2026-10-08. Approved additions are isolated from existing
booking/Redis/payment/refund behavior. Implementation is reviewed and verified
against a separate test PostgreSQL database; original cinehook remains unchanged.

## New data and APIs

User adds nullable date_of_birth (DATE), phone (varchar20), avatar_url and an
internal avatar_public_id. There is no stored age. Public identity uses an
explicit DTO; passwordHash and provider asset IDs are never returned. DOB is
YYYY-MM-DD or null; phone is optional/unverified/nonunique, not a login identity.
Email remains read-only. Existing register/login input stays unchanged.

MovieWishlist (movie_wishlists) has user_id, movie_id, created_at, compound primary
key (user_id,movie_id), FKs and user/time/movie index. It cannot create a booking.
The seventh migration is additive; historical six migrations are unchanged.

| API | Input / result inside existing success envelope |
| --- | --- |
| GET /api/auth/me | data.user includes nullable dateOfBirth, phone, avatarUrl |
| PATCH /api/account/profile | Nonempty strict subset name/dateOfBirth/phone; data.user |
| POST /api/account/avatar | Multipart image only; data.user |
| GET /api/wishlist/movies | page/limit, defaults1/20 max100; items with movie/createdAt |
| GET /api/wishlist/movies/:id | saved:boolean |
| PUT /api/wishlist/movies/:id | Empty body or {}; saved:true |
| DELETE /api/wishlist/movies/:id | Empty body or {}; saved:false |

All routes authenticate and load current database user before processing owner
data. Owner derives from JWT, not browser body. Responses use no-store. Email,
role, age, userId, uploaded URL/provider ID and copied movie fields are rejected.
Future/invalid DOB and invalid international phone format are rejected.

## Request flows and responsibilities

Profile: Route -> auth/current-user Middleware -> AccountController ->
AccountService validation -> AccountRepository -> Prisma -> users -> public DTO.
The frontend calculates age at display time, never submits it.

Avatar: auth/current-user -> bounded Multer parser -> Controller -> AccountService
-> sharp decode/re-encode -> CloudinaryProvider signed upload -> AccountRepository
short serialized user-row transaction -> public DTO -> best-effort old asset
cleanup. Provider HTTP is never inside the database transaction. A new unique
server-chosen asset ID prevents uploads overwriting one another.

Limits: one JPEG/PNG/WebP, no text fields, at most3MiB,4096px per edge/16M pixels.
Actual decode matches declared MIME and rejects corruption/animation, including
APNG and single-frame animated WebP. Rotate, resize max512, re-encode WebP and
strip metadata. Provider deadline10seconds covers HTTP and response parsing.
Validate expected returned public ID and HTTPS Cloudinary cloud-name delivery URL.
Missing credentials503, provider errors502, timeout504; no fabricated avatar save.

After successful database swap, old asset cleanup is best effort. A lost database
commit acknowledgement triggers fresh current-ID inspection before orphan cleanup;
if that inspection fails, retain the asset rather than delete a possibly current
photo. Timeout/cleanup errors may leave unused provider assets needing operational
cleanup. No background worker was added.

Wishlist: route/current-user/strict parameters -> Controller -> WishlistService
-> WishlistRepository -> short transaction locks movie FOR SHARE, validates active
flag and INSERT ON CONFLICT DO NOTHING -> PostgreSQL. Duplicate requests yield one
row; catalogue disable synchronizes with the shared movie lock. Already-saved
disabled movies remain visible as unavailable and can be removed. Removal targets
only the authenticated owner/movie pair and is idempotent.

## Files and evidence

Account files under backend/src/modules/account own validation, image decoding,
provider, service/repository/controller/routes and construction. Wishlist files
under backend/src/modules/wishlist own its independent contract and persistence.
Auth public mappings/types, config and app/server wiring are extended deliberately.
Only multer/sharp/type dependencies were added; financial source modules untouched.
The exact file inventory and TDD/check output is in the
[Task1 report](superpowers/plans/2026-10-08-task-1-report.md).

Fresh checks:494 unit tests across25 files, typecheck/Prisma validate/generate/
build, audit0; root composed real PostgreSQL HTTP suite four results, zero skipped,
including12 racing saves, owner DOB persistence and decoded photo replacement.
Compiled smoke two results passed. Separate full financial regressions are recorded
in the overall progress tracker when their ongoing run completes.

Independent review reproduced single-frame animated WebP acceptance; a real fixture
regression failed200 vs required400, then passed after animation metadata checks.
Scoped review approved. Supplementary coverage added after initial implementation
is not represented as all test-first; exact honest cycles are in Task1 report.

Configuration: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
must be supplied together in local ignored config/secret manager, never VITE_*.
Actual Cloudinary account delivery is not yet verified because local credentials
are absent. Signed protocol references:
[Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference),
[Multer](https://expressjs.com/en/resources/middleware/multer/),
[Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).
