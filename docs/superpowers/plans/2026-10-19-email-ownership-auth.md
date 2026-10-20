# Email ownership and safe account recovery Implementation Plan

Execution status: approved and implemented locally on 2026-10-19. The original planning checkboxes below are retained as the approved checklist; actual completion evidence and rulings are recorded in `2026-10-19-email-ownership-auth-progress.md` and `docs/auth-ownership-rollout.md`. Hosted rollout remains approval-gated.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close pre-account takeover without giving a mailbox claimant someone else's historical private data.

**Architecture:** Preserve Route → Middleware → Controller → Service → Repository → Prisma. Purpose-bound shared Redis proofs authorize short PostgreSQL compare-and-swap transactions. Durable user auth versions revoke sessions. No business-domain ownership changes.

**Tech Stack:** Existing Express/TypeScript, Prisma/PostgreSQL, Redis, bcrypt, JWT, Brevo HTTPS and Google verifier; existing React frontend.

**Spec:** `docs/superpowers/specs/2026-10-19-email-ownership-auth-design.md` (revised privacy policy).

## Global Constraints

- Planning only until reviewed. No hosted connections, migration, account mutation, push or deployment.
- Preserve dirty work and read repository instructions before execution. No booking/payment/refund changes.
- Never log secrets, OTPs, grants, tokens or private quarantine evidence.
- Fresh loopback-only disposable PostgreSQL/Redis, explicitly verified test database identity; never reuse app data on ports 5432/6379.
- No real emails or personal Google interactions in automated tests. Distinguish mocked provider evidence from delivery verification.
- No automatic merging or history transfer. Legacy forgotten-password history cannot safely be recovered from email alone.

## Review Focus

1. Private-data inheritance: attack fixture asserts clean ID, USER role, empty profile/history and unchanged old foreign keys (tasks 2, 5).
2. Proof confusion/replay/abuse: purpose/email/subject/version binding, TTL, attempts and Redis atomic consumption (task 3).
3. Stale credentials/sessions: mandatory version, disabled-account rejection and stale issuance races (tasks 2, 4, 5).
4. Concurrent ownership changes: row locks/CAS, unique constraints and transaction rollback prevent conflicting recover/link winners (tasks 2, 5).
5. Migration/cutover failure: no automatic data backfill, isolated restore evidence and no vulnerable rollback (tasks 1, 7).

## Task 1 — Additive schema and isolated migration evidence

Files: `backend/prisma/schema.prisma`; new timestamped `backend/prisma/migrations/*_email_ownership_auth/migration.sql`; new `backend/tests/auth-ownership-migration.integration.mjs`.

- [ ] Write migration assertions against a populated pre-change fixture: user IDs, roles, password hashes, subjects and linked history unchanged immediately after migration.
- [ ] Add nullable `emailVerifiedAt`, nullable `authDisabledAt`, nonnegative `authVersion` default 0, plus `AccountQuarantine` with unique old/replacement user FKs, original email, reason and timestamp. No cascade deletion of financial/history rows.
- [ ] Apply only to fresh verified isolated databases. Verify fresh installation and upgrade paths; Prisma validate/generate.
- [ ] Dump populated pre-migration fixture, restore into a separate disposable database and verify counts/relationships. Record exact guarded commands/results; never reset an existing database.

## Task 2 — Repository ownership transitions

Files: `backend/src/modules/auth/{auth.types.ts,user.repository.ts}`; `backend/src/modules/auth/google/google.repository.ts`; `backend/src/modules/auth/password-reset.repository.ts`; new `backend/src/modules/auth/ownership.repository.ts` and focused tests.

Interfaces: `getAuthSnapshot(userId)` returns public projection plus internal version/verification/disabled state; `claimExistingAccount(expectedState, proof)` preserves ID; `createCleanAccount(expectedState, verifiedEmail, credentials)` returns only new account; `linkGoogle(expectedState, verifiedSubject)` is explicit. No repository method accepts a client role.

- [ ] Red tests: email equality alone never links; clean start never inherits old name/DOB/avatar/role/wishlist/bookings; old password disabled, version increments and historical ownership unchanged.
- [ ] Implement short transactions using row locks and expected hash/version/verification/subject checks. Quarantine only unverified password accounts with no bound subject. Use opaque `.invalid` internal email; preserve original address solely in restricted provenance. New account always USER.
- [ ] Ensure quarantine, replacement creation and provenance insertion roll back together on injected failure/unique conflict.
- [ ] Race clean start against linking/recovery; one valid transition wins, loser returns safe conflict and no private projection. Verify normal email lookup and all reset paths exclude disabled/internal accounts.

## Task 3 — Purpose-bound OTP proof lifecycle

Files: `backend/src/modules/auth/password-reset.store.ts`; new `backend/src/modules/auth/ownership-proof.service.ts`; focused store/service tests; reuse existing Brevo transport without changing provider configuration.

Proof contract: purpose (`REGISTER`, `VERIFY_LEGACY`, `CLEAN_START`, `RESET_PASSWORD`, `LINK_GOOGLE`), canonical email, challenge ID, optional user ID/Google subject and expected auth version; server-issued opaque grant only, never normal JWT.

