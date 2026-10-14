# Full-parity staging preview — 15 October 2026

## Latest reviewed preview — supersedes the historical checkpoint below

Captured **02:15:37 IST, 15 October**. Source and pinned Neon target verified;
all 15 migrations present. Neon catalogue still empty; **zero catalogue writes**.
Counts and exact seat layouts in the historical table below remain unchanged:
6,998 cities, 77 films, 3 theatres, 8 screens, 576 seats, 644 future shows,
9 bookable listings, 612 event seats, 45 future event sessions, 24 browse cards.
66 past movie shows and 36 past event sessions are explicitly excluded.

The approved staging-only content patch matches all 77 TMDB identities, preserves
all 69 rating tuples, adds 62 verified official YouTube trailer links, and replaces
30 movies' article-only non-free Wikipedia artwork with matched TMDB assets.
All 77 English/Hindi descriptions, every price, row, category and seat ID remain.
Eight missing ratings and 15 trailer gaps remain honestly absent. The local
database was not changed. See [individual media review](staging-media-review.md).

**186/186 media assets passed; zero availability failures and zero remaining
Wikimedia rights-review entries.** The approved TMDB logo is deployed and returns
image/svg+xml. Provider reachability is not itself a copyright grant; use is
bounded to TMDB's non-commercial API terms with attribution, not commercial rights.

Current frozen approval hash:
`713fc4a935ff392646c4251c7bdc0d1abda1322f083abd6deec3ad2908c9d0fe`

Only owner-approved frontend Google/attribution files were pushed and deployed.
Fresh hosted Google sign-in succeeded, the session survived reload, and logout
returned to signed-out. New registration with a second Google identity remains
unverified; no personal identity or credential was fabricated for that check.

Latest checks: 40 focused backend tests, patched full-source real-PostgreSQL
rollback/idempotence/metadata/layout/price verification, backend typecheck/build;
focused frontend Google/media tests, typecheck/build/lint. The rollback preserved
all existing private records. Catalogue publication/rendering checks await import.

**Import is not approved.** Backend staging/payment guard and frontend staging
notice must be deployed before apply. No tax policies are imported; live payments
remain prohibited. Frozen sessions expiring before apply invalidate the preview;
refresh and reapprove rather than advancing dates. No users/bookings/payments
are copied. The detailed ignored preview contains every category/field/layout check.

## Historical 14 October checkpoint (superseded)

The following is retained as the earlier audit trail, including its obsolete hash,
media failures and undeployed-auth status. Use only the latest preview above.

## Verified read-only result

Snapshot captured at **21:14:22 IST**. Source is identity-verified loopback
`cinehook_dev`; destination is the pinned Neon staging target with verified TLS,
database/role/schema checks and all 15 repository migrations present.
**No Neon records were imported.** Counts below are planned inserts, not live data.

| Catalogue category | Local source | Excluded | Planned | Neon now |
| --- | ---: | ---: | ---: | ---: |
| Cities | 6,998 | 0 | 6,998 | 0 |
| Movies | 77 | 0 | 77 | 0 |
| Theatres | 3 | 0 | 3 | 0 |
| Screens | 8 | 0 | 8 | 0 |
| Physical cinema seats | 576 | 0 | 576 | 0 |
| Movie shows | 710 | 66 expired | 644 | 0 |
| Show-tier prices | 2,130 | 198 attached to expired shows | 1,932 | 0 |
| Events / sports / activities | 9 | 0 | 9 | 0 |
| Performers / participants | 3 / 6 | 0 | 3 / 6 | 0 |
| Event venues | 9 | 0 | 9 | 0 |
| Event sections | 30 | 0 | 30 | 0 |
| Physical event seats | 612 | 0 | 612 | 0 |
| Event sessions | 81 | 36 expired | 45 | 0 |
| Session-tier prices | 243 | 108 attached to expired sessions | 135 | 0 |
| Browse cards | 24 | 0 | 24 | 0 |

The nine bookable listings remain three each of Events, Sports and Activities.
Browse cards remain six each of Stream, Events, Sports and Activities. Stream
inventory remains browse-only. Existing browse-card dates are preserved, not
silently advanced. A city in the lookup directory is not a claim of local shows.

Only SCHEDULED sessions strictly after the source snapshot time are eligible.
Expired and cancelled sessions are counted separately. No show/session ID, date,
end-time snapshot, venue relationship or tier price is rewritten. A frozen plan
whose sessions expire before apply is refused and requires a new preview.

## Metadata and exact layout verification

All 77 movies retain English and Hindi descriptions, poster/backdrop URLs,
release dates, duration, languages, genres and collection membership. All 69
stored TMDB ratings retain score, votes, source URL and fetched timestamp.
Missing scores are not fabricated or relabeled IMDb. **The local source has zero
stored trailers**; all trailer fields are preserved, but no working trailers
are invented. Rating freshness remains governed by the unchanged API policy.

The report compares every projected scalar field per primary key, with
per-field difference counts and per-model SHA-256 hashes. It does not equate
matching row counts with matching metadata. Neon is empty, so its metadata and
layouts are correctly reported as missing, not falsely marked matching.

