# Isolated development data and local launch

Current refinement status, 2026-10-10: `cinehook_dev` exists on port 5432 with all
ten additive migrations, 30 movies with English/Hindi summaries and 24 fictional
DEMO listings (six each: Stream, Events, Sports, Activities). The previously
populated domain inventory below is retained. `dev:content:seed` verifies actual
database/schema/port, uses stable IDs/unique slugs and the same advisory lock as
the base seed, fills only empty summaries on exact matching movies, and preserves
edited records. Its final rerun added zero listings and zero summaries. No
existing user, booking, financial record or physical layout was replaced.
The original `cinehook` database is not a seed target. These tools never run
automatically in production.

Preceding redesign inventory, 2026-10-10: `cinehook_dev` had all eight
migrations, 30 movies, 3 cities, 3 demo theatres, 6 screens, 288 seats, 102 retained
shows and 306 seat-type prices; 96 shows are future at this checkpoint. Every movie
has future availability somewhere in the supported cities. Readiness and proxied
movie discovery return 200/success. Today's seed appended 12 shows/36 prices,
keeping old records; the immediate rerun added zero rows. The historical
database-absence record below is retained only as dated context.
For ordinary restarts use `dev:populated` and the frontend command in separate
terminals; keep both processes running. Do not recreate an existing database.

Checkpoint: 2026-10-08. Implementation and isolated live verification pass.
The intended persistent `cinehook_dev` database is **not yet created**: the
existing application role cannot create databases. Do not confuse the verified
temporary test inventory with a populated persistent development environment.

## One-time local administrator setup

The existing PostgreSQL service is verified on port **5432**. In pgAdmin, connect
to that service using your own local administrator credentials, then create a
database named `cinehook_dev`. Set its owner to the application role already
used by the ignored `backend/.env` connection. Do not rename, reset, delete or
migrate the original `cinehook` database. No port5434 instance is assumed.

Use pgAdmin's database creation dialog, not an application-level role grant.
No administrator password or connection URL needs to be shared in chat.
The application role must own the new database so migrations can create its
tables and extensions. All public development commands verify the actual SQL
database/schema/server port before running their operation.

## Exact PowerShell launch commands

Ensure PostgreSQL5432 and the Redis service specified in the ignored backend
configuration are running. Keep `NODE_ENV=development`. The existing JWT and
Redis settings are reused; `DATABASE_URL` can continue naming `cinehook`.
The guarded commands derive a separate URL by changing only its database name
to `cinehook_dev`, without editing `.env` or printing its credentials.
The existing configured Redis6379 answered PONG in the final read-only check.
Do not launch the Compose PostgreSQL service over the existing5432 service.

Backend terminal, after the administrator creates the separate database:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
npm ci
npm run dev:db:check
npm run dev:db:migrate
npm run db:generate
npm run db:seed:dev
npm run dev:content:seed
npm run dev:populated
```

Stop if any setup command fails; do not substitute `db:migrate`, reset, or the
original database as a workaround. `dev:db:migrate` deploys the ten existing
migrations non-destructively into the verified separate database. Running it
again does not reapply completed migrations.

Frontend terminal:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\frontend"
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. The frontend proxies `/api` to Express4000;
configuration must keep `FRONTEND_ORIGIN=http://localhost:5173` and `PORT=4000`.
Choose a city from the header, open a movie and select an upcoming show.

The first seed prompts for a hidden, confirmed development administrator
password. Email: `admin@cinehook.local`. Password requirements: at least12
characters, uppercase/lowercase/number/symbol, at most72 UTF-8 bytes; bcrypt12.
No shared hardcoded administrator password is shipped. An optional local
`DEV_ADMIN_PASSWORD` supports noninteractive intake; never log it or commit it.
Reruns preserve the existing administrator password/name and never promote an
existing ordinary user. Register a normal user through the app to test booking.

## Inventory and rerun behavior

- Thirty curated film records with title, language, genres, duration, release
  date, collection tags, metadata provenance and original local illustrative
  poster/backdrop assets. They are fixtures for education, not live listings.
- New Delhi, Mumbai and Bengaluru, with explicitly named **demo** theatres.
  These venues/schedules are educational data, not claimed live cinema listings.
- Two screens per city,48 physical seats per screen: rowsA–D REGULAR,
  rowE PREMIUM and rowF RECLINER; eight seats in each row,288 seats total.
- Future timezone-aware screenings normalized to UTC: 102 retained shows in the
  current inventory (96 future) and 306 per-seat-type prices. The rolling seed
  keeps historical shows and appends missing absolute dates without duplication.
