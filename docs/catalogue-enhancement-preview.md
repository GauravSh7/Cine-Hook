# Additive catalogue enhancement preview

This preparation does not authorize database writes. `backend/scripts/staging-enhancement-preview.ts` has no apply mode and refuses arguments. It loads the dedicated staging target independently of the local environment, verifies the deployed backend fingerprint and staging/payment guard, verifies database/role/schema/port in a read-only transaction, and uses a connection that defaults to read-only. The local environment supplies only the TMDB token; it is never printed.

The proposal adds 12 released movies with English and provider-supplied Hindi descriptions, genuine TMDB rating/vote evidence, official TMDB-listed YouTube trailers whose oEmbed endpoint responds, and available TMDB posters/backdrops. Movies without those checks are excluded. New titles use existing supported genre/collection values and TMDB attribution. No Coming Soon movie receives a show.

The separate private artifact directory is `backend/.staging-parity/enhancement-v1/` (Git ignored). It contains a catalogue-only baseline, patch, provider evidence and preview. The original historical frozen snapshot and approval directory are untouched. No user/booking/payment rows are exported. The catalogue baseline is a comparison checkpoint, not a full database recovery backup.

Each movie receives a fictional demo show on an existing physical screen, starting two India-local calendar days after preview capture and advancing to the first free 14:00 IST slot on that screen (bounded to 30 days), with no old date moved. The script checks overlap against existing and proposed shows and copies a complete price template from the same screen. It creates no theatre, screen or physical seat. It does not change any existing movie, show, price, user or booking. Stable IDs and the existing create-only collision inspector prepare an idempotent patch; no live insert is performed to test idempotency.

## Execution and approval

Run from `backend`: `node --import tsx scripts/staging-enhancement-preview.ts`. Run only to prepare a new proposal; rerunning rechecks Neon and produces a new approval hash. Provider evidence may be reused for at most one hour only when the prior patch hash matches; older evidence is fetched again. No prior approval applies to a regenerated proposal.

The separate bounded apply entry point is prepared: `backend/scripts/staging-enhancement-apply.ts`. Its default or `--dry-run` path uses read-only transactions, rechecks media availability, live staging/payment restrictions, exact target identity, repository migrations, artifact hashes, unchanged baseline, full inventory graph, pricing templates, overlap and future dates. An exact already-applied patch is safe to replay and has zero pending inserts; any metadata drift stops it. It never updates/deletes rows. The historical full-parity importer reads the historical source and must not be used to apply this patch.

Only after explicit owner approval, this exact command from `backend` applies the reviewed proposal:

```powershell
node --import tsx scripts/staging-enhancement-apply.ts --apply --approved-hash 29d4b02bc24f35dba3b1966e41ea42453208339b301c16f6957853b628978e63
```

Apply first creates a fresh full custom PostgreSQL recovery archive in the existing private `C:/Users/gaura/.codex/private-backups/cinehook-staging/` area, applies current-user/SYSTEM-only permissions, checks the archive table of contents and fully decodes it without restoring, and records its SHA-256, byte count, target and approval hash. TLS remains `verify-full` with the existing trusted CA bundle. Credentials are passed through the subprocess environment, never command arguments or logs. Backup failure stops application. Actual restoration remains untested and is never automatic.

The bounded write transaction uses READ COMMITTED (required by existing SQL guards), the existing advisory lock, and a bounded write lock on movies/shows/show prices. It then revalidates exact baseline, database time, graph and prices immediately before create-only inserts. Constraints are forced immediate, exact rows are checked, repeat inspection must produce zero pending rows, and user/booking/payment/refund counts must remain unchanged. A verification failure rolls the transaction back. The apply branch has **not** been executed.

## Verification

