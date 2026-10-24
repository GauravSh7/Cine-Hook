# Final UX release — acceptance gate

Prepared 25 October 2026 from `2d9fd759`. No schema migration is required.

## Implemented scope

- Reads/auth requests have a bounded 60-second deadline; financial writes retain
  their 10-second deadline and uncertain-result booking guidance. One 750 ms
  retry is allowed for GET responses with 502/503/504 within the original deadline.
  No automatic replay of login, OTP issuance, registration, bookings or payments.
- GIS renders its official button directly. User interaction, nonce/CSRF,
  verified subject, consent and stale-attempt guards are retained.
- Registration collects name, international-format mobile, email and matching
  passwords in memory; OTP verification and account creation happen on the server.
  Success is green and returns to login without storing a session automatically.
  Resend has a 60-second UI cooldown plus unchanged authoritative server limits.
- Standard password recovery has no choice selector. Explicit legacy continuity
  still needs current-password proof plus OTP; mailbox-only access cannot inherit
  private history. Existing clean-start backend protections are not removed.
- Logout confirmation is keyboard accessible and uses `POST /api/auth/logout`.
  Successful revocation increments durable `authVersion`, signing out all active
  sessions for that account before browser state is cleared. Failure remains
  visible and retryable. No booking, payment or refund state is changed.

## Evidence and remaining checks

- Tests reproduced the old 10-second timeout, duplicate Google-button step,
  immediate logout, absent registration-details step and recovery selector.
- Independent review found inconsistent phone validation and Escape focus leakage
  behind the header logout modal. Both were reproduced and fixed with tests.
- Local: 866 backend tests, 288 frontend tests; frontend lint; backend/frontend
  typechecks/builds; Prisma validation passed. Three compiled smoke checks passed.
  The initial frontend regression run had an outdated scrolling call-count
  expectation; it now covers the one bounded retry. Type errors in new test
  selectors and subsequent test-harness failures were corrected before final run.
- Read-only production readiness returned 200 with database/Redis up; first
  response took 35.51 seconds, consistent with cold startup exceeding the old
  10-second client deadline. Vercel-proxied liveness also returned 200.
  This is not access to private Render logs or proof every timeout is a cold start.
- PostgreSQL-backed phone persistence/revocation assertions extend the existing
  disposable auth integration test. Hosted CI must execute them before release.
- Live Google chooser, real inbox OTP delivery and deployed new UX remain separate
  acceptance checks. Local tests do not prove them.

## Controlled publication and release

1. Verify Render Auto-Deploy OFF and Vercel Ignored Build Step “Don't build
   anything”. Fast-forward reviewed GitHub main, no force push; require backend,
   frontend and critical-integration CI jobs to pass for that exact commit.
2. Render: Manual Deploy → Deploy a specific commit → reviewed full SHA. Retain
   Docker command `npm start`, current `MAINTENANCE_MODE=false` and all existing
   private environment/payment settings. No migration, seed or environment change.
   Backend first is compatible with the previous frontend.
3. Verify Render Live SHA, `/api/health/live`, `/api/health/ready` and both public
   API entry points. Do not issue OTPs or financial requests as anonymous probes.
4. Vercel: create a controlled Production deployment for the same SHA and use
   “Deploy Anyway”/the single-deployment ignored-build override if offered. Do not
   change the global ignored-build setting. If no such control is available,
   pause for an owner-run `vercel --prod --force` from this commit's frontend
   directory using the existing linked project; verify the dashboard Git/source
   metadata and alias rather than assuming a CLI upload proves its revision.
5. Verify production HTML/new assets, intended SHA and backend readiness. Keep
   automatic-release controls unchanged.

## Owner-only live acceptance (never share passwords or OTPs)

1. Logged-out homepage loads during startup or shows meaningful Retry; login never
   tells an anonymous visitor to check a booking. No repeated refresh is needed
   for a healthy startup within the bounded deadline.
2. Login shows Google's official button immediately. Click once, choose your
   account, verify the correct profile, reload, then use confirmed Logout.
3. Register with an email you control: details → Continue → OTP. Wrong code must
   not activate an account; controlled resend invalidates the old challenge.
   Correct code produces green success and Continue to login, not automatic login.
4. Verified-account recovery: email → OTP → new, different password → login.
   A legacy account without continuity proof must not reveal its old history.
5. Logout: Cancel and Escape preserve login; Confirm signs out. Old session must
   fail protected reads. Test desktop and mobile, including header-menu keyboard
   navigation. Do not use a customer's account or consume FIRST50/payment records.

On a critical regression, retain records and stop acceptance. Re-enable the
reviewed maintenance guard through a controlled backend redeploy if needed.
Roll back frontend and backend to the known-good secured `76c42a74` artifacts
(or a subsequently verified secured revision), never pre-ownership code. No
database rollback is needed for this additive endpoint/UI release. Any auth
versions already incremented remain incremented; users simply sign in again.

**Feature freeze remains pending final deployed acceptance.**
