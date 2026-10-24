# Authentication ownership — controlled release checklist

Current public runbook, 24 October 2026. Authentication ownership and FIRST50
migrations are already applied in the reviewed hosted release (17 migrations).
Do not execute old migration/deployment checkpoints again. This file is procedure,
**not authorization**; documentation publication does not authorize deployment.

Historical private rollout notes were preserved outside Git before this cleanup.
Public recovery evidence is in [testing and recovery](testing-and-recovery.md);
identity rules and isolated security-test evidence are in
[the ownership report](auth-ownership-rollout.md).

## 1. Before a separately approved production release

- Record the exact approved Git revision and compatible frontend/backend artifacts.
  Verify current main, CI, production revision and pending migrations.
- Keep Render Auto-Deploy OFF and Vercel automatic builds paused unless the owner
  explicitly approves changing those controls. A green CI job does not authorize
  or perform production deployment.
- Privately verify database hostname, database, role and TLS identity. Take a
  fresh independent recovery checkpoint before schema writes; verify restoration
  in a separate isolated database. Preserve older backups and snapshots.
- Confirm Brevo sender/API readiness and Google Web client configuration.
  Authorized origin must match `FRONTEND_ORIGIN` exactly; keep nonce, CSRF,
  audience/issuer and server signature validation.
- Retain existing TEST-only payment, tax and coupon settings. Never copy local
  secrets into Git or browser variables, or enable live Razorpay credentials.

## 2. Auth/proxy configuration

The approved small-deployment fallback is:

```dotenv
AUTH_TRUSTED_PROXY_CIDRS=
AUTH_OTP_RATE_LIMIT_MODE=mailbox-budget
AUTH_OTP_DAILY_EMAIL_BUDGET=240
```

Keep global Express proxy trust disabled. Neither client-supplied forwarding
headers nor Render outbound IPs establish trusted inbound client identity.
Mailbox limits and a bounded deployment email budget avoid a shared-proxy quota.
The deliberate trade-off is possible mailbox/global-budget denial of service;
this is not bot detection. Existing OTP verification remains available when the
send budget is exhausted. Accepted sends can spend budget even if delivery fails.

`AUTH_API_GLOBAL_LIMIT` defaults to 2,000 admitted auth attempts per 15 minutes;
see [Pointer 2 operations](pointer2-operations.md) for endpoint-specific limits
and Redis fail-closed behavior. Do not weaken proof/ownership checks to make a
legacy account, provider failure or exhausted quota pass.

## 3. Migration window, only when approved and necessary

1. Deploy the secured application using `npm start` with
   `MAINTENANCE_MODE=true`. Verify auth, booking and payment API requests return
   HTTP 503 `guard-v1` on **both** Render and Vercel entry points.
2. Confirm replacement is Live and previous workers/in-flight writes have drained.
   A flag save or one 503 does not prove instantaneous termination. Provider
   deployment guarantees plus observed cutover may establish the gate; distinguish
   that inference from directly observed process termination.
3. If the application cannot start, the reviewed
   `npm run start:maintenance` bridge provides a no-business-handler gate.
   `bridge-v1` health proves the gate is alive, not dependency readiness.
4. Verify exact database identity, fresh backup, existing migration checksums and
   the **sole approved pending set**. `npm run db:deploy` applies every pending
   migration; stop on any unexpected one. Never reset, seed, drop security columns,
   run `migrate dev`, or edit the ledger to hide a failed migration.
5. Compare schema, constraints, indexes and preserved account/booking/financial
   evidence against the checkpoint. Do not backfill email ownership on assumption.
6. Deploy the approved secured backend and compatible frontend under maintenance.
   Preserve automatic-release gates. Verify revisions, 503 markers and genuine
   PostgreSQL/Redis readiness before approved reopening.

## 4. Reopening and acceptance

After separate reopening approval, set `MAINTENANCE_MODE=false`, retain
`npm start`, and redeploy the same approved secured revision. Immediately test
with controlled accounts/data:

- Google chooser → correct profile → reload → logout; Google-only users do not
  need to invent a password or inherit an unrelated email account.
- Password login, registration OTP, Change Email, OTP expiry/replay, recovery and
  old-session rejection after auth-version changes.
- Legitimate legacy continuity retains the same history. Mailbox-only clean start
  quarantines the original identity without exposing its private history.
- Booking/seat reads and approved TEST checkout/cancellation; verify authoritative
  payment/refund convergence without unnecessary coupon or payment consumption.

Do not claim inbox delivery or personal provider sign-in from unit tests or
public config responses alone.

## 5. Deferred webhooks and safe recovery

Maintenance rejects webhooks with non-2xx; it neither acknowledges unprocessed
events nor queues them locally. Holds still expire. Before/after reopening,
inspect Razorpay TEST webhook enabled state, delivery failures and retry limits
for all six existing event subscriptions. Late capture must reconcile/refund
without reviving cancelled or expired seats. Provider retries are finite; missed
events need separately approved reconciliation, never a false success response.

On failure retain/re-enable maintenance. Prefer reviewed forward repair.
An application rollback may use a known-good **secured** revision only; never
restore the pre-ownership vulnerability. Whole-database restoration must be into
a separate target followed by reconciliation/approval, not overwrite newer user
or financial records. Coordinate all-session invalidation after loss of auth or
Redis recovery state. See [recovery limits](testing-and-recovery.md).
