# Pointer 2 — CI, authentication limits and monitoring

2026-10-23. Local branch `feat/pointer2-production-engineering`, based on reviewed release `4a706157`. No hosted changes, migrations, financial writes or push. No dependency changes. The unrelated uncommitted authentication rollout checklist is excluded.

## CI/CD

Existing `CineHook checks` workflow retained and extended: read-only repository permission, cancellation of superseded runs and job timeouts. Backend runs Prisma generation/validation, typecheck, all unit tests, build, compiled smoke tests, fresh disposable migrations/status and integration tests. No backend lint command exists; TypeScript and tests are enforced. Frontend now also runs explicit typecheck and all tests, alongside lint/build. Critical integration job exercises real Redis/PostgreSQL ownership/OTP/session/quarantine, atomic auth limits, FIRST50, booking, capture/webhook and refund races. All credentials are disposable CI-only service credentials; no hosted secrets are needed. No deployment job or deploy hook exists.

Three old integration fixtures were stale after Pointer 1: unverified password registrations expected 201, Google fixtures lacked authoritative hosted-domain evidence, and profile fixtures tried unverified registration. Tests now require actual OTP proofs for registration, model verified Google evidence explicitly at the controlled verifier boundary, and create verified profile test identities directly. Production ownership rules are unchanged. These fixtures initially failed and then passed. An existing startup smoke assertion was updated to structured configuration-field diagnostics, retaining secret-leak and nonzero-exit assertions.

`actionlint` validates both workflow files. GitHub's last existing run at `4a706157` failed backend integration; frontend passed: https://github.com/GauravSh7/Cine-Hook/actions/runs/39579667353 . The revised workflow cannot run on GitHub until separately approved push. Local test evidence is not a hosted CI pass. Linux service-container execution remains to verify after push.

## Redis-backed auth limits

Production startup always installs the limiter. No proxy/IP/header value contributes to identity. All admitted attempts (successful or unsuccessful) count; no account-existence lookup is made by the limiter. HMAC keys hide normalized email and credential material. Atomic Lua checks both buckets before incrementing; denied requests neither extend TTL nor consume deployment allowance. All keys share one Redis hash slot and have bounded TTLs. No process-local auth counters.

| Entry point | Bucket | Limit |
| --- | --- | --- |
| Password login | trimmed, lowercase submitted email | 10 / 15 minutes |
| Password registration | normalized email | 5 / hour |
| Google challenge | explicit shared deployment allowance | 2,000 / 15 minutes |
| Google login/link, ownership completion, password completion | HMAC of submitted credential/proof, per endpoint | 5 / minute |
| All above combined | deployment-wide allowance | 2,000 / 15 minutes |

`AUTH_API_GLOBAL_LIMIT` optionally sets the deployment allowance (100–10,000; default 2,000). This bounds unique-credential/mailbox spraying; it is **not** per-person identification. Attackers can exhaust the global allowance or target a mailbox quota, temporarily denying legitimate attempts. This bounded portfolio trade-off is explicit; distributed bot resistance is not claimed. Lowering the budget affects everyone, not a guessed Render proxy IP. Do not enable Express-wide trust proxy or copy unverified CIDRs.

429 uses generic `AUTH_RATE_LIMITED`, `Retry-After` from Redis TTL, and no-store. Disconnected/malformed/erroring/stalled Redis fails closed within two seconds with safe 503 and Retry-After 30; no in-memory fallback. A timed-out command may still conservatively consume quota later, but cannot authorize a request. Successful login does not clear an attack bucket. Existing OTP send/attempt/replay/session controls remain unchanged, including mailbox budget 240/day. Already issued OTP verification and protected reads are not routed through the new entry-point limiter. Keep `AUTH_TRUSTED_PROXY_CIDRS=` empty, `AUTH_OTP_RATE_LIMIT_MODE=mailbox-budget`, `AUTH_OTP_DAILY_EMAIL_BUDGET=240`.

## Monitoring and one owner setup checklist (after release approval)

