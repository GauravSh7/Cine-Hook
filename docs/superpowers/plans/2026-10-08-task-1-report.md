# Task 1 report — Profile / Cloudinary / Wishlist

Status: DONE_WITH_CONCERNS. Backend implementation and required local checks pass.
Root owns live PostgreSQL/migration/integration verification and external-service
configuration. No frontend, seed, financial/booking/Redis source, historical
migration, secret file, service runtime, or Git mutation was performed by this task.

## Public contracts

Existing response envelope remains `{success:true,data:...}`.

| Route | Authenticated result / input |
| --- | --- |
| `GET /api/auth/me` | `data.user` includes explicit public fields and nullable `dateOfBirth`, `phone`, `avatarUrl` |
| `PATCH /api/account/profile` | Nonempty strict subset of `name`, `dateOfBirth`, `phone`; returns `data.user` |
| `POST /api/account/avatar` | Exactly one multipart `image`, no fields; returns `data.user` |
| `GET /api/wishlist/movies?page&limit` | `data:{items:[{movie,createdAt}],page,limit}` |
| `GET /api/wishlist/movies/:id` | `data:{saved:boolean}` |
| `PUT /api/wishlist/movies/:id` | Empty body or `{}`; `data:{saved:true}` |
| `DELETE /api/wishlist/movies/:id` | Empty body or `{}`; `data:{saved:false}` |

Account/wishlist responses use `Cache-Control:no-store`. Owners come from the
current database user; status/mutation endpoints reject extra query fields and
body fields. List queries are strict, default page1/limit20, maximum limit100.
All public user mappings select/return only id/name/email/role/createdAt/updatedAt/
dateOfBirth/phone/avatarUrl. Date of birth is a valid nonfuture date-only string
or null. Phone is unverified, nonunique, nullable E.164; email/role/age/provider IDs
cannot be updated. No passwordHash/avatarPublicId leaves public service mappings.
Saved disabled movies remain visible, report `isActive:false`, and are removable.

## Exact files

Modified:

