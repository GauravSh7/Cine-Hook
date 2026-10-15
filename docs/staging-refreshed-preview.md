# Refreshed staging catalogue preview — 15 October 2026

**Subsequently explicitly approved and imported unchanged.** Actual database
readback and hosted verification: [completed import](staging-import-completed.md).
This document preserves the pre-import frozen preview and approval boundary.

Captured at **14:32:56 IST** using the identity-verified local source database
clock. Neon inspection ran read-only with its pinned identity/TLS safeguards;
all 15 migrations are present. **No Neon catalogue records were written.**

## Hashes and approval boundary

**Approve this import-plan hash** (the CLI's approved-plan value):
`6d8a50830de10b8446e70a35bc892a2f9e45f3008d53ba3f99e2fdb79034469f`

Frozen catalogue data hash (sourceHash):
`ab3521da98f04ce100423285f830c0ea1bf08e9c4f375c317c37327a91f9d000`

The plan binds the target, frozen catalogue, pending inserts, media checks and
review evidence. The old approved snapshot/preview were archived under the
ignored `.staging-parity/approved-713fc4a935ff/` directory, not deleted.
The refreshed ignored snapshot.json and preview.json now await explicit approval.

## Final counts

| Category | Planned | Neon now |
| --- | ---: | ---: |
| Cities | 6,998 | 0 |
| Movies | 77 | 0 |
| Theatres | 3 | 0 |
| Cinema screens | 8 | 0 |
| Physical cinema seats | 576 | 0 |
| Future movie shows | 638 | 0 |
| Movie show-tier prices | 1,914 | 0 |
| Bookable Events/Sports/Activities | 9 | 0 |
| Performers / participants | 3 / 6 | 0 / 0 |
| Event venues | 9 | 0 |
| Event sections | 30 | 0 |
| Physical event seats | 612 | 0 |
| Future event sessions | 36 | 0 |
| Event session-tier prices | 108 | 0 |
| Browse cards | 24 | 0 |

Across the original source, 72 expired movie shows/216 attached prices and 45
expired event sessions/135 attached prices are excluded. Compared with the
previous approved frozen snapshot, the only removals are six movie shows,
18 show prices, nine event sessions and 27 session prices. No dates shifted.

## Preservation and verification

- Exact digest comparison against the previous snapshot passed for every
  non-session catalogue group. Every retained session and price row is identical.
- All 77 bilingual descriptions, posters/backdrops and movie metadata remain;
  69 rating tuples and 62 verified trailers remain. Eight scores and fifteen
  trailer gaps remain absent rather than fabricated. Original seat IDs, rows,
  categories, capacities, per-tier prices and venue relationships remain intact.
- Integrity checks passed for relationships, unique keys, overlaps, capacity,
  seat layouts, tier coverage and integer-paise prices.
- All 186 media assets passed; no outstanding Wikimedia review entries.
- Forty targeted safety/content/media/import/payment-guard tests passed.
- Full 77-movie/6,998-city actual PostgreSQL rollback test passed: exact patched
  metadata/layout/price readback, SQL constraints, repeat plans zero inserts,
  private record counts unchanged, entire transaction rolled back.
- Additional staging integration passed real SQL constraints, idempotence,
  city/movie/show/event/session API reads and private-table preservation, with
  unconditional rollback. It emits the previously documented pg parallel-query
  deprecation warning; no test failed and runtime code was not changed.
- Live backend reports staging, newPaymentsAllowed=false, correct fingerprint,
  PostgreSQL up and Redis up. No simulated tax policies imported or payments enabled.

## Apply gate after approval

At verification, the earliest remaining session starts **18:00 IST today**.
This is not a promise to import an expired snapshot later: immediately before
writing, revalidate identity, current database contents, all frozen hashes and
session times inside the existing guarded apply path. Any changed hash or newly
expired session must stop the import; no automatic date adjustment or replacement.

Existing recovery archive/checksum remain documented in staging-release-status.md.
Do not reset tables, overwrite existing catalogue records, import local private
records or relax payment restrictions. After a successful approved import, verify
actual Neon counts, exact metadata/layouts/prices, repeat-zero planning and the
populated hosted website. Those post-import checks have not happened yet.
