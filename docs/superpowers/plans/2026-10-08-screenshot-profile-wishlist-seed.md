# Screenshot UI, Profile, Wishlist and Seed Implementation Plan

> For agentic workers: execute task-by-task with TDD and fresh task/final reviews.
> User explicitly approved proceeding automatically in the EXISTING checkout;
> no staging/commit/push/worktree relocation. Use this ledger for recovery.

Goal: populate and launch the approved cinematic UI against real development APIs.
Architecture: unchanged domain layers; separate Profile, image-provider and
Wishlist modules, typed frontend adapters, explicit development-only seed.
Spec: ../specs/2026-10-08-screenshot-profile-wishlist-seed-design.md.

## Global constraints

- Preserve booking, seat-lock, payment and refund behavior without source edits.
- New nullable DOB/phone/avatar fields and MovieWishlist only; no new live domains.
- Existing PostgreSQL5432; isolated cinehook_dev, verified before writes; no reset.
- No secrets logged/committed, user data deletion, synced-source/foundation edits.
- Upload JPEG/PNG/WebP <=3MiB, <=16M pixels, <=4096px edges; re-encode server-side.
- Real prices, expiry, confirmation/refund authority stay on backend.
- No remote Cloudinary/Razorpay success claim without configured actual delivery.

## Review focus

Avatar MIME spoofing/decode limits/ownership and replacement failures; stale
profile/wishlist reads on account changes; disabled wishlist movie behavior;
seed collisions/reruns after scheduled layouts; accidental original DB selection.

## Task 1: Profile / Cloudinary / Wishlist backend

Brief: 2026-10-08-task-1-profile-wishlist.md. Own backend modules/auth/config,
schema/additive migration/app/server/package/test changes only. Produce public
User optional fields dateOfBirth:string|null, phone:string|null, avatarUrl:string|null;
PATCH /api/account/profile {name?,dateOfBirth?,phone?}; POST /api/account/avatar
multipart image; wishlist GET list/status and PUT/DELETE /api/wishlist/movies/:id.
- [x] RED ownership/strict validation/DOB/image/duplicate/history/provider tests.
- [x] GREEN separated modules, explicit public DTOs, no financial source changes.
- [x] Full backend unit/typecheck/Prisma/build/audit and fresh review.

## Task 2: Screenshot frontend

Own frontend source/tests/assets/config only; consume Task1 exact APIs. Shared
Brand/Header/LocationDialog/Menu/Footer/AccountLayout; profile/wishlist adapters;
movie, auth/history restyle; unavailable category/Offers/help pages; preserve
checkout/seat/result authority. Query name for movie search is search.
- [x] RED profile/Wishlist navigation/persistence/actions/category/Offers/DOB tests.
- [x] GREEN screenshot layout, responsive states, actual API actions/images.
- [x] Full frontend tests/typecheck/lint/build/audit and fresh review.

## Task 3: Explicit development seed and setup

Own backend/prisma/dev-seed* and backend/scripts/dev-* plus seed tests; package
script/config coordinated after Task1. Preserve protected SQL layout constraints.
Inputs are explicit verified dev target and secure local ADMIN password; no URL
or password printed. Output is inventory counts and safe identifiers only.
- [x] RED target guard/deterministic dates/manifest/ADMIN/preservation tests.
- [x] GREEN repeatable missing-only seed, dev db/start helpers, local instructions.
- [x] Seed-twice/live concurrency tests and review on verified isolated test DBs.
- [ ] Run public seed in persistent cinehook_dev after local administrator creates it.

## Task 4: Integrated verification and documentation

Root owns DB identity/provision/migration/seed/browser/service lifecycle. Existing
cinehook baseline counts/identity remain unchanged. Confirmed cinehook_dev launch
uses explicit override, not an accidental default from backend/.env.
- [x] Run all regressions/live suites, isolated migrations/generation/build/audit.
- [x] Verify real movie/auth/profile/wishlist/seats/booking/history via Express/browser.
- [x] Responsive390/768/1440; truthful provider-unconfigured/unavailable states.
- [x] Fresh final review; document APIs/files/seed/launch commands/remaining limits.
- [x] Update module/progress docs; foundation/HEAD unchanged; no commit/push.
- [ ] Persistent cinehook_dev setup and genuine configured Cloudinary/Razorpay delivery.

## Ledger

Base HEAD: 54ac39c18037c0ffb851c3644e267f0fc658c556. Baseline verified: backend409,
frontend56 passing. Existing checkout/main/uncommitted work retained at user's
request. User explicitly approved scope/automatic implementation; routine extra
artifact approval/commit/worktree prompts are overridden by that instruction.
Preflight: Task1 public fields/routes feed Task2; Task1 migration feeds Task3;
Task3 explicit dev target feeds Task4. Files separated; package script edits
serialized. Task1-4 internal constraints match spec. No new architecture gate.
Task1 complete: worker494/25 unit results and all type/Prisma/build/audit gates;
root four live PG results including concurrent saves. Fresh review found a
single-frame animated WebP gap, reproduced RED->GREEN and scoped review approved.
Task2/3 complete and reviewed; Task4 isolated verification/documentation complete.
Actual persistent dev target remains absent and requires local administrator
creation. No false complete/deployed/provider-delivery claim is authorized.

Final evidence: backend521 unit,72live results0skip,2smoke; frontend86 unit,
lint/types/Prisma/builds/audits0; seednative2pass0skip. Actualcurrent-date seed
6films/42shows/288seats, secondrunall0creates. Browser real supported journeys,
holdexpiry, providerunavailable and42 responsive checks pass. Scoped reviews
resolved imageanimation, seedfixture, Wishlistpaging/read races; noImportant
finding remains. Module notes carry exact remaining setup and launch commands.
Cleanup verified: only original PostgreSQL5432 and Redis6379 remain listening;
task-owned4000/5173/55438/55439 are stopped. Test files retained; no data delete.
Temporary browser viewport reset/tab closed. Final actual dev guard still fails
closed because the dedicated database is absent; report this as setup pending.

Ruling: Profile/avatar responses wrap {user} consistently with existing /me,
not a bare User. Both briefs and composed test use the same envelope; no domain
decision changed. Local5432 target verified: cinehook exists, six migrations,
zero domain records; app role lacks CREATEDB and cinehook_dev does not yet exist.
User was asked asynchronously to create it locally, without sharing credentials.
Task-owned test PG55438 uses a fresh known bootstrap, cinehook_profile_test,
for live verification only; it is not a substitute for approved development DB.

Ruling: Use dispatching-parallel-agents for independent Task2 frontend and Task3
seed/setup after reviewed Task1 contracts. Their source ownership is disjoint
(frontend versus backend/prisma/scripts/tests/package); only root coordinates
database/services/integration. No concurrent implementers share files. Cost if
wrong: cross-layer integration mismatch, caught by final real API/browser gates.
