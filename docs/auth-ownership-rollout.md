# Authentication ownership security — local handoff

Implementation date: 2026-10-19; final local review: 2026-10-20. Workspace: `C:/Users/gaura/Documents/Codex/cinehook-auth-security`, branch `security/email-ownership`, base `34dfe2e` (the design commit above audit `0f44e80`). The reviewed implementation is prepared for its authorized local feature-branch commit; identify that revision with `git log -1`. No push, merge, hosted migration or deployment is authorized. Original checkout, Neon, hosted users, Vercel and Render were not changed.

## Root cause and boundaries

Password registration previously activated accounts without proving mailbox ownership. Authoritative Google email matching could then bind that record while retaining its original password and sessions. The fix removes email-only binding, requires OTP before password registration, and validates durable authentication versions on protected requests.

- Password + fresh mailbox OTP can preserve an existing unverified account's ID/history, while replacing its unverified password and revoking prior sessions.
- Mailbox-only clean start requires explicit confirmation. It disables the ambiguous old account, removes its password, increments its version and gives it an opaque `.invalid` login address. A separate verified USER gets the real email. No old profile, role, wishlist, booking or financial records transfer.
- Quarantine provenance has restrictive FKs to both IDs; financial/business ownership is unchanged. No general support/admin history-restoration feature was added.
- Known Google subjects preserve identity continuity. Google-only users are not forced to create passwords. Legacy hybrid users explicitly confirm fresh Google proof before the unverified password is removed and the auth version increments.
- Third-party Google-only legacy subjects may authenticate without falsely marking mailbox ownership verified. The internal `providerOnly` snapshot permits that versioned session; mailbox-only password initialization/reset still requires mailbox verification. New non-authoritative Google email identities must first verify the mailbox via registration, then explicitly link.
- Explicit Google linking requires an authenticated verified account, fresh current password and fresh Google evidence. Linking increments the version. No email-based merge method remains.
- OTPs expire after 10 minutes, permit five guesses, and produce single-use grants lasting at most five minutes/remaining challenge lifetime. Purpose, email and security snapshot are bound server-side. Resends invalidate prior codes of that purpose. Shared Redis limits are five requests/mailbox/hour across purposes and 100/network/hour for the new ownership endpoints. Provider failures invalidate the code and return no account details.
- Missing legacy JWT versions fail. DB version/disabled-state validation survives Redis revocation-key expiry. Production server wiring always supplies the durable lookup. No process-level auth cache was introduced.

Google's stable-subject and non-authoritative third-party-email distinction is documented in its [backend authentication guidance](https://developers.google.com/identity/sign-in/web/backend-auth). It is not permission to auto-link matching email strings.

## API changes

All routes below are under `/api/auth`, return no-store responses, validate input and reject a supplied foreign Origin. Existing Google challenge/nonce/CSRF and signature checks remain.

| Route | Contract |
| --- | --- |
| `POST /ownership/request` | `{purpose,email}`; REGISTER, VERIFY_LEGACY, CLEAN_START or RESET_PASSWORD; generic challenge response |
| `POST /ownership/verify` | `{challengeId,otp}` → restricted single-use token, never a session |
| `POST /register` | Existing name/email/password plus `registrationToken`; activates only after REGISTER proof |
| `POST /ownership/complete` | Bound purpose/token/new password; current password for VERIFY_LEGACY; new name and explicit `cleanStartConfirmed:true` for CLEAN_START |
| Existing forgot/verify-reset/reset endpoints | Production delegates to the same purpose-bound ownership service; RESET_PASSWORD preserves only previously verified accounts |
| Existing Google sign-in | Optional explicit `confirmOwnership:true` with fresh Google challenge for legacy hybrid security confirmation |
| Existing login and protected routes | Unverified password login cannot issue a session; protected requests validate current version/ownership state |