- Trusted prices in paise: REGULAR25000, PREMIUM40000, RECLINER65000.
  Show end times use the actual stored movie duration.

Deterministic IDs and natural-key checks prevent duplicate inventory. A short
list of seed operations runs in one bounded transaction, serialized with a
transaction-scoped advisory lock. Writes add missing rows only. Existing
users, film metadata, prices, bookings and scheduled/past/cancelled shows remain
unchanged. Another day adds only the missing future dates. Existing layout is
verified rather than upserted once a show depends on it. Identity, layout,
admin or show-slot conflicts abort/roll back additions; they never overwrite
user records or reschedule a conflicting show.

The seed is not imported by the server, run by migrations/builds, or run at
startup. Public commands reject non-development environments, remote targets,
non-5432 ports, query/fragment overrides and a mismatched actual database identity.
An explicit `DEV_DATABASE_URL`, if supplied, must already name `cinehook_dev`.
Regular `npm run dev` is unchanged and does **not** select the populated database;
use `dev:populated` for that purpose.

## Provider setup and truthful limitations

Profile images require all three backend-only settings:
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
Payment/refund provider delivery requires `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the existing webhook setup.
Both groups are absent locally at this checkpoint. Discovery, authentication,
profile fields, wishlist, physical seats and unpaid holds work without them;
upload/payment endpoints safely report unavailable. No local payment success,
real charge/refund or real Cloudinary delivery is claimed.

Stream, Events, Sports and Activities have approved visual shells but no live
business backend. Offers has payment-category filters but no invented
promotions or stored card/bank data. Help & Support is only a future chatbot
placeholder. Saved addresses/cards, notification/preferences/security settings,
social login, password reset, coupons and streaming are not simulated.

## New files and commands

- `backend/prisma/dev-seed-manifest.ts`: films/attribution, venue/layout/prices,
  future IST schedule, deterministic IDs and admin password rules.
- `backend/prisma/dev-seed-core.ts`: importable missing-only transactional seed.
- `backend/prisma/dev-seed.ts`: guarded CLI and administrator intake.
- `backend/scripts/dev-target.ts`, `dev-launch.ts`, `dev-password.ts`:
  explicit local identity checks, portable child commands and hidden prompt.
- `backend/tests/dev-seed.test.ts`, `dev-seed-core.test.ts`,
  `dev-seed.integration.ts`: guard/preservation/concurrency/rollback coverage.
- `backend/tsconfig.seed.json`, `backend/package.json`: type coverage and
  `dev:db:check`, `dev:db:migrate`, `db:seed:dev`, `dev:populated`,
  `test:seed:integration` commands.
- `backend/.env.example`: optional Cloudinary names only; no real secret edited.

## Verification evidence

Root-owned isolated PostgreSQL18 on loopback55438 and Redis8 on55439/DB15
were used, not the original database. All seven migrations deployed into fresh
test databases. The native seed suite passed **2/2 with0skips**, including
concurrent day-append, booking/layout/admin preservation and full conflict
rollback. Two malformed test fixtures were corrected to match existing SQL/
Prisma contracts; no seed or domain rule was weakened.

Current-date seed into `cinehook_ui_seed_test` created1ADMIN,6movies,3cities,
3theatres,6screens,288seats,42futureShows and126prices. A second run created
**zero rows**. Actual Express/Vite browser tests used that isolated inventory.
It is retained in the task's temporary cluster for inspection, not claimed as
the approved persistent development database.

Fresh final checks: backend521 unit tests,72 live PostgreSQL/Redis integration
results with0skips,2 compiled-server smoke tests; frontend86 tests, lint,
typechecks/builds, Prisma validate/generate and both audits pass (0vulnerabilities).
The initial unconfigured integration invocation skipped cases; the subsequent
properly configured72-result run is the live evidence. Real provider transports
in integration tests are controlled; they are not real money/image delivery.

Final read-only original `cinehook` check: port5432/public, six migrations,
17 domain tables with0rows, unchanged from preflight. `cinehook_dev` remains
absent, and `dev:db:check` fails closed before any migration/seed. No reset,
data deletion, secret disclosure, commit or push occurred.

Cleanup: task-owned Express4000, Vite5173, Redis55439 and PostgreSQL55438
were stopped after verification. Existing PostgreSQL5432/Redis6379 remain
running. Browser tabs were closed and the temporary viewport override reset.
Test cluster files are preserved, not deleted, at
`C:/Users/gaura/AppData/Local/Temp/cinehook-profile-verification-e8eb347fb0034f46838ab58ea189ef4e/data`.
No migrations or seed were run against the original or absent persistent dev DB.
