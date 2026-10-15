# Approved staging release — 15 October 2026

**Current result: exact refreshed catalogue imported and independently verified.**
See [completed import](staging-import-completed.md) for actual Neon counts,
readback/idempotence evidence, importer-only corrections and live-site checks.
The approved hash was 6d8a50830de10b8446e70a35bc892a2f9e45f3008d53ba3f99e2fdb79034469f.
Payments remain disabled. All blocked/awaiting checkpoints below are historical.

**Historical pre-import checkpoint:** the refreshed preview was ready and
awaited approval. The owner subsequently approved the exact hash above and the
catalogue import completed; see [completed import](staging-import-completed.md).
The frozen [14:32 IST preview](staging-refreshed-preview.md) remains as the
record of what was approved.

## Latest verification — 15 October, 14:26 IST: snapshot expiry blocks import

The owner reports Render commit 1ae4374 is live. Direct and Vercel-proxied
checks now both return HTTP 200: catalogue mode staging, newPaymentsAllowed
false, matching pinned fingerprint; readiness reports database up and redis up.
A separate read-only Neon transaction reverified database/role/schema/port,
the exact original approved plan and source hashes, and zero metadata drift.

The frozen snapshot is no longer future-only: six of its 644 movie shows and
nine of its 45 event sessions have started. At 14:26 IST, 638 movie shows and
36 event sessions remained future. No dates were shifted and no approved
snapshot artifact was overwritten. Every Neon catalogue model remains empty;
private counts remain one user and zero bookings/payments/refunds.

**Stopped before apply.** The deployment blocker below is resolved, but check 5
(snapshot validity) failed. A refreshed read-only preview must explicitly exclude
expired sessions and attached prices, preserve all other approved content, and
receive approval for its new hash before import. No code or financial rules changed.

## Current result: blocked by Render; catalogue not imported

The owner explicitly approved the reviewed full-parity import and required
staging safeguards. Before writes, read-only Neon checks confirmed the pinned
database/role/schema/port and target fingerprint:
`b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a`.

The frozen source hash and exact approved plan hash still match:
`713fc4a935ff392646c4251c7bdc0d1abda1322f083abd6deec3ad2908c9d0fe`.
No metadata differences were found. None of the 644 future movie shows or 45
event sessions had expired at preflight. Planned counts remain those in
[staging-parity-preview.md](staging-parity-preview.md). Neon catalogue counts
remain zero. Pre-import private counts: one user, zero bookings/payments/refunds.
No local users or financial records have been copied.

## Recovery checkpoint

A complete logical PostgreSQL custom archive is saved privately, outside Git
and OneDrive, with current-user/SYSTEM-only directory permissions:

`C:\Users\gaura\.codex\private-backups\cinehook-staging\2026-10-15-pre-catalogue\pre-import-verified-ca.dump`

187,971 bytes. SHA-256:
`d45e7653d2004a48991d2a0d36288ff846ac456db75d2c7432a1b3018d10463c`.
`checkpoint.json` beside it records the target fingerprint, approved hash,
timestamp, versions and pre-import counts. The archive table of contents and
complete SQL decoding passed without connecting to a restore database.
An actual restore has not been executed; never restore over Neon automatically.

The first dump attempt failed certificate verification with libpq's system
root handling. The successful attempt used the application's Node default
trusted CA roots exported to a private PEM file. TLS remained verify-full;
no certificate verification was disabled. A failed partial dump is not a
recovery checkpoint; use only the named verified archive above.

## Publication and provider blocker

Safeguard/importer commit `3d95653` was pushed to main. Published changes were
scanned against configured secret values: zero secret matches. Private env
files, approved frozen artifacts, backups and unrelated scratch files are not
tracked. Forty targeted backend tests and seventeen frontend tests passed;
backend/frontend typechecks/builds and frontend lint passed.

Render saved the explicitly approved STAGING_CATALOGUE_MODE=true and
DEV_RAZORPAY_TEST_CHECKOUT=false settings. Save/rebuild and manual deployment
were attempted. Manual deployment returned **Deploy Error: Service Unavailable**.
The last successful Render deployment still references `4064589`.
The hosted `/api/catalogue/status` route through Vercel returns 404: the required
new guard is not deployed. The importer has NOT been run in apply mode.

[Render's official status page](https://status.render.com/) reports builds/
deploys failing across regions and paused free-service deploys. This is a
provider-side deployment blocker, not authorization to bypass import safeguards.
No instance upgrade, platform migration or security relaxation was attempted.

## Resume gates

1. Once Render permits deployments, deploy the approved safeguard commit.
2. Require `/api/catalogue/status` to report staging, newPaymentsAllowed=false
   and the exact pinned target fingerprint, both directly and through Vercel.
3. Verify the frozen approved hash and current Neon identity again. If any
   session expired or destination/source changed, stop for a fresh reviewed
   preview; do not advance dates or replace the approved snapshot silently.
4. Only then apply the frozen approved catalogue with the existing guarded CLI.
5. Read back every model/metadata/layout/price, verify repeat planning adds zero,
   preserve private counts, and check populated hosted pages and available flows.

No tax policies are imported. Hosted simulated bills, coupons applied to bills,
Razorpay checkout and official tax invoices remain unavailable under existing
financial guards. Eight missing ratings and fifteen missing trailers remain
documented in staging-media-review.md. Fresh hosted Google login/session/logout
passed the previous acceptance check; new-user registration with another identity
and post-import populated browser checks remain unverified.
