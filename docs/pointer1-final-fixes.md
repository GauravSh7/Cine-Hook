# Pointer 1 — final local fixes (2026-10-21)

Base: GitHub main `4b9afa0`; branch `fix/pointer1-final-audit`. Local only: no hosted writes, deployment, settings changes or push.

## FIRST50

Reproduced FIRST_OFFER_UNAVAILABLE in real PostgreSQL/Redis: cancelled discounted checkout with a local payment reservation but no attached provider order blocked an unrelated full-price payment. A missing provider acknowledgement is uncertain, not proof that no order/capture can exist.

- Scope reservation validation in PricingRepository.freeze to FIRST50, not full-price/SAVE10/legacy orders.
- New migration `20261021000000_full_price_offer_scope` replaces only guard_payment_offer(); no tables, rows, financial values or unique constraints are removed/rewritten. The trigger still serializes on booking/user and rejects invalid FIRST50 redemption, consumption and competing issued payments.
- Uncertain discounted reservations remain protected. Capture permanently consumes eligibility; failed-attempt/late-capture reconciliation and refunds remain unchanged. Full-price payment retries reuse one persisted payment.
- Real regression covers no-payment cancellation, local-reservation cancellation, full-price retries/competing requests, failed attempts, concurrent FIRST50 reservation, capture replay, refunds and late captures with no seat revival. Two original failure cases were observed red before the fix.

## Frontend lint

CityProvider memoizes the empty/loaded city list. HomePage derives resolved location/loading state and keys the offers-delay completion to the fetched data, removing synchronous effect-driven resets and unstable dependencies. No lint rules disabled or UI redesign. Added saved-city and denied-geolocation regressions.

## Verification

- Backend relevant unit regression: **347 passed / 25 files**.
- Frontend consolidated regression: **273 passed / 31 files**.
- Real PostgreSQL/Redis pricing/coupon/payment/event integration: **25 passed, zero skipped**.
- Ownership/quarantine/history/JWT races, OTP expiry/replay/limits, booking/seat locks and actual Razorpay adapter with controlled provider transport, webhooks/refunds integration: **72 passed, zero skipped**.
- Populated isolated database upgrade from 16 to 17 migrations: **33 tables / 1,179 rows byte-for-byte fingerprints preserved** (migration ledger intentionally excluded). Fresh-schema migration also passed.
- Frontend lint: **0 errors, 0 warnings**; frontend/backend typechecks/builds and Prisma validation passed. No schema model changes, so client regeneration was unnecessary.
- External personal Google login, actual Brevo inbox delivery and hosted Razorpay checkout were not repeated; automated provider transports/verifiers and local database flows are distinguished from live acceptance.
- Existing pg client concurrent-query deprecation warnings were emitted by integration fixtures; no failed tests. All test PostgreSQL/Redis endpoints were loopback-only. Retain fixture DBs; do not reset normal local/hosted data.

## Safe eventual release (requires separate explicit approval)

1. Verify current remote main and release gates, approve/push this exact reviewed revision; do not overwrite unrelated work.
2. Activate existing maintenance guard, verify both public API entry points are closed and old instances drained; take/verify fresh production backup and database identity.
3. Confirm the only pending migration is `20261021000000_full_price_offer_scope`, then deploy it. Compare historical user/booking/payment/refund records; stop on drift. Never reset, seed, or alter historical quotes.
4. Manually deploy matching backend/frontend with maintenance still enabled and automatic deployments still gated. Preserve TEST-only payment, OTP and financial settings.
5. After approval reopen for controlled acceptance: cancelled FIRST50 -> full-price retry; valid FIRST50 exclusion; login/OTP/Google; one TEST checkout/webhook/cancellation/refund. Reclose on failure; forward-fix rather than changing financial evidence.

Pre-existing uncommitted `auth-ownership-deployment-checklist.md` checkpoint notes are intentionally excluded from this fix commit.