- [ ] Red tests for 10-minute expiry, five incorrect attempts, resend limits, previous challenge invalidation, replay, wrong purpose/email/subject/version, delivery outage and Redis outage.
- [ ] Reuse cryptographic six-digit generation and HMAC storage; purpose-specific Redis keys. Grant lifetime at most five minutes/remaining challenge TTL.
- [ ] Consume once atomically before DB mutation; failed DB commit burns proof, never extends it. Generic pre-proof responses and no account details. Rate counters cannot be bypassed via case variants/purpose switching; bound both mailbox and network abuse without permanent lockout.

## Task 4 — Durable JWT/session enforcement

Files: `backend/src/modules/auth/token.service.ts`; `backend/src/middleware/{auth.middleware.ts,require-current-user.ts,require-role.ts}`; `backend/src/server.ts`; relevant Express locals typings and tests.

- [ ] Red tests: missing/invalid version JWT rejected; old version rejected after reset/link/quarantine even when Redis revocation keys vanish; disabled/deleted users and database outage fail closed.
- [ ] Require version claim on issuance/verification. Issue from the credential transaction's resulting snapshot, never reread a newer version to bless an older password proof.
- [ ] Load current user security state once per protected request and reuse request-local public snapshot for role/current-user and `/me`; do not add process caching. Preserve existing middleware callers/authorization semantics.
- [ ] Assert lookup counts (one indexed user read for protected `/me`/role paths where applicable). Measure representative local overhead, report no hosted performance claims. Document in-flight-request revocation boundary.

## Task 5 — Auth flows and exact attack regression

Files: `backend/src/modules/auth/{auth.service.ts,auth.controller.ts,auth.routes.ts,auth.validation.ts}`; `backend/src/modules/auth/google/{google.service.ts,google.routes.ts}`; password-reset service/controller/validation files; new ownership service/controller/routes/validation and tests within the auth module; new `backend/tests/auth-ownership.integration.mjs`.

HTTP contracts: request/verify registration OTP, grant-required existing register endpoint; request/verify legacy ownership OTP and explicit clean-start confirmation; existing login/Google/link/reset endpoints retained with safe restricted challenge responses. Finalize exact route names in tests before implementation; no old registration bypass.

- [ ] Registration OTP precedes user/password creation. Existing-email responses expose no profile; duplicate completions cannot overwrite users.
- [ ] Legacy continuity requires current password plus fresh OTP; verified-account reset preserves history. Email-only recovery requires explicit clean-start consent and new ID; ambiguous old history needs separate review.
- [ ] Known Google subject continues without password creation. Legacy hybrid requires fresh subject confirmation, removes unverified password and revokes versions. New subject/email collision never auto-links; known subject cannot be stolen through mailbox clean start. Preserve nonce, CSRF, issuer/audience and verified-email checks.
- [ ] Reproduce attacker registration fixture with attacker profile, ADMIN role and private historical rows; rightful mailbox/Google proof must not expose any of them. Verify attacker password/JWT rejected and replacement only sees its own data.
- [ ] Test concurrent login/reset, registration/registration, link/clean-start, differing subjects, proof replay and injected transaction failure using real isolated PostgreSQL/Redis. Stale tokens never authorize after the winning transition.

## Task 6 — Minimal frontend verification/recovery states

Files: `frontend/src/pages/{AuthPage.tsx,PasswordRecoveryPage.tsx}`; `frontend/src/components/GoogleSignIn.tsx`; `frontend/src/api/{auth.ts,client.ts}`; existing SessionProvider file as located in repository; focused UI tests beside existing tests.

- [ ] Red tests for registration email → OTP → credentials, expiry/resend/errors, safe legacy continuity and explicit clean-start warning/consent.
- [ ] Warn before clean start that previous private history is not transferred and needs separate review. Do not show old profile fields, account role or booking counts. Never accept restricted challenge as authenticated session.
- [ ] Preserve known-subject Google-only sign-in, explicit linking protections, sanitized return destinations, session-expiry/logout handling and current visual design.
- [ ] Test one-time reauthentication behavior and failed/stale challenge recovery with mocked APIs. No claim of successful personal Google login without user interaction.

## Task 7 — Focused verification and approval handoff

Files: update this checklist/spec with actual evidence; new concise `docs/auth-ownership-rollout.md`.

- [ ] Run focused backend/frontend auth tests, isolated migration/auth/Redis integration tests, Prisma validate/generate, both TypeScript checks and production builds using existing package scripts. Record actual commands/counts; separate unrelated pre-existing failures.
- [ ] Review diff: auth only, no secrets, no business-data transfers and no production connection. Inspect all login/JWT/reset/link paths for disabled-state/version bypasses.
- [ ] Publish migration/restore results, exact changed files, query-count evidence and remaining risks. Do not label unexecuted provider delivery/Google interaction passed.
- [ ] Deployment plan for later approval: recoverable hosted checkpoint, additive migration first, stop old vulnerable workers, deploy new workers, mandatory reauthentication, controlled smoke checks, monitor safe error codes. Recovery is forward fix/restricted auth, not old vulnerable code or dropped version fields.
- [ ] STOP for separate approval before Neon migration, hosted account changes, GitHub push or deployment.

## Plan review result

The revised plan separates email ownership from historical identity, preserves proven account continuity, and blocks automatic inheritance. Quarantine is an explicit runtime recovery action, not a migration backfill. The unavoidable legacy forgotten-password ambiguity is disclosed rather than hidden. No implementation or migration is performed by this document.
