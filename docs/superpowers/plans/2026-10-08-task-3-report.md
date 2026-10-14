# Task 3 — Development seed and launcher implementation

Implemented the approved isolated local development inventory tooling. It adds
only missing rows and never writes the original `cinehook` database. The seed is
an explicit command, outside runtime source and migration/build/startup hooks.

## Files

- `backend/prisma/dev-seed-manifest.ts`: six real film metadata records, exact
  verified HTTPS Wikimedia poster links and Wikipedia source links; three real
  cities with explicitly demo theatres; six 48-seat layouts; three seat prices;
  deterministic namespaced UUIDs; future seven-day 18:30 IST schedule; password
  validation and dedicated admin identity.
- `backend/prisma/dev-seed-core.ts`: importable seed, whole-seed READ COMMITTED
  transaction and advisory lock, actual SQL identity validation, missing-only
  creates, compound venue identity reuse, film natural-key reuse, existing layout
  validation and show conflict checks. Existing film metadata, layouts, users,
  passwords, booked/past/cancelled shows and prices are preserved. New shows use
  the actual stored movie duration. Every new show and all three prices are atomic.
- `backend/prisma/dev-seed.ts`: guarded CLI and first-admin password intake.
- `backend/scripts/dev-target.ts`: pure local URL boundary, SQL identity check
  and injectable command orchestration.
- `backend/scripts/dev-launch.ts`: local `.env` loading at runtime only, guarded
  checks and child invocation via Node directly (portable on Windows, no shell).
- `backend/scripts/dev-password.ts`: hidden terminal password and confirmation.
- `backend/tests/dev-seed.test.ts`, `dev-seed-core.test.ts`: 27 focused tests.
- `backend/tests/dev-seed.integration.ts`: two explicit isolated PostgreSQL cases.
- `backend/tsconfig.seed.json`, `backend/package.json`: seed/script/test type
  coverage and five explicit command additions; existing `npm run dev` unchanged.

## Commands and boundaries

Run from `C:/Users/gaura/OneDrive/Desktop/Cine-Hook/backend`:

1. `npm run dev:db:check`
2. `npm run dev:db:migrate`
3. `npm run db:seed:dev`
4. `npm run dev:populated`

The wrapper prefers local `DEV_DATABASE_URL`, otherwise derives the same
credentials and local service from `DATABASE_URL`, changing only the database
name to `cinehook_dev`. An explicit `DEV_DATABASE_URL` must already name
`cinehook_dev`. Every public command rejects production/test `NODE_ENV`, remote
hosts, non-PostgreSQL URLs, non-5432 ports, query and fragment overrides. It checks
SQL `current_database()`, `current_schema()` and `inet_server_port()` before the
operation. No connection URL or password is placed in child arguments or printed.
The regular dotenv/JWT/Redis/provider settings are retained.

The seed requires a first admin password via the hidden prompt or locally set
`DEV_ADMIN_PASSWORD`. Require at least 12 characters with uppercase/lowercase,
number and symbol, at most 72 UTF-8 bytes, and no NUL; bcrypt cost 12. The admin
email is `admin@cinehook.local`. Existing admin hashes/names are never reset, and
an existing USER or mismatched email/ID aborts rather than promoting an account.

## Verification evidence

TDD RED: focused manifest/guard and core suite failed on missing modules; launcher
subprocess test failed because the guarded executable was absent. GREEN:
`npm test -- tests/dev-seed.test.ts tests/dev-seed-core.test.ts` passed 27 tests.

Fresh full backend checks on 2026-10-08:

- `npm test`: **27 files, 521 tests passed**.
- `npm run typecheck`: application plus separate seed/scripts/integration-test
  coverage passed.
- `npm run build`: passed.
- `npm audit --audit-level=high`: **0 vulnerabilities**.
- Prisma and tsx child executable paths resolved successfully on Windows.

The isolated live suite is ready for root execution:
`npm run test:seed:integration`. Set `SEED_TEST_DATABASE_URL` to a fresh migrated
loopback PostgreSQL database with an explicit name ending `_test`; optionally set
`SEED_LAYOUT_TEST_DATABASE_URL` to a separate fresh migrated loopback `_test`
database for incompatible-layout rollback coverage. Without a supplied URL its
case is skipped. The suite does not truncate/delete/reset any records and leaves
its fixtures for inspection. It checks initial counts, unchanged reruns,
concurrent missing-show append, unrelated user/movie preservation, reused movie
duration/metadata, booking/layout/admin-hash preservation, USER collision and
reserved-ID/layout collision rollback. Actual live execution is root-owned;
this implementation report does not claim an unrun live result.

## Remaining local setup

At handoff, root's verified existing PostgreSQL service is localhost:5432, but
`cinehook_dev` is absent and the existing app role lacks CREATEDB. Commands fail
closed with a setup message. No role grants, database creation, migration, seed
or service start was performed by this worker. A local administrator must create
the separate development database owned by the existing application role, using
the actual locally verified role name, before the commands above can proceed.
No `.env` content was read/edited by this worker, no schema/module/financial
changes, no Git mutations, and no child agents were created.

Film source/attribution links are retained beside each image in the manifest.
Images remain remote and were not downloaded or mirrored; availability can vary.