Ordinary frontend registration is email → OTP → credentials. Recovery offers normal verified reset, proven legacy continuity and an explicit clean start. Restricted proofs are never stored as access tokens. Linking stays a separate authenticated action, not a fallback hidden inside login.

## Additive migration and isolated recovery evidence

Migration: `backend/prisma/migrations/20261019000000_email_ownership_auth/migration.sql`.

Adds `email_verified_at`, `auth_disabled_at`, nonnegative `auth_version` default 0, and `account_quarantines`. It does not verify, quarantine, rewrite or delete existing users. Existing email uniqueness is retained: runtime recovery transactionally moves only the disabled old login address and creates the new unique owner email.

Isolated PostgreSQL 18 used loopback port 55448; Redis used loopback 55449 database 15. Tests reject other targets. Neither normal local ports nor hosted databases were used. Earlier isolated fixtures were retained under different test database names, not deleted/reset.

The upgrade test applied the 15 existing migrations, populated legacy identity plus booking/seat/payment/capture/refund/reconciliation/webhook records, made a pre-migration custom-format dump, applied the additive migration, and compared a SHA-256 fingerprint of every pre-existing public-table row (excluding only new auth columns). It matched. The dump was restored to a different newly created isolated database and that fingerprint also matched. Negative versions and invalid quarantine FKs are rejected; credential transaction rollback and real injected provenance failure were exercised.

Recoverable fixture backup: `C:/Users/gaura/AppData/Local/Temp/cinehook-auth-recovery-yo1Xh9/premigration.dump`. This is isolated test data, **not** a hosted backup or an assurance of hosted recovery capability.

## Verification

- Backend complete unit/HTTP suite: **839 passed / 65 files**.
- Ownership PostgreSQL/Redis integration suite: **8 passed, 0 skipped**. Includes exact pre-registration fixture → Google collision → OTP clean start, no inherited booking/profile/role, proven-owner history continuity, concurrent registration/grant consumption, competing recovery/link writes, in-flight password login versus reset/link, expired/replayed/resend proofs, rate limits and outages.
- Migration + populated checkpoint restore: **1 passed, 0 skipped** on 2026-10-19. Schema/migration unchanged in the final 2026-10-20 pass; this result was not re-labelled as a new migration run.
- Runtime quarantine separately compared booking, seat-price, payment, capture, refund, reconciliation and webhook records byte-for-byte: unchanged.
- Stale-login mutation check: deliberately removing version comparison made the regression fail; restoring comparison made it pass. No mutation remains.
- Prisma validation/generation, backend TypeScript checks and production build passed. Backend has no lint script.
- Frontend complete suite with two workers: **271 passed / 31 files** (`npm test -- --maxWorkers=2`) in the final 2026-10-20 pass; TypeScript checks and production build passed. An earlier unconstrained parallel run during simultaneous backend verification timed out two auth tests and one event discovery wait; that failed run is reported, not counted as a pass. The bounded-worker rerun passed without changing application code or test timeouts.
- Whole-frontend lint reports pre-existing `HomePage.tsx` errors at 59/102 and warnings in HomePage/CityProvider; unrelated source was not changed. ESLint passed for all changed frontend source and test files.
- Protected `/me` used **one** durable indexed user-snapshot read; the current-role guard also used one read and rejected a stale ADMIN claim. Representative loopback `/me` request duration in the final pass was **18.36 ms**, not a hosted benchmark or isolated DB-query latency.
- Brevo transport and Google verifier responses were substituted in tests. No personal sign-in or real email delivery was claimed, and no real/test payment was attempted.

Reproduce unit/build checks with existing npm scripts. `npm run test:ownership:integration` requires privately set `OWNERSHIP_REPOSITORY_TEST_DATABASE_URL` and `OWNERSHIP_PROOF_TEST_REDIS_URL` matching the guarded isolated targets. `npm run test:ownership:migration` additionally requires a fresh empty `cinehook_ownership_migration_test` on that isolated port plus PostgreSQL tools (`OWNERSHIP_PG_BIN` if not on PATH). Do not point these commands at Neon or application databases. Missing variables skip native integration tests; skipped runs are not evidence of success.