- `backend/prisma/schema.prisma`
- `backend/src/modules/auth/auth.types.ts`
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/user.repository.ts`
- `backend/src/config/env.ts`
- `backend/src/app.ts`
- `backend/src/server.ts`
- `backend/package.json`
- `backend/package-lock.json`

Added account sources:

- `backend/src/modules/account/account.types.ts`
- `backend/src/modules/account/account.validation.ts`
- `backend/src/modules/account/avatar-image.ts`
- `backend/src/modules/account/account.service.ts`
- `backend/src/modules/account/account.repository.ts`
- `backend/src/modules/account/account.controller.ts`
- `backend/src/modules/account/account.routes.ts`
- `backend/src/modules/account/cloudinary.provider.ts`
- `backend/src/modules/account/create-account.ts`

Added wishlist sources:

- `backend/src/modules/wishlist/wishlist.types.ts`
- `backend/src/modules/wishlist/wishlist.repository.ts`
- `backend/src/modules/wishlist/wishlist.service.ts`
- `backend/src/modules/wishlist/wishlist.controller.ts`
- `backend/src/modules/wishlist/wishlist.routes.ts`
- `backend/src/modules/wishlist/create-wishlist.ts`

Added migration and tests:

- `backend/prisma/migrations/20261008000700_profile_wishlist/migration.sql`
- `backend/tests/account-wishlist.test.ts`
- `backend/tests/account-http.test.ts`
- `backend/tests/wishlist-http.test.ts`
- `backend/tests/cloudinary-config.test.ts`
- `backend/tests/cloudinary-provider.test.ts`
- `backend/tests/profile-wishlist-repository.test.ts`
- `backend/tests/helpers/account-wishlist.ts`
- This report.

Prisma client generation and build regenerate ignored `backend/src/generated`
and `backend/dist` outputs. No historical SQL or existing tests were edited.
Dependencies added: multer2.4.0, sharp0.35.5, @types/multer2.3.0 (caret ranges).

## Persistence, provider, and decisions

- User receives nullable DATE DOB, varchar20 phone, avatar URL, internal provider
  ID. MovieWishlist maps to `movie_wishlists` with compound owner/movie primary
  key, FKs, created timestamp and owner/time/movie index. Migration is additive.
- Account swaps use a PostgreSQL user row lock, then read/update inside one
  transaction. External upload/delete occurs outside that transaction.
- Each upload has a server-chosen `cinehook/avatars/<user UUID>/<random UUID>`
  public ID and `overwrite:false`. SHA1 Cloudinary signatures include sorted
  provider parameters and the server secret; the secret is never sent as a form
  field. Upload validates returned public ID, HTTPS `res.cloudinary.com`, correct
  cloud-name/image/upload path, and rejects credentials/ports/query/fragments.
- Both provider transport and response JSON parsing have a ten-second deadline;
  abort signal plus a deadline race also handles transports that ignore abort.
  Missing provider configuration gives503; invalid provider responses/errors502;
  timeout504. Complete optional CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET is needed;
  incomplete/invalid values fail config with safe field names only.
- Multer memory parsing follows auth/current-user checks and accepts one image
  part, zero text fields, maximum3MiB, JPEG/PNG/WebP MIME types. Sharp actually
  decodes and matches the decoded format, rejects corruption and animation,
  maximum4096 per edge and16M pixels, rotates/resizes to maximum512, re-encodes
  WebP and drops metadata.
- Ruling: additionally parse bounded PNG chunk boundaries to reject `acTL`.
  The generated APNG regression proved sharp/libvips exposed only its first frame
  and previously accepted it; metadata.pages alone did not satisfy animation
  rejection. Cost if wrong: an APNG is rejected as intended; corrupt chunk bounds
  are rejected. Static PNG tests remain green.
- Ruling: use PostgreSQL `INSERT ... ON CONFLICT (user_id,movie_id) DO NOTHING`
  for wishlist insertion rather than relying on Prisma empty-update upsert
  implementation behavior. A `FOR SHARE` movie lock synchronizes with UPDATE/
  disable, and its current active flag is checked before insertion. Cost if wrong:
  this is PostgreSQL-specific, matching the existing database contract.
- Public optional DTO fields keep older test fixtures assignable. Both optional
  app dependencies preserve existing createApp fixtures; server wiring always
  supplies createAccount/createWishlist. Raw webhook routing order is untouched.

## Cleanup boundaries

After successful database swap, old image deletion is best effort. A deletion
failure leaves a harmless older provider asset and does not undo the current
profile. On a database failure, the service freshly reads the current provider ID
and deletes the new upload only if that read confirms it is not current. Failed
verification skips deletion, protecting an ambiguously committed current image.
Upload timeout, malformed provider response, failed cleanup, or unavailable
database verification can leave an orphan provider asset. No background cleanup
worker was added; these cases need provider-side operational cleanup. Stored old
avatar remains unchanged on rejected upload/write (except a truly committed write
whose response is lost, which the fresh-read safety rule accommodates).

## RED / GREEN evidence

- `npm test -- tests/account-wishlist.test.ts`: initial RED1/1, expected profile
  fields absent from real `/auth/me`; after explicit mapping GREEN1/1.
- Same command after protected route contract tests: RED2/3, actual404 vs
  expected401 for missing routes. After wiring the real modules, GREEN3/3.
- `npm test -- tests/account-wishlist.test.ts tests/cloudinary-config.test.ts`:
  RED3/7 (complete config undefined; partial/invalid config accepted), then
  GREEN7/7 after config implementation.
- `npm test -- tests/account-http.test.ts tests/wishlist-http.test.ts`:
  initial RED5/46; three real wishlist gaps (non-JSON body accepted, owner query
  accepted on status, extra movie field leaked) plus two fixture defects (large
  unauthenticated HTTP upload connection reset; identical animation frames
  optimized to one frame). Corrected fixtures and validation/public mapping:
  GREEN46/46.
- `npm test -- tests/profile-wishlist-repository.test.ts`: tightened native
  duplicate insertion contract RED1/6, then GREEN6/6 after native INSERT change.
- `npm test -- tests/account-http.test.ts`: APNG regression RED1/32 (actual200,
  expected400), then GREEN32/32 after bounded PNG animation-chunk rejection.
- Provider coverage includes signed upload/delete, invalid ID/URL/result,
  network/HTTP/JSON failures, both ten-second deadlines, body parsing deadline,
  stored-avatar timeout/failure preservation and best-effort deletion. HTTP
  tests use real Express/middleware/services/sharp; existing auth suite uses
  actual bcrypt/JWT. Only external Prisma repositories or provider transport are
  replaced in unit tests.
- Process limitation: supplementary HTTP/provider/repository tests were added
  after the initial implementation and some passed immediately. The above
  observed RED/GREEN cycles are genuine, but this is not evidence that every
  individual function or test was developed with strict test-first sequencing.

## Required final checks

Executed in `backend` on 2026-10-08:

| Command | Result |
| --- | --- |
| `npm test` | PASS493 tests,25 files, exit0 (baseline409 +84 added) |
| `npm run typecheck` | PASS exit0 |
| `npm run db:validate` | PASS schema valid, exit0 |
| `npm run db:generate` | PASS Prisma7.10.0 client generated, exit0 |
| `npm run build` | PASS exit0 |
| `npm audit` | PASS zero vulnerabilities, exit0 |

Prisma validate/generate used a harmless explicit localhost:1 placeholder URL
and do not connect or execute migrations. No live DB/service/migration command
ran here. Root coordinates isolated PostgreSQL concurrency/integration checks
and separate approved development DB setup. Actual Cloudinary delivery is
unverified without credentials; failure-closed behavior is verified. External
payment behavior and data are unchanged.

## Review fix — single-frame animated WebP

Root/reviewer identified an explicit animation-rejection gap: a valid WebP
animation container with VP8X/ANIM and only one ANMF frame reports sharp metadata
`{pages:1,loop:0,delay:[100]}`. Frame count alone accepted it.

Added the real HTTP regression `rejects a single-frame animated WebP container
despite reporting only one page` in `backend/tests/account-http.test.ts`. Its
fixture starts from two distinct frames encoded by sharp, retains only the first
ANMF chunk, preserves animation metadata and recomputes the RIFF length. Sharp
actually decodes the result and confirms the one-page/loop/delay metadata.

- RED: `npm test -- tests/account-http.test.ts` returned32 passed/1 failed,
  actual200 versus expected400 on the new case (2026-10-08 16:41 IST).
- Fix: `backend/src/modules/account/avatar-image.ts` now rejects any defined
  animation loop or delay metadata independently of page count. Zero loop is
  treated as an animation indicator rather than a falsy non-indicator.
- GREEN: same command passed33/33. The new regression also asserts safe
  `INVALID_IMAGE`, no provider operation, and preservation of the old avatar.
  Existing static JPEG/PNG/WebP success cases stay green.
- Final rerun: `npm test` passed494 tests/25 files; `npm run typecheck` and
  `npm run build` passed, all exit0 (2026-10-08 16:42 IST).

This narrow review fix followed strict observed RED→GREEN sequencing. No other
API, dependency, schema, migration, service configuration, or external boundary
changed. Root separately reports its live PostgreSQL integration suite4 passed,
including12 racing wishlist PUT requests; that evidence belongs to root's run.
