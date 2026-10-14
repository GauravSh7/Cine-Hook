# Task 3 — Safe development seed and launcher

Repo C:/Users/gaura/OneDrive/Desktop/Cine-Hook. Own only backend/prisma/dev-seed*
and backend/scripts/dev-* plus backend seed/setup tests, isolated seed integration
test, tsconfig coverage if needed, package command additions and report. Root
coordinates actual database/service lifecycle. No .env edits or secrets reads,
no live database commands/service starts, Git mutations or child agents. Existing
seven migrations remain unchanged. Use apply_patch and TDD RED->GREEN.

Approved scope/spec ../specs/2026-10-08-screenshot-profile-wishlist-seed-design.md.
Real DB is separate cinehook_dev on VERIFIED existing localhost5432 service;
do not assume5434. Root verified original cinehook exists with six applied
migrations/all domain rows0, but current app role lacks CREATEDB. User has been
asked to create cinehook_dev with local admin and own it with existing app role.
Do not silently operate on cinehook. Tests run root-owned PostgreSQL55438, known
bootstrap and explicitly isolated *_test databases (root supplies URL).

Seed declarative manifest six films, corresponding VERIFIED exact poster URLs
(root fetched actual Wikipedia article og:image and HEAD checked each200 JPEG):
- Deadpool & Wolverine: 2024-07-26,128min,english,action/comedy;
  https://upload.wikimedia.org/wikipedia/en/4/4c/Deadpool_%26_Wolverine_poster.jpg
- Inside Out 2: 2024-06-14,96min,english,animation/family;
  https://upload.wikimedia.org/wikipedia/en/f/f7/Inside_Out_2_poster.jpg
- Stree 2: 2024-08-15,143min,hindi,horror/comedy;
  https://upload.wikimedia.org/wikipedia/en/a/a1/Stree_2.jpg
- Kalki 2898 AD: 2024-06-27,181min,telugu,sci-fi/action;
  https://upload.wikimedia.org/wikipedia/en/4/4c/Kalki_2898_AD.jpg
- Salaar: Part 1 – Ceasefire: 2023-12-22,175min,telugu,action/drama;
  https://upload.wikimedia.org/wikipedia/en/a/a6/Salaar_Part_1_%E2%80%93_Ceasefire.jpg
- Devara: Part 1: 2024-09-27,176min,telugu,action/drama;
  https://upload.wikimedia.org/wikipedia/en/f/f0/Devara_Part_1.jpg
Paraphrase short factual descriptions, label LOCAL DEVELOPMENT show inventory,
no current real-world event/cinema claim. Retain source URLs/attribution in manifest
or report for docs. Remote image availability may vary; do not download/mirror.

Three cities New Delhi/Delhi, Mumbai/Maharashtra, Bengaluru/Karnataka countryIN;
one clearly Demo theatre each, plausible demo-marked address; two screens each.
48 seats/screen A-F x1..8: A-D REGULAR,E PREMIUM,F RECLINER. Pricing25000/40000/
65000 paise. Map one film to each of six screens and one show/day at18:30 IST,
tomorrow through next seven days; real stored duration computes endsAt. UTC
normalized dates and deterministic date/slot IDs. No overlaps; existing conflicting
slot/collision aborts safely, never moves/reschedules/deletes data. Reused film
metadata stays untouched; actual duration used; inactive/ambiguous matches abort.

Dedicated stable development ADMIN id and admin@cinehook.local email. First
creation requires strong password supplied locally via secure hidden prompt or
DEV_ADMIN_PASSWORD environment. bcrypt12; >=12chars and <=72UTF8bytes,noNUL.
Never hardcode/log/password shellarg, never reset hash/name on rerun, never
promote an existing USER. Email/id mismatch aborts. Preserve other admins/users.
Root may use explicitly test-only password in isolated integration; actual dev
ADMIN first password should be user-selected/configured locally, not an unknown
root-generated secret that locks the user out.

Core seed validates collisions, acquires transaction advisory lock, READ COMMITTED
and missing-only creates. Stable namespace IDs for seed-owned rows; existing
City/Theatre/Screen compound identities reused without data overwrite. Movie fixed
ID first then title/language/release date match; ambiguous/conflicting identity
abort. If screens already have layout, compare full coordinates/types/capacity;
NO seat INSERT/upsert/skipDuplicates after any Show exists. New full layout and
each show+all prices atomic. Same-day rerun no new rows; later days append future
schedule; no bookings/payments/refunds/wishlist seed or user row reset.

Provide explicit npm commands:
- db:seed:dev executes dev-only seed; never linked to migration/build/startup.
- dev:db:check verifies derived target cinehook_dev on5432 before operations.
- dev:db:migrate wraps Prisma migrate deploy with explicit validated dev URL.
- dev:populated launches existing tsx dev server with explicit dev DATABASE_URL.
Existing npm run dev stays unchanged. Launcher reads local backend/.env only
at runtime, never prints contents; prefer DEV_DATABASE_URL if supplied, otherwise
derive same credential/service URL from DATABASE_URL by replacing database name.
Fail closed on remote/nonPostgres host, wrong port/name, URL query/fragment
overrides or production NODE_ENV. Require development explicitly/default wrapper
is an explicitly named dev command; never default to original DB. Verify SQL
current_database/current_schema/inet_server_port before migrations/seed/start.
Safe error explains absent database/insufficient permissions without credentials.
Do not grant roles or create DB secretly; document local-admin setup separately.
Child process credentials only environment, not command args/output. Preserve
existing dotenv/JWT/Redis/provider config, no secret generation/rotation on rerun.
Use spawn with platform-safe npm invocation, stdio inherit; never string-built
shell containing secret connection. Handle exit/signal cleanup.

Seed core must be importable without side effects; CLI production checks before
client construction. Live integration core accepts an explicit already validated
test-client/expected *_test identity in test harness; public dev CLI accepts ONLY
the development target. Separate test utility, no hidden production test routes.

Tests: dev target guard wrongenv/host/name/port/query, no client before guard;
clock literal2026-10-08 => first2026-10-09T13:00:00Z and seven future days;
manifest48coordinates/3types/exactprices/no duplicates/HTTPSimages; realPG seed
twice, concurrent twice, later append, existing unrelated user/movie preservation,
post-booking/layout untouched, admin hash preserved/USER email collision abort,
incompatible layout/IDs abort+rollback. Root runs live suite later with URL.
Run focusedRED/GREEN and full backend unit/typecheck/build/audit, no live services.
Account/wishlist worker has added multer/sharp; don't revert package additions.
Report docs/superpowers/plans/2026-10-08-task-3-report.md with exact files/commands,
test evidence, security/target guard and any pending actual setup limitations.
