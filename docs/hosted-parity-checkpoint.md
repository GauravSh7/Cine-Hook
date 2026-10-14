# Hosted parity checkpoint — 14 October 2026

**Superseded by the 15 October [full-parity preview](staging-parity-preview.md)
and [individual media review](staging-media-review.md).** Those record the
successful full read-only preview, media repairs and real hosted Google login/
session/logout acceptance. Historical blockers below are retained as an audit
trail, not the current status. No catalogue import has yet been approved.

## Read-only findings

The original static staging plan is **not sufficient for complete local parity**.
No Neon writes are approved or executed. The following counts were queried in
a read-only transaction after verifying the local `cinehook_dev` identity:

| Catalogue | Actual local records |
| --- | ---: |
| Movies | 77 |
| English / Hindi descriptions | 77 / 77 |
| TMDB ratings | 69 |
| Stored trailer IDs | 0 |
| Upcoming movies | 8 |
| Cities | 6,998 |
| Cities with cinema inventory | 3 |
| Theatres / screens / physical cinema seats | 3 / 8 / 576 |
| Regular / premium / recliner seats | 336 / 144 / 96 |
| 48-seat / 144-seat halls | 6 / 2 |
| Shows / show-tier prices | 710 / 2,130 |
| Future scheduled shows at audit time | 644 |
| Movies with future shows | 69 |
| Events / sports / activities | 3 / 3 / 3 |
| Event venues / sections / seats | 9 / 30 / 612 |
| Event sessions / session prices | 81 / 243 |
| Future event sessions at audit time | 45 |
| Browse listings | 24 (6 per category) |
| Simulated tax policies | 12 |

Future cinema inventory spans 15 October–2 December 2026 at audit time. Future
counts change with time: refresh the approved preview before applying. Preserve
upcoming titles without falsely advertising unavailable showtimes. Expired local
sessions must not be copied as supposedly upcoming inventory. The 6,998-city
lookup directory does not mean every city has booking inventory.

Movie artwork currently comprises 60 Wikimedia URLs and 94 TMDB URLs (poster
and backdrop combined). Exact media parity requires per-asset/provider rights
review; being present locally does not establish rights to publish it. Do not
silently substitute the smaller original-art catalogue and claim exact parity.
Trailers cannot be reproduced from local records because none are stored.

## Google sign-in: reproduced root cause

The actual deployed browser reported:

> [GSI_LOGGER]: The given origin is not allowed for the given client ID.

The configured Google client is present; the GIS script and rendered button load.
The hosted challenge endpoint returns 200. Its cookie is Secure, HttpOnly,
SameSite=Lax and host-only. A challenge-backed invalid-credential probe through
Vercel reached backend verification and returned 401 GOOGLE_INVALID_CREDENTIAL,
not an Origin or missing-cookie error. No account was created by this probe.

### Required owner dashboard action

1. Open Google Cloud Console → Google Auth Platform → Clients.
2. Open the **Web application client matching Render's GOOGLE_CLIENT_ID**.
3. Add `https://cine-hook-xi.vercel.app` to Authorized JavaScript origins,
   with no path or trailing slash. Keep existing localhost origins for local use.
4. Save. Allow configuration propagation, reload Login and retry the Google button.
5. Render FRONTEND_ORIGIN must remain exactly `https://cine-hook-xi.vercel.app`.
   If choosing a different OAuth client, update Render GOOGLE_CLIENT_ID to match
   it and restart the service. Never put a client secret in frontend variables.

This implementation uses a JavaScript credential callback, not a redirect
callback; do not invent a redirect endpoint to fix an origin restriction.
See [Google's official setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
Account selection, successful token acceptance, new registration, existing login,
logout and linking remain browser acceptance checks after the owner saves this
setting. No successful personal Google sign-in is claimed.

## Neon preview blocker

The private `backend/.env.staging` file is absent. The dry-run safely exits before
connecting: dedicated STAGING_* target settings are required. Use the private
template and setup instructions in [staging-catalogue-import.md](staging-catalogue-import.md).
Do not send a database URL, password or API key in chat.

The current static manifest must be upgraded to an allowlisted, read-only local
catalogue snapshot before presenting it as a parity import. Preserve enriched
metadata, collections, prices, exact physical layouts and relationships; exclude
users, profile data, wishlist ownership, bookings and financial records. Keep
create-only collision checks and approved-plan hashing. Do not execute the old
30-movie static plan as the requested complete parity import.

## Financial/deployment boundary

Local simulated tax policies are not verified production policies. Existing
PricingRepository permits simulation only for the specifically guarded local
development/test databases; production/Neon rejects it. DEV_RAZORPAY_TEST_CHECKOUT
also rejects production and non-loopback targets. The prepared staging guard
blocks new payment orders. Therefore importing catalogue alone cannot enable
hosted simulated bills or Razorpay test checkout.

A separate explicit hosted TEST-only design/approval is needed before changing
those guards or importing simulated pricing configuration. Preserve integer
paise amounts, frozen quotes, FIRST50/SAVE10, seat ownership/TTL, captured-payment
truth and refund reconciliation. Never relax live-key protection or represent
test receipts as GST invoices. No payment functionality was enabled here.

## Verification and remaining work

- Render readiness reports PostgreSQL and Redis up. Hosted Google config,
  challenge and invalid-token handling were checked through Vercel.
- Fresh targeted tests: 74 backend tests (Google verification/repository/service
  and staging guards), 11 frontend tests (Google lifecycle and staging notice).
- No implementation source changes in this diagnostic checkpoint, so builds
  were not rerun. Existing prepared importer remains uncommitted.
- The deployed entry asset differs from the local build; asset hashes alone do
  not establish a UI regression. Populated rendering parity remains unverified.
- Pending: private Neon target; full catalogue snapshot/media review; read-only
  Neon preview; explicit import approval; safety patch publication/deployment;
  populated browser/API checks; Google dashboard correction and real acceptance;
  separately approved hosted test billing/payment configuration.

No Neon writes, user copying, database reset, commit, push or deployment occurred.

## Subsequent owner setup and successful read-only Neon preview

The owner subsequently saved the staging file and updated TLS to verify-full.
Expected host/database/role checks now pass. A read-only direct PostgreSQL
connection verified the intended target and found zero rows in cities, movies,
theatres, screens, seats, shows, events, event sessions and browse listings.
All 15 repository migrations were verified in a second read-only Prisma
transaction. No inserts, updates or deletes were executed.

The importer CLI's 10-second connection limit failed on this machine. A
30-second limit succeeded with TLS verification retained; TCP connectivity and
DNS resolution also succeeded. IPv4-first alone did not make a 10-second
connection succeed. Exact underlying connection-delay cause is not established.
The successful preview used the existing target and manifest-inspection guards
with a 30-second connection limit; implementation source was not edited.

Target fingerprint:
`b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a`

Static-fixture preview hash:
`4dcb5dbaf345e122be292fe3d315fbb858100196a8144f08445752d2f2ab6f56`

This hash covers only the original static fixture (3 cities, 30 movies, 6
screens, 126 shows and 63 event sessions), **not the requested full parity**.
Do not approve or execute it as a complete parity import. Replace the fixture
with the allowlisted local catalogue snapshot and issue a new verified preview
before requesting import approval. Imported records remain zero.

After the owner's Google origin change, the GIS button rendered again without
a newly observed origin error. This is not proof of successful sign-in. Browser
automation could not activate the cross-origin provider button reliably; actual
account selection and session acceptance need a user-assisted browser check.