- `npx tsc -p tsconfig.seed.json --pretty false`: PASS.
- `npx vitest run tests/staging-import.test.ts tests/staging-media.test.ts tests/staging-content.test.ts`: PASS, 29 tests in 3 files.
- Expanded command including `tests/staging-enhancement.test.ts`: PASS, 35 tests in 4 files. New coverage rejects missing approval hashes, baseline drift, changed replay rows, unsupported insert scope, expired dates, invented prices, overlaps and Coming Soon bookings; exact replay and JSON date restoration pass.
- `node --import tsx scripts/staging-enhancement-apply.ts --dry-run`: PASS against the verified Neon target, same approval/patch hash, exactly 12 movies + 12 shows + 36 tier prices pending, databaseWrites 0. No recovery dump is needed for this nonmutating dry-run.
- Independent combined-baseline-plus-patch validation through `buildParitySnapshot`: PASS, 89 movies, 640 future shows, 10 preserved expired shows excluded from booking projection; all catalogue references, unique identities, physical inventory capacities, complete tier prices and non-overlapping future screen intervals validated.
- Live preparation: PASS at 2026-10-15 18:50:52 UTC (16 October 00:20:52 IST), including a fresh unchanged baseline comparison and collision inspection.
- No Neon or local database writes were performed.

## Frozen proposal for owner review

| Measure | Current verified Neon | Proposed after approval |
| --- | ---: | ---: |
| Movies | 77 | 89 |
| Released movies (Now Showing classification) | 71 | 83 |
| Coming Soon movies | 6 | 6 |
| Distinct released active movies with future scheduled shows | 69 | 81 |
| All movie shows | 638 | 650 |
| Future scheduled movie shows | 628 | 640 |
| Expired movie shows, preserved | 10 | 10 |
| Show tier prices | 1,914 | 1,950 |
| Cities / theatres / screens / physical cinema seats | 6,998 / 3 / 8 / 576 | unchanged |
| Events / future event sessions / expired event sessions | 9 / 36 / 0 | unchanged |

The new shows are **18–19 October 2026, 14:00 IST**, use all eight existing screens, and expose 12 additional bookable films. “Bookable” here establishes active released movies with valid future schedule and tier inventory; a successful hosted checkout is a separate, approval-dependent verification.

The 12 titles are Forrest Gump; Voicemails for Isabelle; GoodFellas; The Godfather Part II; Remarkably Bright Creatures; The Wild Robot; Swapped; The Godfather; Avatar Aang: The Last Airbender; Gladiator; Back to the Future; Spider-Man: Into the Spider-Verse. Metadata is TMDB's current response at evidence capture, including provider titles and release dates.

New genre assignments: Action 3, Adventure 6, Animation 4, Comedy 3, Crime 3, Drama 7, Family 2, Fantasy 2, Mystery 1, Romance 2 and Science Fiction 3. All additions are in the existing `recommended` and `popular` collections. No invented rating, trailer, genre or release date is introduced. All 12 have Hindi and English descriptions and verified poster/backdrop/oEmbed responses. Existing movies have 0 missing posters, 0 missing backdrops, 0 missing Hindi descriptions and 15 missing trailer IDs; this additive patch preserves them.

- Target fingerprint: `b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a`
- Catalogue baseline hash: `370226b6eeaa8776359110cad3fb69a1674e4d4728ce18e37ae518108f31a08e`
- Additive patch hash: `63414f31d98f926558a60b934cfa62326e71dcbf6e398e971d643731041f336b`
- Approval preview hash: `29d4b02bc24f35dba3b1966e41ea42453208339b301c16f6957853b628978e63`

An earlier unapproved preview scheduled after the catalogue's final December show; it was superseded by this October proposal. Only the hashes above describe the current proposal.

Trailer availability means the public oEmbed response succeeded at the recorded time; browser playback, region restrictions and provider changes still need hosted verification. Existing catalogue media is counted for missing fields; this preview does not claim every older trailer plays. Fictional showtimes require the application's existing demo disclosure and should never be represented as real cinema schedules.
