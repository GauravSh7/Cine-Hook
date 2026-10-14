# Task 1 brief — approved Profile / Cloudinary / Wishlist

Repo C:/Users/gaura/OneDrive/Desktop/Cine-Hook. Read this first: these are your
requirements. Spec ../specs/2026-10-08-screenshot-profile-wishlist-seed-design.md.
No subagents; no commits/push/staging; no service/DB/migration execution; no secrets
or .env reads. Preserve all financial/booking/Redis sources. Use apply_patch, TDD.

Own backend new account/Cloudinary/wishlist modules, auth public mappings/types,
config, app/server wiring, Prisma schema + one additive migration, npm dependencies
and unit tests. Do not edit frontend/docs (except your report), seed, existing
financial modules or historical migrations. Existing other tests may need public
User type fixture compatibility; keep optional DTO fields so old literals work.

APIs and DTO contracts:
- PublicUser explicit selected fields id,name,email,role,createdAt,updatedAt,
  dateOfBirth?:string|null, phone?:string|null, avatarUrl?:string|null. Prisma may
  store Date while response DOB is YYYY-MM-DD. Never return passwordHash or
  avatarPublicId. Auth repository/service explicitly map full public response.
- Nullable User.dateOfBirth DATE, phone varchar20, avatarUrl and internal
  avatarPublicId. Optional name PATCH keeps current 1..100 validation. DOB valid
  date-only, not future, nullable; phone nullable E.164 ^\+[1-9][0-9]{7,14}$,
  nonunique/unverified; email and role cannot be patched. No stored age.
- PATCH /api/account/profile strict nonempty subset {name,dateOfBirth,phone} ->
  {user: current public user}, matching existing /me envelope. GET account uses
  existing /api/auth/me, no duplicate auth.
- POST /api/account/avatar multipart single field image -> {user: public user}.
  auth/current-user before multer, memory buffer <=3MiB, fields0/files1/parts1,
  only image/jpeg,image/png,image/webp; sharp actually decodes, rejects corruption,
  animation/oversized dimensions (>4096 edge or >16M pixels), rotates/re-encodes
  resized WebP (max512 edge), strips metadata. No SVG/GIF/browser URL/public ID.
- Provider abstraction with Cloudinary signed upload/delete using server secret,
  optional triple CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in config; none works
  for other modules and avatar fails503, incomplete config fails safe field names.
  Bound provider timeout10sec. Server-chosen unique public ID per user/upload;
  validate expected returned public_id and HTTPS Cloudinary host/cloud-name URL.
  No external call inside DB transaction. Safely serialized database swap returns
  old ID; cleanup outside transaction only after success. Upload/write failure
  leaves old stored avatar; safe best-effort orphan/old cleanup documented.
- Authenticated GET /api/wishlist/movies?page&limit -> {items,page,limit}, items
  {movie:<existing public movie fields including isActive>,createdAt}. Default20
  max100, ordering createdAt descending plus movieId. GET /api/wishlist/movies/:id
  -> {saved:boolean}. PUT same route strict empty body -> {saved:true}; DELETE
  -> {saved:false}. PUT idempotent owner/movie unique, checks active existence
  race-safe with disable where practical. DELETE missing is idempotent. All
  owners derived from current user; foreign owner IDs/metadata rejected; no-store.
- MovieWishlist {userId,movieId,createdAt}, compound unique/PK and FK, index user
  createdAt/movieID. Preserve disabled saved movie visibility/removability.

CreateApp optional dependencies account and wishlist to preserve old fixtures;
production factory wiring always included. Existing webhook raw route untouched.
Dependencies multer + sharp (+types) are permitted for bounded decoded uploads.
Official sources checked by root: expressjs.com/en/resources/middleware/multer/,
sharp.pixelplumbing.com/api-constructor/ and Cloudinary upload API reference.

Tests: real HTTP/service validation/owner isolation/extra fields/name/date/phone/
email rejection; unauth uploads parsed only after auth; JPEG/PNG/WebP decode,
MIME spoof/corruption/too-big/multiple/animated; provider timeout/error/wrongURL/
wrongID and image replacement failure preserve old; duplicate wishlist, disabled
history/remove, pagination/safe fields. Use actual sharp/bcrypt/JWT and provider
transport replacement only; repository unit fakes okay, root owns live tests later.
Watch RED before feature code; document commands/output. Run complete npm test,
typecheck, db:validate, db:generate, build, audit, not migrations/live services.
If app extensions need existing UI fixture wiring, coordinate with root; do not
modify that fixture without asking. No money state/logic/API changes.

Report docs/superpowers/plans/2026-10-08-task-1-report.md with exact files/API,
RED/GREEN evidence, checks, decisions and external boundaries. Return short
DONE / DONE_WITH_CONCERNS / BLOCKED + test counts. Root will review source.
