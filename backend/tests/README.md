# Test suite guide

Tests are grouped by domain, not by historical development milestone. Keep useful
regressions beside their domain; do not delete security/race fixtures merely
because multiple layers exercise the same invariant.

## Layers and commands

| Layer | Location / command from `backend/` | Purpose |
| --- | --- | --- |
| Backend unit/HTTP contracts | `npm test` (`*.test.ts`) | Services, validators, adapters, middleware and mocked repository boundaries |
| Compiled process | `npm run build` then `npm run test:smoke` | Real startup, safe errors and bounded shutdown |
| Core PostgreSQL/Redis | `npm run test:integration` | Auth, catalogue, seats, booking, payments, refunds and ownership of records |
| Ownership races | `npm run test:ownership:integration` | Clean-start quarantine, preserved financial history, proof replay and session revocation |
| Auth limiter | `npm run test:rate-limit:integration` | Actual atomic Redis limits, concurrency, expiry, identity separation and outage behavior |
| Pricing/financial races | `node --import tsx --test tests/pricing.integration.mjs` | Frozen totals, FIRST50, provider evidence, late capture and cancellation/refund |
| Migration/restore | `npm run test:ownership:migration` | Explicitly isolated populated migration and restore exercise; not an ordinary unit test |

Frontend tests live in [`frontend/tests`](../../frontend/tests). From `frontend/`:
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
On resource-constrained machines run Vitest with `npm test -- --maxWorkers=2`
and run compiled smoke checks after other test runners have stopped. Do not relax
assertions or production timeouts to compensate for competing local workers.

## Isolation is mandatory

Real integration checks require **explicit disposable targets**, never the normal
local app database or Neon. Use the exact env/role/server identities in
[the CI workflow](../../.github/workflows/ci.yml): core `*_TEST_DATABASE_URL`
databases, `SEAT_LOCK_TEST_REDIS_URL`, ownership-specific targets and the separately
guarded pricing server on loopback port 55438. A database merely named `_test`
does not satisfy every guard; some check actual server port/role/address too.

Suites can skip when target variables are absent. A skipped integration run is
**not PASS**. Tests use run-specific rows/keys and controlled providers; do not
remove safeguards, flush shared Redis, reset production, print credentials or
send real emails/payments to make tests pass. CLI seed/import verification suites
have stricter target guards and are not production catalogue commands.

## Evidence and fixtures

The reviewed release CI at `76c42a74` passed **850 backend unit**, **273 frontend**,
**114 integration** and **3 smoke** checks. The earlier local backend run reported
**862**, a distinct execution/count—not a replacement CI total. See
[versioned evidence and recovery](../../docs/testing-and-recovery.md).

Provider tests exercise actual Razorpay adapter/signatures with controlled HTTP
transport, and verified Google claims at a controlled verifier boundary. They do
not prove personal Google login, Brevo inbox delivery or real settlement. Shared
helpers under `helpers/` and fixture modules intentionally centralize setup;
integration tests independently protect database and Redis invariants.