| Cinema layout | Halls | Rows | Seats per hall | Regular / Premium / Recliner |
| --- | ---: | --- | ---: | --- |
| Standard | 6 | A–F | 48 | 32 / 8 / 8 |
| Grand | 2 | A–L | 144 | 72 / 48 / 24 |

Every original seat UUID, row, seat number and tier is retained. Total tiers:
336 Regular, 144 Premium, 96 Recliner. All show prices remain ₹250 / ₹400 / ₹650
respectively, stored as integer paise. Event tiers retain the original per-session
values (Standard ₹250/₹300/₹400, Premium ₹400/₹500/₹650, VIP ₹600/₹800/₹950).
No flat-price replacement is used.

Each of the nine event venues retains its sections, ordering, positions, numbered
seats and ticket tiers. Validation checks capacity, relationships, uniqueness,
positive integer prices, tier coverage, UTC timestamps and overlapping sessions.
Hashes include every seat ID/row/number/tier, not just capacity.

The actual complete graph was inserted into a **local rollback-only transaction**
with isolated IDs, checked against real SQL constraints, read back field-for-field,
and inspected again: the repeat planned zero rows. All eight cinema layouts and
nine event layouts matched. Users/bookings/payments/refunds remained unchanged;
the entire test transaction was rolled back.

## Media review: apply remains blocked

156 distinct image/attribution assets were checked through their existing URLs:

- 117 returned successful image responses.
- 24 Wikimedia requests returned HTTP 429 (rate limited, not proven broken URLs).
- 14 TMDB/Unsplash checks had network/time-out failures; availability is unverified.
- `/provider-assets/tmdb-logo.svg` returned HTML instead of an image. The approved
  logo is absent locally as well; it must be supplied and deployed.
- All 30 Wikimedia image URLs require per-file publication-rights review.

No URL or artwork was silently replaced. The exact URLs remain in the frozen
catalogue snapshot. HEAD success establishes reachability, **not copyright rights**.
The importer refuses apply while media availability or per-file review is incomplete.
Per-file permissions belong in the ignored `.staging-parity/media-permissions.json`
as `{ "url": "...", "licenceSource": "https://...", "rightsBasis": "documented permission or applicable licence for this specific use" }`
entries in an array. Do not claim a licence without actually reviewing it.
Changing that review requires a new dry-run and approval hash.

Provider references: [TMDB non-commercial use and attribution](https://developer.themoviedb.org/docs/faq),
[Wikimedia per-file reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia),
[Unsplash license](https://unsplash.com/license). Non-commercial TMDB use requires
its approved logo and attribution notice; the existing MediaCredits component
already supplies the notice. Wikimedia hosting alone is not a blanket licence.

## Commands, frozen approval and output files

Run from `C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend`:

```powershell
npm run staging:catalogue:plan
npm run staging:catalogue:dry-run
```

The first reads only the local source, not Neon. The second reads both source
and Neon in read-only transactions and probes public media URLs. The retired
`--start-date` option is rejected: full parity does not synthesize dates.
The pinned private target remains in `.env.staging`; source `.env` is parsed
separately and never overrides the destination. Existing local seed guards are
unchanged. Connection timeout is 45 seconds for this explicit importer only.

Generated ignored artifacts:

- `backend/.staging-parity/snapshot.json`: catalogue-only frozen scalar data.
- `backend/.staging-parity/preview.json`: complete category comparison, field
  differences, metadata summary, per-venue layout hashes and media-check details.
- `backend/.staging-parity/last-attempt.json`: media diagnostics if a later
  destination connection fails; never presented as a verified database preview.

Current verified preview hash:
`9ee84224158e6839e910cfe0a92c951a2881c412e3d00ef4721ae5dc5270689b`

This is a review checkpoint, **not import authorization**. After media blockers
are resolved, rerun the preview and request explicit approval for its new hash.
The future apply command also requires `--apply --approve-write --approved-plan`
with the exact hash, deployed staging/payment guard and matching target fingerprint.
Apply uses the frozen snapshot, never a newly changed local catalogue. Changed
pending rows, permissions or expired sessions invalidate approval. Insertion and
post-insert parity/SQL checks are atomic; mismatch rolls back the whole transaction.
Existing records are never updated/deleted, and metadata drift blocks apply.

## Boundaries and verification

No local users, profile information, wishlists, password hashes, bookings,
payments, captured evidence, refunds or coupon-use history are exported. The
allowlist covers only the 16 catalogue/inventory models. Pricing policy rows are
not imported in this pass: the 12 local simulated policies remain unsuitable for
hosted production checkout under existing safeguards. Real-money payments remain
disabled by the prepared staging guard; hosted test billing needs its separate
approved configuration. No genuine GST invoice is issued.

Frontend designs, catalogue components, profile/wishlist flows, booking/Redis,
coupon, pricing and refund implementations were not redesigned. The Google GIS
initialization has a small separately tested FedCM opt-in to address the observed
legacy-popup blocker; it is not yet deployed or proven by a real Google login.

Verified: 84 focused backend tests, complete-source PostgreSQL rollback test,
backend typecheck/build and Prisma validation; 12 Google/staging frontend tests,
frontend typecheck/build/lint. No commit, push or deployment.

Independent read-only code review found no critical or important correctness/
safety issues. It did not independently verify external rights, live Google
authentication or deployed configuration; those gates remain outstanding.