## Exact hosted rollout — requires separate approval; NOT executed

1. Review the local diff and approve its exact revision plus hosted migration/cutover. No push, merge or deployment has happened. Keep live-payment restrictions and all business settings unchanged.
2. Verify the intended hosted database/role/host privately; record and compare identity, migration status and existing counts. Stop on mismatch. Confirm Brevo sender/API configuration and Google authorized frontend origin without printing credentials. No new secret variables are required by this fix.
3. Arrange a short coordinated maintenance window using hosting controls. Stop old vulnerable backend workers/public auth ingress; do not leave them issuing sessions during migration/cutover. No new maintenance feature flag is assumed. Existing signed webhook replay safety remains unchanged; account for webhook retries during downtime.
4. Before writes, create a recoverable Neon branch/PITR checkpoint where supported, otherwise a securely stored PostgreSQL dump. Validate recovery capability and access control. This local fixture backup is not a substitute. Abort if no recoverable checkpoint exists.
5. Against only that verified target, use `npm ci`, `npm run db:generate`, then **`npm run db:deploy`** from `backend` to apply the additive migration. Do not run migrate reset, development seeds, quarantine backfills, auth-version backfills or table resets. Verify old rows/relationships and new security defaults; stop on any unexpected difference.
6. Release the approved backend with `npm run build` / existing Render start command, and the matching frontend build on Vercel in the same maintenance window. The old frontend cannot perform the new registration proof flow, so do not deliberately leave a mixed-version public rollout. Ensure all old workers are gone before reopening.
7. Reopen after controlled checks: health/readiness; legacy JWT rejected; new registration email OTP; known Google-only login; legacy password + OTP recovery; current `/me` and role checks; logout/session revocation. Interactive Google and real Brevo delivery need controlled accounts/user participation. Never experiment with customer accounts or financial data.
8. Communicate one-time reauthentication and legacy recovery options. Monitor only safe error/event codes and dependency health; never tokens, OTPs, passwords, quarantine addresses or provider credentials. Keep historical bookings/payments unchanged.
9. If problems occur, keep auth restricted and forward-fix while retaining additive schema and auth-version invalidation. **Do not roll back to the vulnerable old backend**, drop security columns or accept legacy tokens. Whole-database restoration after new writes needs separate incident approval and reconciliation; it must not overwrite new financial records casually.

## Remaining limitations / review

- Legacy unverified history cannot be proven from mailbox access alone. A user who forgot the old password and has no bound provider identity gets a clean account; old history requires separate ownership review, which is not automated here.
- Existing known-subject account continuity follows the approved policy. Historical per-row authorship before this fix cannot be reconstructed from absent verification provenance.
- New Google identities using third-party email are routed through mailbox verification before linking; existing provider-only subjects can still sign in without a password. No false mailbox-verification backfill occurs.
- Revocation does not undo an already-authorized in-flight business request. Subsequent protected requests reject the old version; no booking/payment transaction changes were made.
- Initial independent review's evidence gaps (orchestrated stale login races, restore/rollout evidence and combined attack coverage) were addressed locally. A fresh independent review of the full tracked/untracked implementation on 2026-10-20 found no concrete Critical/Important takeover bypass. It identified recovery-field persistence and stale documentation, both fixed; the reviewer read the final code deltas and judged them suitable for local commit, not deployment. The reviewer did not execute tests or verify hosted services.
- Resolved 2026-10-20: registration email is read-only through request/OTP/credentials. Change email aborts the attempt and clears challenge, grant, OTP and credential fields before requesting a new code. Backend HTTP regression rejects a verified A grant submitted for B, creates neither account on mismatch and rejects reuse of the burned grant.
- Resolved independent-review finding: recovery Start again and mode changes clear prior current/new passwords, name, proof and clean-account consent so these cannot carry across email targets. Both old persistence cases were reproduced by failing tests before the fix.
- Hosted ingress/client-IP identity remains a deployment blocker: the OTP network quota uses `req.ip`; a shared reverse proxy could collapse unrelated clients into one quota. Verify actual ingress before rollout and configure only a precisely trusted proxy chain if needed, never unrestricted forwarding trust. No hosted/proxy settings were changed locally.
- Real delivery, personal Google interaction, hosted performance and deployment/cutover remain unverified until separately approved.

