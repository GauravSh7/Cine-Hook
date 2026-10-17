# Final isolated PostgreSQL / Redis integration evidence

Verified on 16 October 2026 IST. These are real local PostgreSQL and Redis runs; provider HTTP is the suites' controlled Razorpay transport. They do not claim hosted Razorpay or real-money success.

| Command, from `backend` | Result | Evidence log |
| --- | --- | --- |
| `npm run build` | PASS | Current backend compiled before integration |
| `npm run test:integration` | **73 passed, 0 failed, 0 skipped** | `main-integration-verified.log` |
| `node --import tsx --test tests/pricing.integration.mjs` | **24 passed, 0 failed, 0 skipped** | `pricing-integration.log` |
| `node --test --test-concurrency=1 tests/event-inventory.integration.mjs tests/event-booking.integration.mjs` | **26 passed, 0 failed, 0 skipped** | `event-integration-final.log` |
| `node --import tsx --test tests/staging-enhancement.integration.mjs` | **1 passed, 0 failed, 0 skipped** | `enhancement-integration-verified.log` |

Total: **124 passed, zero failures or skips** in the final successful runs. Node's counts include parent tests; do not add their nested assertions again. A nonfatal existing `pg` deprecation warning about concurrent queries on one client remains visible. Expected outage/request-failure logs are injected negative cases, not unexplained production errors.

## Safe targets and retained resources

Task root and all logs: `C:/Users/gaura/AppData/Local/Temp/cinehook-final-integration-20261016a/`.

- Native PostgreSQL **18.4**, binary directory `C:/Program Files/PostgreSQL/18/bin/`, new task-only cluster `data/`, binds **127.0.0.1:55438** only, role `cinehook_verify`. Local trust authentication is confined to this loopback-bound disposable cluster.
- Existing portable Redis **8.10.2** binary: `C:/Users/gaura/AppData/Local/Temp/cinehook-redis-verification-543d4da2b88947189b18a9df6fc4a775/runtime/Redis-8.10.2-Windows-x64-cygwin/redis-server.exe`.
- New task-only Redis process binds **127.0.0.1:55439**, test database **15**, config `redis.conf`, data directory `redis/`, logfile `redis.log` beneath the task root. Snapshotting/AOF disabled for these disposable tests. No shared Redis flush was run.
- Personal PostgreSQL **5432**, personal Redis **6379**, `cinehook_dev` and Neon received no writes from this integration work. The tests received explicit disposable target settings; the historical staging parity integration script, which deliberately uses `cinehook_dev`, was not run.
- Services are deliberately **left running** for the parent agent's remaining reset/authentication integration checks. No test database was dropped or reset. Early failed-run fixtures may remain in these task-only databases; exact fixture cleanup was repaired for subsequent runs.

All **15 repository migrations** were deployed independently to these newly created databases:

| Database | Environment selectors |
| --- | --- |
| `cinehook_final_core_20261016_test` | `AUTH_TEST_DATABASE_URL`, `GOOGLE_AUTH_TEST_DATABASE_URL`, `BOOKING_TEST_DATABASE_URL`, `PAYMENTS_TEST_DATABASE_URL`, `REFUNDS_TEST_DATABASE_URL`, `PROFILE_TEST_DATABASE_URL` |
| `cinehook_event_seed_pricing_final_20261016_test` | `PRICING_TEST_DATABASE_URL` |
| `cinehook_event_inventory_final_20261016_test` | `EVENT_TEST_DATABASE_URL` |
| `cinehook_final_enhancement_20261016_test` | `ENHANCEMENT_TEST_DATABASE_URL` |

Every selector uses PostgreSQL protocol, the loopback host/port and role above, its named database and no password. `SEAT_LOCK_TEST_REDIS_URL` selects the task Redis port above and `/15`. This report intentionally omits full connection strings. Migration command per named database: `npx prisma migrate deploy`, with `DATABASE_URL` explicitly selecting that disposable database in that process. The environment file was never edited.

To stop resources later, use native `pg_ctl.exe -D C:/Users/gaura/AppData/Local/Temp/cinehook-final-integration-20261016a/data -m fast stop` and the portable `redis-cli.exe -h 127.0.0.1 -p 55439 shutdown nosave`. Verify the exact data directory and ports first. Keep the task files for recovery/inspection; no recursive deletion is needed.

## Initial failures, diagnosis and fixture repairs

The first fully configured main run had **32 pass / 41 fail / 0 skipped**. The first event run had **11 pass / 15 fail / 0 skipped**. These were not hidden or counted as passes. The original logs remain in the task root.

Legacy payment/refund/event fixtures predated mandatory checkout tax policies and the persisted pricing model. They therefore hit `TAX_CONFIGURATION_REQUIRED` before exercising payment transport. A shared disposable test-only tax policy fixture now supplies the required classification and states. The runtime's fixed **700-paise platform fee remains authoritative**: new v1 ticket totals are 25,700 paise for these 25,000-paise fixtures, and every refund assertion follows the frozen captured total. Native historical v0 totals remain 25,000 paise. No production tax policy, payment guard, fee or coupon rule was changed.

Older assertions expected released holds to become `FAILED/HOLD_RELEASED`. The implemented checkout contract now uses `CANCELLED/CHECKOUT_CANCELLED`, and a later capture creates `REFUND_PENDING/BOOKING_CANCELLED` compensation rather than reviving inventory. Assertions were updated to that existing contract; actual expiry/failure cases remain independently asserted. Event same-calendar-day rejection is now checked as `CANCELLATION_CLOSED`. No runtime cancellation rule was weakened.

Fixture cleanup now handles exact run-owned first-offer records, immutable pricing quotes and refund children, using the suites' existing transaction-scoped replication setting only inside validated loopback disposable test databases. Redis and Prisma clients close even when cleanup fails. These paths cannot run against the approved Neon application target. No global delete, table reset or unrelated record cleanup was introduced.

## What the successful runs establish

Main integration covers actual registration/login/password hashing, controlled Google identity binding/races, role revocation and catalog ownership/validation, native show overlaps/layout/pricing constraints, backend-authoritative quotes, owner-only booking access, real Lua lock atomicity/ownership/TTL/ABA protection, rollback and outage compensation, permanent confirmed-seat uniqueness, controlled signed captures/raw webhooks, replay idempotency, capture dominance, failure/release handling, cancellation/refund evidence and seat release, refund retries and scoped profile/wishlist operations.

Pricing integration covers FIRST50 reservation races and shared movie/event eligibility, invalid coupons and forged amounts, immutable final payment totals, tax configuration rejection, explicit simulation guards, fee waiver timing, exact captured refunds, cancelled/expired/failed payment state and late capture compensation. Event integration covers real venue capacities, identity/section/session constraints, event-seat races, quote snapshots, authorization, captured fulfillment, cancellation/rebooking, late capture compensation, signatures/replays and atomic rollback.

The new enhancement test uses a **fresh exact-target-checked empty database**, actual READ COMMITTED write options and the real advisory lock/import helpers/SQL constraints. It inserts an isolated synthetic baseline within one transaction, prepares and validates exactly **12 movies / 12 shows / 36 prices**, applies the create-only patch, checks exact metadata and unchanged baseline, verifies repeat inspection adds **zero**, then unconditionally rolls back. Post-rollback movie/show/seat/user counts are zero. It never loads `.env.staging`, connects to Neon, fetches provider data or executes the real enhancement apply CLI.

Hosted provider login, real hosted checkout, legal invoicing, external email delivery and actual refunds remain separate evidence requirements; controlled local transport must not be described as those operations.