1. **Render:** confirm health-check path `/api/health/live`; enable available service/deploy failure notifications to your verified email. Readiness can take longer than Render's 5-second health-check limit, so do not create a dependency-driven restart loop. Use `/api/health/ready` for external dependency checks. Startup, shutdown start/completion/deadline/cleanup and fatal runtime errors now have safe structured events. Render idle SIGTERM is an expected shutdown, not automatically a crash.
2. **GitHub:** after approved merge, add repository Actions variable `UPTIME_MONITORING_ENABLED=true`; watch the repository, enable Actions email notifications for failed workflows. As owner, disable/re-enable the uptime workflow so scheduled notification ownership is yours; run it manually once. It performs only public GETs: liveness, direct/proxied PostgreSQL/Redis readiness and frontend content. Hourly cadence, 75-second timeout and one retry accommodate cold starts without five-minute keep-awake polling. GitHub schedules can be delayed/disabled for inactivity; this is not an SLA or real-time exception alerting. Pause this variable during planned maintenance.
3. **UptimeRobot Free:** create one frontend keyword monitor for `https://cine-hook-xi.vercel.app/`, keyword `CineHook`, attach/verify your email, and use Test Notification to verify UP/DOWN delivery. Do not add a five-minute direct/proxied backend monitor: that would prevent Render idle sleep. The frontend-only monitor does not prove backend availability; the hourly job checks that separately. No API credentials required in this project.
4. **Acceptance:** receive both external monitor test notification and a GitHub failed-workflow notification before calling alerts working. Use the provider's notification test / an isolated deliberately failing workflow, never stop production or corrupt a health response to test alerts. No alert was sent or verified in this implementation session.

Request logs include server-owned request ID, method, route template, duration and status for 5xx/429/slow requests. Existing error codes and dependency diagnostics remain. No body/query/params/email/IP/JWT/cookie/OTP/password/provider payload or raw error stack is logged. Filter Render logs by `request_failed`, `request_completed`, `startup_failed`, `server_failed`, `shutdown_timeout`, `shutdown_cleanup_failed`, `uncaught_exception`, `unhandled_rejection` and dependency events. Browser network X-Request-Id correlates an error without sharing tokens. Routine public 4xx and healthy fast requests are not logged. Failures on arbitrary authenticated endpoints are logged but not individually emailed; hourly probes only detect the sampled health/public routes. No paid log-alerting/exception platform is configured.

Official references reviewed: [Render Free idle behavior](https://render.com/docs/free), [Render health checks](https://render.com/docs/health-checks), [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs), [notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications), [UptimeRobot free plan](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan), [notification testing](https://uptimerobot.com/faq/).

## Verification

- Backend: 862 unit tests; frontend: 273 tests. Frontend lint/typecheck/build and backend typecheck/build passed; Prisma schema validation passed.
- Real isolated PostgreSQL/Redis: 73 base integration checks, 25 pricing/FIRST50/payment/refund checks, 8 ownership checks, 8 mailbox-budget/rate checks; zero failures/skips in final runs. These include controlled provider transport, not real Razorpay transactions or personal Google/Brevo delivery.
- Compiled startup/configuration/shutdown smoke: 3 passed, including a handle-free stalled cleanup that must exit nonzero. New focused unit checks: 12 (included in backend total). Actual Redis limiter checks include concurrency across workers, TTL expiry, case/header rotation, 105 legitimate mailboxes behind one socket, global spraying, registration separation and fail-closed outage.
- All 17 existing migrations applied successfully to fresh local test databases. No new migration. Old fixture pg concurrent-query deprecation warnings remain; not production errors. Local fixture databases retained, no reset/flush or hosted reads/writes used.
- New GitHub run and external email alert delivery remain unverified pending owner approval/setup.

## Smallest safe release

Approve push/PR separately; keep Render Auto-Deploy OFF and Vercel builds paused. Require all three revised CI jobs green, including zero-skipped critical checks, before merging. There is no database migration or frontend artifact change to deploy. Manually deploy the reviewed Pointer 2 backend commit using `npm start`, retaining current TEST-only payment, auth and OTP environment. Default auth API budget works without adding an env value. Do not rerun imports/seeds or change tax/financial settings.

Verify readiness, sign-in/registration/Google, OTP, one isolated-account 429/Retry-After, and normal booking reads. Avoid consuming production coupons or capturing money merely to test limits. If auth fails, activate the existing maintenance guard while diagnosing; roll back only to secured `4a706157` if necessary (no schema rollback). Keep automatic deployment restrictions unchanged. Then perform the monitoring checklist above. Nothing in this document authorizes hosted changes.

## Changed-file manifest

- CI: `.github/workflows/ci.yml`, `.github/workflows/uptime.yml`.
- Runtime: `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config/env.ts`, `backend/src/modules/auth/auth-rate-limit.ts`, `backend/src/middleware/request-telemetry.ts`, `backend/src/lib/lifecycle.ts`.
- Commands/probe: `backend/package.json`, `backend/scripts/uptime-probe.mjs`.
- New tests: `backend/tests/auth-rate-limit.test.ts`, `backend/tests/auth-rate-limit.integration.mjs`, `backend/tests/observability.test.ts`, `backend/tests/uptime-probe.test.ts`.
- Updated fixtures/smoke: `backend/tests/auth.integration.mjs`, `backend/tests/google-auth.integration.mjs`, `backend/tests/profile-wishlist.integration.mjs`, `backend/tests/runtime-smoke.mjs`.
- Documentation: this file, `README.md`, `docs/implementation-progress.md`.