Concise approval-gated release sequence: [Authentication deployment checklist](auth-ownership-deployment-checklist.md).

## Changed-file manifest

62 files (new or modified relative to the worktree base; the additional file is the concise deployment checklist; generated ignored output and private settings excluded):

- `backend/package.json`
- `backend/prisma/migrations/20261019000000_email_ownership_auth/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/require-current-user.ts`
- `backend/src/middleware/require-role.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/auth.routes.ts`
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/auth.types.ts`
- `backend/src/modules/auth/auth.validation.ts`
- `backend/src/modules/auth/google/google.controller.ts`
- `backend/src/modules/auth/google/google.repository.ts`
- `backend/src/modules/auth/google/google.routes.ts`
- `backend/src/modules/auth/google/google.service.ts`
- `backend/src/modules/auth/google/google.types.ts`
- `backend/src/modules/auth/ownership-proof.store.ts`
- `backend/src/modules/auth/ownership.controller.ts`
- `backend/src/modules/auth/ownership.repository.ts`
- `backend/src/modules/auth/ownership.routes.ts`
- `backend/src/modules/auth/ownership.service.ts`
- `backend/src/modules/auth/password-reset.mailer.ts`
- `backend/src/modules/auth/password-reset.repository.ts`
- `backend/src/modules/auth/password-reset.service.ts`
- `backend/src/modules/auth/password-reset.types.ts`
- `backend/src/modules/auth/token.service.ts`
- `backend/src/modules/auth/user.repository.ts`
- `backend/src/server.ts`
- `backend/tests/auth-ownership-migration.integration.mjs`
- `backend/tests/auth-version.test.ts`
- `backend/tests/auth.test.ts`
- `backend/tests/google-auth.test.ts`
- `backend/tests/google-password-recovery.test.ts`
- `backend/tests/google-repository.test.ts`
- `backend/tests/helpers/ownership-history.mjs`
- `backend/tests/ownership-concurrency.integration.mjs`
- `backend/tests/ownership-financial-history.integration.mjs`
- `backend/tests/ownership-flow.integration.mjs`
- `backend/tests/ownership-http.integration.mjs`
- `backend/tests/ownership-login-races.integration.mjs`
- `backend/tests/ownership-proof.integration.mjs`
- `backend/tests/ownership-repository.integration.mjs`
- `backend/tests/ownership-repository.test.ts`
- `backend/tests/password-reset-http.test.ts`
- `backend/tests/password-reset-otp.test.ts`
- `backend/tests/password-reset.test.ts`
- `docs/auth-ownership-rollout.md`
- `docs/auth-ownership-deployment-checklist.md`
- `docs/superpowers/plans/2026-10-19-email-ownership-auth-progress.md`
- `docs/superpowers/plans/2026-10-19-email-ownership-auth.md`
- `docs/superpowers/specs/2026-10-19-email-ownership-auth-design.md`
- `frontend/src/api/auth.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/google.ts`
- `frontend/src/api/types.ts`
- `frontend/src/components/GoogleSignIn.tsx`
- `frontend/src/pages/AuthPage.tsx`
- `frontend/src/pages/PasswordRecoveryPage.tsx`
- `frontend/tests/auth-ui.test.tsx`
- `frontend/tests/google-auth.test.tsx`
- `frontend/tests/password-recovery.test.tsx`
