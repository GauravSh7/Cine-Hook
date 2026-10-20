# Email ownership and secure Google account linking

Status: approved policy implemented and verified locally; hosted migration/push/deployment remain unauthorized. See `docs/auth-ownership-rollout.md` for evidence and limitations.

Scope: the authentication vulnerability audited at `0f44e80` only. Local code, additive migration and isolated tests are authorized. Hosted migration, hosted account changes, push and deployment are not authorized.

## Security objective and root cause

At audit baseline `0f44e80`, password registration issued a normal session without proving email ownership. `GoogleAuthService.login()` could link a verified authoritative Google email to that record without replacing the old password or revoking old sessions. Email uniqueness is not evidence that the person who registered the password owns the mailbox.

The fix must prevent retained access through an attacker-chosen password, previously issued JWT, stale login, recovery grant or concurrent linking request. Account IDs, bookings, profiles, wishlists, roles and financial history must not be merged, deleted or reassigned. No private account data may be returned before the appropriate authentication or explicit ownership-recovery flow completes.

## Alternatives considered

1. **Selected: durable verification state plus versioned authentication.** Verify new password registrations, recover existing unverified accounts explicitly, prevent email-only linking and invalidate credentials/sessions atomically. This covers both the original attack and legacy credentials.
2. Restore password-confirmed linking alone. Rejected as incomplete: it leaves unverified registration and historical sessions without a durable ownership boundary.
3. Silently replace credentials whenever a Google email matches. Rejected: it conceals account recovery, risks data disclosure and can accidentally conflate separate identities.

## Invariants

- Email-string equality never authorizes linking or merging.
- A Google subject, verified by the existing Google verifier and challenge checks, is the stable external identity. A changed provider email never silently transfers or merges accounts.
- No unverified password registration receives a normal JWT.
- Successful ownership recovery never leaves the old unverified password usable.
- A stale authentication version cannot pass protected-route authentication, even after Redis revocation keys disappear.
- Missing security state, database outage, expired/incorrect proof or uniqueness conflict fails closed.
- Google-only users do not have to invent or create a password.
- All proof purposes and subjects are bound explicitly; registration proof is not a password-reset or Google-link grant.

## User and credential policy

### New password registrations

The user first requests a Brevo registration OTP and proves mailbox ownership. A short-lived registration grant then allows setting name/password and creating a USER account. A concurrent request cannot steal the verified email or overwrite an existing record. A pending request does not create an active password account or normal session.

`POST /api/auth/register` will require the completed registration grant; the old email/password-only request must not remain a bypass. Registration request and OTP verification will have separate validated auth endpoints. Frontend registration becomes email -> OTP -> name/password -> authenticated account, preserving the existing return destination validation and visual design.

If the email already belongs to a record, registration must not overwrite it. The public request response remains generic; the UI offers sign-in/recovery without returning the existing name, role, subject or bookings.

### Existing unverified password accounts and hostile pre-registration

Mailbox ownership alone does not establish ownership of an unverified account's historical data. Neither Google email equality nor email OTP alone may unlock its profile, bookings, wishlist or role.

Two separate paths are required:

1. **Proven existing-account recovery:** current password plus fresh mailbox OTP, or fresh authentication by the already-bound verified Google subject, establishes continuity. Preserve that account ID and history. Replace any unverified password, increment auth version and establish verification atomically. For previously verified accounts, normal mailbox OTP password recovery preserves history.
2. **Email-only clean start:** after fresh mailbox OTP and explicit clean-start confirmation, quarantine the ambiguous unverified account and create a new USER account using the genuine email. Do not copy any profile, booking, wishlist, role, provider binding or financial data. Disable the old password and all sessions atomically. Historical rows remain attached to the old ID for separately reviewed recovery, not automatic disclosure or reassignment.

Quarantine uses an opaque non-deliverable internal email under the reserved `.invalid` domain to free the existing unique email constraint. Preserve the original address and quarantine provenance in a restricted authentication record, never in public responses. An additive `authDisabledAt` flag makes the old record inaccessible through every login, reset and JWT path; `authVersion` is incremented. Do not send mail to internal addresses. A known bound Google subject is independent account continuity evidence: mailbox-only takeover of that account is prohibited and must use the bound provider or review path instead. Clean-start is available only for ambiguous legacy password records with no bound subject.

