# Final UX closure

Scope: implement the owner's four explicitly approved UX changes in the existing
isolated worktree. No database migration or financial behavior changes.

1. API boundary: reproduce the 10-second cold-start failure; allow 60 seconds for
   reads/auth, retain 10 seconds for financial writes. Retry one transient 502/503/504
   GET within that same deadline; never replay mutations. Preserve aborts/request IDs.
2. Google: initialize the official GIS button when the login form mounts; no custom
   intermediate Continue button. Keep nonce/CSRF, global attempt ownership, stale
   session/password guards and explicit security consent on legacy conflicts.
3. Registration: details (including mobile) -> OTP -> backend verified registration
   -> green success -> login. Credentials remain in component memory only. Change
   Email clears all proof/password state. Retain controlled resend. Standard recovery
   has no selector; explicit legacy verification remains available without email-only
   access to historical data. Do not auto-select clean-account quarantine.
4. Logout: reuse the accessible confirmation dialog. Confirm calls an authenticated
   backend endpoint that durably increments authVersion; then clear client state.
   Fail closed on revocation failure and let the user retry. This signs out existing
   sessions for the account, without touching bookings/history.

Verification: test-first API/auth/Google/logout regressions, backend auth/ownership
tests, frontend suite/lint/typecheck/build, backend typecheck/build/smoke, then CI.
Review the diff, verify paused deployment gates, commit on fix/final-ux-closure and
fast-forward main. Release matching backend first, then frontend, without migrations
or automatic-release changes. Dashboard access and private Google/OTP acceptance
may require the owner's manual action; never claim live closure from local tests.

Evidence: Render Free services spin down and can take about a minute to restart
([Render](https://render.com/docs/free)); Vercel external rewrites have a 120-second
limit ([Vercel](https://vercel.com/docs/errors/router_external_target_error)).
GIS supports direct official renderButton with nonce and FedCM
([Google](https://developers.google.com/identity/gsi/web/reference/js-reference)).

## Execution evidence

- API, registration/recovery, Google and logout regressions were observed failing
  against the old implementation before fixes. Consolidated tests subsequently pass.
- Independent read-only whole-diff review requested changes for international-phone
  contract consistency and header-menu Escape focus leakage. Both were reproduced
  and fixed; additional pointer-cancel focus coverage protects the portal boundary.
- Ruling: logout uses existing durable authVersion (all active account sessions),
  rather than introducing a new single-session store or a database migration.
- Ruling: ordinary recovery has no selector, but explicit existing legacy/clean-start
  routes remain guarded for backward compatibility; no automatic quarantine/merge.
- Backend 866 tests, frontend 288 tests, builds/typechecks, frontend lint and Prisma
  validation pass. Compiled smoke: 3 passed. Auth integration now checks phone
  persistence and durable logout with real PostgreSQL in the existing CI sandbox.
- Dashboard connection unavailable at preparation time. Reopening/freeze may not
  be claimed without verifying matching deployed revisions and owner-only acceptance.
