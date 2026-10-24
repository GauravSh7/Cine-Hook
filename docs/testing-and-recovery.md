# Pointer 3 — testing and recovery

Verified **24 October 2026 (IST)** against `origin/main` / release
`76c42a74d0cb4eeba9ce8f9f7a5d317c42c5f844`. Documentation-only follow-up;
no deployment, hosted database writes, payment attempts or fault injection.

## 1. Automated evidence and coverage

[GitHub run 39932938696](https://github.com/GauravSh7/Cine-Hook/actions/runs/39932938696)
is completed/success at the exact release SHA. Job statuses **and log summaries**
were retrieved again, rather than treating previous prose as test output.

| Verified CI job | Actual passing checks |
| --- | --- |
| [Backend](https://github.com/GauravSh7/Cine-Hook/actions/runs/39932938696/job/120345408669) | **850** unit tests / 69 files; **3** compiled smoke tests; **73** PostgreSQL/Redis integration checks; schema validation, typecheck, build, fresh migration deployment/status |
| [Frontend](https://github.com/GauravSh7/Cine-Hook/actions/runs/39932938696/job/120345409059) | **273** tests / 31 files; lint, typecheck, production build |
| [Critical integration](https://github.com/GauravSh7/Cine-Hook/actions/runs/39932938696/job/120345408882) | **8** ownership + **8** OTP/mailbox-budget/auth-limit + **25** pricing/payment/refund checks |

Integration total: **114**; smoke total: **3**; zero failed/skipped in those
summaries. All **17** migrations applied in disposable CI databases. Backend has
no lint command. The earlier Pointer 2 local report says 862 tests / 70 files;
that is **not** the count in the reviewed GitHub job. This report uses the
retrieved 850 count, without inventing a new 862-test run or adding totals from
overlapping runs. No full suite was rerun for this documentation-only change.

Meaningful coverage inspected in existing files:

| Area | Existing executable coverage under `backend/tests/` |
| --- | --- |
| Password, Google, OTP, sessions | `auth.integration.mjs`, `google-auth.integration.mjs`, `ownership-http.integration.mjs`, `ownership-flow.integration.mjs`, `ownership-login-races.integration.mjs`, `ownership-proof.integration.mjs`: verified identity/subject, CSRF/nonce, registration proof, expiry/replay/attempt limits, stale login races and auth-version rejection |
| Ownership/history isolation | `ownership-repository.integration.mjs`, `ownership-concurrency.integration.mjs`, `ownership-financial-history.integration.mjs`: clean-account quarantine versus continuity/linking races; no inherited attacker history; historical financial rows preserved |
| Rate limits/outages | `auth-rate-limit.integration.mjs`, `ownership-mailbox-budget.integration.mjs`, `auth-rate-limit.test.ts`: atomic multi-worker enforcement, TTL, distinct mailboxes behind one proxy, spoofed headers, global budget, Redis disconnect/stall/fail-closed behavior |
| FIRST50 | `pricing.integration.mjs`: cancelled discounted reservation then unrelated full-price retry, competing reservations, uncertain acknowledgements/late capture, permanent consumption on capture even after refund, trusted frozen totals |
| Seats/transactions | `seat-lock.integration.mjs`, `booking-database.integration.mjs`, `booking.integration.mjs`: atomic multi-seat Lua, fenced owner/hold, TTL without renewal, ABA release, database allocation constraints and rollback |
| Payment/recovery | `payments.integration.mjs`, `payments-database.integration.mjs`: real Razorpay adapter with controlled transport; raw signed webhook verification, duplicate events, browser-close recovery, lost order acknowledgement, capture before attach, Redis/SQL failures and retry |
| Cancellation/refunds | `refunds.integration.mjs`, `refunds-database.integration.mjs`: atomic allocation release, cancel/rebook/replay races, durable pending refund, exact trusted amount, provider outage/lost acknowledgement, idempotent retry/reconciliation and late-capture compensation |
| Process/error safety | `runtime-smoke.mjs`, `observability.test.ts`, `uptime-probe.test.ts`: compiled startup with failed dependencies, sanitized configuration errors, single shutdown, failed/hung cleanup deadline, request IDs and no secret/raw-URL logging |

No important missing test was identified for this bounded final pass. These tests
do not prove real Google interaction, Brevo inbox delivery or provider uptime.
Earlier successful personal authentication, TEST checkout/refund and two-account
seat checks are **owner-reported acceptance**, not newly executed here.

## 2. Backup integrity and restoration evidence

Reused the verified **21 October 2026, 13:06 UTC** pre-FIRST50 recovery point:

- Private directory: `C:/Users/gaura/Documents/Codex/cinehook-first50-release-recovery-20261021-c19d253c/`.
- Dump: `neon-339a0355-1cbd-4485-81d5-c6ad647ed662.dump`, **531,078 bytes**.
- SHA-256: `4da8c4d1fca792edc880c099df698a7b7b1de180400df7991b303baebd2d5c6a`.
- `verification.json`: expected Neon identity matched; TLS verified; source
  transaction repeatable-read/read-only with an exported snapshot; isolated local
  restore into a new database; **all 33 application-table fingerprints/counts plus
  the migration ledger matched**. **403** constraints, zero unvalidated;
  zero invalid indexes. Included 4 users, 19 bookings, 12 payments and 6 refunds
  at that recovery point, not purported current production counts.
- `migration-verification.json`: upgrade from 16 to **17** migrations, reviewed
  FIRST50 function matched, all 33 application-table fingerprints preserved;
  403 validated constraints and zero invalid indexes after migration.
- Today: dump size/SHA match the retained report; `pg_restore --list` succeeds;
  **full archive decoding via `pg_restore --file=NUL` succeeds** with no database
  connection. The existing successful restoration is reused, not claimed rerun.

Dump and reports contain sensitive data or fingerprints: retain privately; never
commit/upload them. Earlier checkpoints and the owner-reported Neon manual
snapshot were not altered. Snapshot retention, current PITR window, automated
backup schedule and off-device/encrypted replication are **not independently
verified**. A restorable local dump is not a guaranteed managed backup service.

## 3. Reproducible safe backup/restore procedure

For a future authorized exercise, use PostgreSQL **18** tools (source was 18.6),
an approved direct Neon connection with `sslmode=verify-full`, private credentials
and a trusted root certificate. First compare hostname/database/role with the
approved expected identity. Do not infer a target from a filename or use a pooled
endpoint. Never place credentials in CLI arguments, console output or Git.

The existing reviewed private helper is
`C:/Users/gaura/Documents/Codex/cinehook-neon-recovery-20261020/recovery-check.local.mjs`.
It reads the private `backend/.env.staging` expected-target fields, asserts server
identity/read-only mode, exports one consistent snapshot, writes a new custom dump,
restores transactionally into a **new** random database on **127.0.0.1:55448**, and
compares every table's sorted UTC JSON fingerprint, constraints and indexes.
It never restores to Neon. Do not execute historical migration-apply helpers.

Prerequisites: inspect that helper first; an isolated PostgreSQL 18 instance with
role `ownership_test` must already be provisioned on that loopback port. Confirm
the instance is dedicated to recovery, not the normal local application database;
do not reset/start over an occupied directory or unknown server. Dependencies
`pg`/`dotenv` come from the existing backend installation.

PowerShell example (run **only after a future backup exercise is authorized**):

```powershell
Set-Location C:\Users\gaura\Documents\Codex\cinehook-auth-security\backend
$recoveryRoot = Join-Path $env:LOCALAPPDATA ('CineHookRecovery\' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $recoveryRoot -ErrorAction Stop | Out-Null
$env:CINEHOOK_RECOVERY_DIR = $recoveryRoot
Get-Content -Raw C:\Users\gaura\Documents\Codex\cinehook-neon-recovery-20261020\recovery-check.local.mjs |
  node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'Recovery verification failed; retain evidence and stop.' }
```

The pipeline resolves existing backend dependencies without copying this private
helper into Git. Preserve the generated `verification.json`, dump, checksum and
restored database privately; inspect success flags, constraint/index validity and
all data comparisons, not just process exit status. Protect the directory with
owner-only access and use approved encrypted off-device storage. Do not paste
reports/raw database errors publicly. A failed/zero-byte export is not a backup.

Independent offline archive checks (no connection and no restore):

```powershell
$backup = 'C:\Users\gaura\Documents\Codex\cinehook-first50-release-recovery-20261021-c19d253c\neon-339a0355-1cbd-4485-81d5-c6ad647ed662.dump'
Get-FileHash -Algorithm SHA256 -LiteralPath $backup
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list $backup
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --file=NUL $backup
```

## 4. Database migration and backend rollback

1. Incident changes need separate approval. Keep automatic deployment gates;
   establish maintenance on **both** public API paths before schema/target changes.
   Normal command is `npm start`; `MAINTENANCE_MODE=true` returns 503 `guard-v1`.
   Setting it is a rolling deployment, **not an instantaneous kill switch**;
   confirm replacement/drain and no other writers. The standalone reviewed
   `npm run start:maintenance` bridge is an emergency alternative if the app
   cannot start; its health does not assert database readiness.
2. Preserve evidence and take a fresh verified backup. In a separately approved
   isolated restore, check migration checksums/history, fingerprints, constraints
   and indexes. The retained dump has **16** migrations: apply only the reviewed
   `20261021000000_full_price_offer_scope` there to reach the release's 17; never
   assume the old dump already has the current schema.
3. `npm run db:validate` validates schema; `npx prisma migrate status` reports
   target history; **`npm run db:deploy` applies every pending migration**, so use
   it only after exact target and sole-approved-pending-set checks. No reset,
   seed, `migrate dev`, ledger deletion or automatic down migration in production.
4. Prefer a reviewed forward repair on partial migration failure. Do not mark a
   migration resolved without inspecting actual DDL/data state. Restoring a whole
   old dump over live data would lose newer financial history: restore separately,
   reconcile, obtain approval, then perform a controlled target switch instead.
5. Broken backend: keep/reinstate maintenance, deploy the approved known-good
   secured revision with existing configuration. `76c42a74` is this baseline;
   `4a706157` is the earlier secured fallback only under incident approval and
   temporarily loses Pointer 2 controls. Never deploy pre-ownership vulnerable
   code or undo auth columns. Check live/ready, auth and schema compatibility
   before approved reopening. No schema rollback is needed for Pointer 2/3.

## 5. Redis, application and financial recovery

- **Redis unavailable:** readiness fails, auth limits/proofs/session checks and
  seat operations fail closed; no in-memory lock/auth bypass. Restore connectivity
  and review safe dependency logs. Do not `FLUSHALL`, delete lock keys, clear
  quotas or blindly replay an old Redis snapshot. Existing client reconnects;
  readiness must recover before reopening affected flows.
- **Redis data loss:** OTPs/grants and five-minute holds may be lost. Require new
  proofs/seat selection; never reconstruct or extend expired holds. PostgreSQL
  confirmed allocations/history, auth versions, frozen prices, coupon redemption
  and financial evidence remain authoritative. Transient logout/revocation and
  abuse counters may be lost even though durable auth-version revocation remains;
  plan owner-approved all-session invalidation (e.g. coordinated JWT-secret
  rotation) and conservative OTP/API budget handling before normal reopening.
  Never assume recovered Redis preserves used OTPs, revocations or daily budgets.
- **Process restart:** no process-local financial/seat authority. Liveness may be
  up while dependencies are down; readiness checks both. Inspect `startup_failed`,
  `server_failed`, `shutdown_timeout`, sanitized dependency events and request IDs.
  SIGTERM drains once with an 8-second cleanup deadline; startup/fatal/cleanup
  failures use nonzero exits. Render Free idle shutdown is not itself corruption.
- **Partial capture/refund failure:** keep captured financial truth, cancelled
  bookings and durable refund obligations. Never revive expired seats, repeat an
  unknown money request with a new identity, or re-enable FIRST50 after capture.
  Check provider TEST records and signed webhook retries. Existing authenticated
  `/api/payments/verify`, owner `/api/bookings/:id/refund/retry` and ADMIN
  `/api/admin/refunds/reconcile` are recovery paths, **not read-only diagnostics**;
  execute only with incident approval and trusted existing identifiers/payloads.
  Preserve raw-body signature checks and provider event/payment/refund identities.
  Inspect disabled/exhausted webhook retries; no guaranteed background reconciler
  or infinite provider retry is claimed. Maintenance returns non-2xx, not fake ACKs.
- **Database rollback to an older recovery point:** later bookings, captures,
  refunds, credentials and auth versions are absent. Remain closed, reconcile
  provider evidence and user changes, invalidate sessions/proofs under approval,
  and independently verify recovery before reopening. Never treat an older
  restored auth version as assurance that previously revoked JWTs stay rejected.

## 6. Fresh read-only checks, limits and verdict

On this pass, `node backend/scripts/uptime-probe.mjs` returned **4/4 HTTP 200**:
direct liveness, direct readiness, Vercel-proxied readiness (both PG/Redis up),
and frontend content. Anonymous `/api/auth/me` on both domains returned safe
401 `UNAUTHORIZED`; unknown API path returned 404 `NOT_FOUND`; all three had
server-generated request IDs, ignored a forged incoming ID and showed no tested
connection-string/password/stack leak. This is bounded evidence, not a proof
that every possible error is leak-free. No hosted fault injection was performed.

No code changes or new tests were necessary. Existing CI/integration tests cover
the important partial failures; personal Google, Brevo, payment and cancellation
acceptance was not repeated or falsely claimed. Current health is point-in-time,
not an uptime guarantee. No promised RPO/RTO: the retained dump excludes writes
after its snapshot, roles/ACLs, Redis, media binaries, credentials and provider
control-plane settings. Restrict backups, preserve separately protected setup
information, and take a new authorized checkpoint before future risky changes.
Provider retention/PITR and recurring/off-device backups remain operator tasks.
See [operations](pointer2-operations.md), [auth rollout](auth-ownership-rollout.md),
[payment handling](payments-webhooks.md) and [refunds](cancellation-refunds.md).

| Pointer 3 acceptance | Result |
| --- | --- |
| Reviewed CI, coverage and 17-migration evidence | PASS |
| Retained dump checksum/full decode and prior isolated restore | PASS |
| Data/constraint preservation and schema upgrade evidence | PASS |
| Current dependency health and safe public errors | PASS |
| Bounded recovery/rollback procedure and limitations explicit | PASS |
| New critical issue requiring application changes | None identified |

**POINTER 3 COMPLETE for the agreed portfolio scope.** No hosted changes or push;
Pointer 4 is not started. This is not certification for live-money operation,
guaranteed automated disaster recovery, or exhaustive external-provider testing.