There is no safe automatic way to distinguish an attacker-created unverified record from a legitimate unverified user who forgot their password and has no bound provider identity. Such a user can regain use of their email through clean start, but restoration of historical data requires separate ownership review. This limitation must be explained before confirmation; do not promise automatic history recovery or implement a new support/admin recovery feature in this change.

The new password must differ from the old password. A stale hash/version comparison cannot overwrite a recovery winner. A repeated attacker registration or login cannot reset verification, resurrect the original password or block the owner permanently. Temporary resend limits expire normally; an attacker cannot acquire permanent ownership merely by registering first.

### Google sign-in, collisions and legacy users

- **Known subject, Google-only account:** continue subject-based sign-in after the existing signature/audience/issuer/nonce checks. Establish the new ownership metadata transactionally if needed; never require password creation.
- **Legacy provider-only third-party email:** the verified bound subject establishes account continuity, not mailbox ownership. An internal derived `providerOnly` snapshot permits version-checked sessions without backfilling `emailVerifiedAt`; mailbox-only reset stays blocked until mailbox ownership is established. A legacy hybrid can clear the unverified password through fresh subject confirmation without falsely verifying an unrelated/stale email.
- **Known legacy subject with an unverified password:** return only a restricted security-confirmation challenge, not a normal JWT or profile. After explicit confirmation backed by fresh Google proof, disable the unverified password, mark ownership established and increment auth version atomically. Keep the subject, account ID and data; the user may optionally establish a new password later through OTP recovery.
- **New subject with an existing email:** do not automatically link. Offer the proof-based continuity or explicit clean-start paths above, without exposing existing private data. After establishing a safe authenticated account, linking requires explicit consent, fresh current-account proof and fresh Google evidence for that exact email. A clean-start account never inherits the old subject.
- **New subject with no existing email:** create a USER account from the verified identity. Gmail or a matching verified Workspace hosted domain can establish email ownership; for other domains, fresh mailbox OTP establishes email ownership before ordinary activation. A subject/email uniqueness race yields either the same legitimate winner or a safe conflict, never a merge.
- **Already verified linked accounts:** preserve their approved credentials and account data. A different Google subject cannot replace the existing binding through email equality.

Stored roles are never accepted from client input or Google profile fields. Proven same-account recovery preserves the database role; clean start always creates USER. Existing records are not marked verified merely because they have a Google-subject column or password hash.

## Proof handling and recovery

Reuse Brevo HTTPS delivery, the existing secure OTP approach and Redis shared state; do not introduce SMTP or an additional provider. Use six-digit cryptographically random codes, a ten-minute challenge TTL, at most five attempts, bounded email/network resend limits and single-use grants lasting at most five minutes or the remaining challenge TTL.

Store HMAC digests, not plaintext OTPs. Bind challenge/grant to purpose, canonical email, account/Google subject when applicable, and the expected auth version or credential snapshot. OTP purposes implemented are REGISTER, VERIFY_LEGACY, CLEAN_START and RESET_PASSWORD. Linking instead uses its existing authenticated fresh-password proof and signed Google nonce/CSRF challenge; there is no interchangeable OTP link grant. Resends invalidate the previous challenge for that purpose. Replayed, expired, wrong-purpose or stale-version grants cannot activate, reset or link anything.

Redis consumption and PostgreSQL are not one distributed transaction. Consume a validated proof atomically once, then commit the credential mutation with a row/version compare-and-swap. A database failure must not restore or extend the proof; the owner can request a new OTP. Concurrent proof completions may produce one winner, never two credential transitions. Provider delivery failure must not activate an account or leak account existence. No codes, grants, tokens, passwords or private account information go to logs.

## Durable state and JWT validation

Add to `User`:

- `emailVerifiedAt`, mapped to nullable `email_verified_at`, timezone-aware timestamp.
- `authVersion`, mapped to `auth_version`, nonnegative integer default 0.
- `authDisabledAt`, mapped to nullable `auth_disabled_at`, timezone-aware timestamp.

Add a restricted `AccountQuarantine` record with old-user ID (unique FK), replacement-user ID (unique FK), original canonical email, reason and timestamp. No public projection includes this record or internal email. Quarantine/create/provenance insertion is one short PostgreSQL transaction with expected version/hash/subject/verification checks; conflicts roll back completely. The transaction must recheck absence of a bound subject so concurrent linking cannot be bypassed.

New JWTs require an integer auth-version claim in addition to the existing identity/issuer/audience/expiry validation. A missing version is rejected; this intentionally signs out existing sessions once the new backend is released. Reset, unverified-account recovery and security-sensitive linking increment the version with the corresponding mutation. Issuance uses that transaction's resulting version, not a later opportunistic read that could bless a stale password.

Every protected request validates current verification/version state from PostgreSQL. Redis can continue to enforce existing revocation safeguards but is not the durable authority for version validity. No process-memory cache may permit a revoked version. Reuse a request-local current-user snapshot for `/me`, current-user and role middleware where possible; preserve their ownership/role semantics. Target one small indexed user lookup per protected request rather than duplicate version/user/role queries. Measure the query count and representative local latency; do not invent hosted performance claims.

An already-authorized, in-flight request is not retroactively undone by revocation. New protected requests after the ownership transaction must reject old versions. No booking/payment/refund transaction logic is changed.

## Migration and existing-account impact

The migration only adds the security columns, validity constraint and quarantine provenance table. It does not quarantine, rewrite or verify existing accounts. Do not delete/reset tables or backfill verification from email/password presence. Existing records retain all identifiers, relationships and business data. Later runtime credential/quarantine changes occur only after valid proof and explicit consent; historical business ownership never changes.

Before a future release, explicitly communicate one-time reauthentication and the recovery step for legacy unverified password/hybrid accounts. Complete the migration before starting the new application version; do not leave old vulnerable workers issuing sessions during cutover. New code must not silently downgrade to legacy authentication if columns/state are missing.

## Tests and acceptance evidence

Focused service, HTTP, frontend and isolated PostgreSQL/Redis tests must cover:

1. Exact hostile pre-registration -> rightful Google-owner collision -> mailbox OTP and explicit clean start -> new USER ID with no inherited data; old account quarantined, password/JWT rejected and historical foreign keys unchanged. Separately prove password-plus-OTP and known-subject recovery preserve legitimate history.
2. Existing Google-only login with no password creation; legacy hybrid confirmation removes old password and sessions.
3. OTP expiry, five incorrect attempts, resend limits, replay, wrong-purpose grant, wrong email/subject, guessed/modified proof and delivery outage.
4. Concurrent duplicate registration, reset versus login, Google linking versus login, conflicting subjects and repeated completion. Only the intended winner commits; stale-version tokens remain unusable.
5. Every protected-route path uses durable version validation; old tokens stay invalid after Redis revocation-key loss. Current roles and deleted-user behavior remain safe.
6. Additive migration on a fresh database and a populated pre-migration fixture. Verify IDs, roles and linked business/history rows survive unchanged. Test concurrent version increments and failure rollback.
7. Frontend registration/verification/recovery/collision states expose no profile before authentication and preserve validated navigation targets.
8. Relevant backend/frontend tests, Prisma validate/generate, TypeScript checks and production builds. Report unchanged unrelated failures separately.

Use fresh loopback-only disposable databases/Redis with explicit identity checks. Test provider transports do not send real emails or require personal Google interaction. Record simulated verification versus actual provider delivery honestly.

## Recovery and rollout readiness

Create a pre-migration snapshot of an isolated populated fixture, apply the additive migration, verify invariants, and test restoring the snapshot into a different isolated database. Never reset an existing database to manufacture rollback evidence.

An ordinary rollback to `0f44e80` is **not** a secure recovery plan: it would restore the vulnerability. Prefer a forward fix or restricted-auth maintenance mode while keeping the additive columns. Do not drop auth versions or re-enable old JWTs. No rollback/deployment action against Neon is authorized here.

After local implementation, present changed files, actual regression/build results, migration/restore evidence, request-query overhead and a deployment/cutover checklist. Obtain separate approval before any hosted migration, account modification, push or deployment.

## Explicit non-goals

No changes to booking, seat-lock, payment, coupon, refund or tax behavior. No UI redesign, broad rate-limiting project, secret rotation, provider-account changes or unrelated audit fixes. OTP-specific safety limits are part of this authentication fix; the separate general login-throttling audit finding remains separate.
