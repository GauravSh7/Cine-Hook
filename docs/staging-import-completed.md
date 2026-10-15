# CineHook staging catalogue imported — 15 October 2026

## Approved import and recovery

Imported only the frozen catalogue approved under plan hash:
`6d8a50830de10b8446e70a35bc892a2f9e45f3008d53ba3f99e2fdb79034469f`.
Data hash remains:
`ab3521da98f04ce100423285f830c0ea1bf08e9c4f375c317c37327a91f9d000`.

Before writing, verified exact Neon identity/fingerprint, live staging/payment
guard, healthy PostgreSQL/Redis, unchanged plan/data/media-review hashes and
unexpired future sessions. The private pre-import recovery archive checksum
and complete archive read were checked again. Its location/checksum remain in
staging-release-status.md. No restore, table reset, deletion, date shift or local
private-record import was performed.

## Actual Neon record counts

Independent post-commit read-only verification at **15:00:47 IST**:

| Model | Actual records |
| --- | ---: |
| City | 6,998 |
| Movie | 77 |
| Theatre | 3 |
| Screen | 8 |
| Physical cinema Seat | 576 |
| Show | 638 |
| ShowSeatPrice | 1,914 |
| Event | 9 |
| EventPerformer | 3 |
| EventParticipant | 6 |
| EventVenue | 9 |
| EventSection | 30 |
| EventSeat | 612 |
| EventSession | 36 |
| EventSessionPrice | 108 |
| Browse listing | 24 |

Every model matched the approved projection with zero missing/different/extra
rows. Exact metadata, bilingual descriptions, all poster/backdrop references,
69 rating tuples, 62 trailer IDs/source evidence, dates and tier prices matched.
All eight cinema layouts and nine event venue layouts matched their hashes.
SQL constraints were forced immediate before commit. Repeat inspection would
insert **zero rows in every model**; no second write/import was used to prove this.
Private counts remained one user and zero bookings/payments/refunds. No profile,
password, wishlist or financial record was copied from the local application.

## Importer-only defects corrected during execution

Initial failed attempts rolled back completely. Safe diagnostics and rollback
probes isolated two defects; the approved data/hash never changed:

1. Prisma queryRaw cannot decode the void result of pg_advisory_xact_lock.
   The same lock now uses executeRaw; its keys and transaction lifetime are
   unchanged. The real-database regression verifies the lock is actually held.
2. Existing show/layout SQL guards require READ COMMITTED (the original shows/
   seats migration explicitly rejects other write isolation). The importer had
   used REPEATABLE READ for both dry-run and apply. Apply now uses READ COMMITTED;
   read-only previews keep REPEATABLE READ. A shared transaction-options function
   makes the full rollback test exercise the same options as the CLI.

No trigger was disabled or altered. Advisory serialization, database constraints,
create-only inserts, collision checks, approval/identity checks and final parity
verification remain active. Booking/Redis/payment/refund implementations were
not changed. Safe phase and Prisma-code diagnostics were added without raw error
messages, connection strings or catalogue/private row dumps.

Regression evidence: full patched-source real PostgreSQL rollback test passes
with the CLI lock and write options; repeat-zero and exact readback/private-count
checks pass; 40 targeted tests, backend typecheck/build and diff checks pass.
Failed diagnostic transactions were rolled back; no partial catalogue remained.

## Live website and API checks

Verified through the actual Vercel hostname:

- Movie API returns all 77 movies; homepage displays populated cinematic cards,
  categories, original provider artwork and TMDB-labelled scores.
- City search finds Muzaffarnagar. The existing location control offers all
  states; choosing Bengaluru filters supported theatre/sports inventory.
- Queen detail renders English and Hindi text and loaded poster/backdrop images.
  Future-date selection filters its Bengaluru shows correctly.
- Grand Screen 144 renders 72 Regular, 48 Premium and 24 Recliner seats. Selecting
  A1 shows the stored ₹250 seat estimate; deselection restores ₹0/disabled Continue.
  No booking or Redis hold was created by this browser check.
- API seat availability returns 144 seats for a grand hall and 48 for a standard
  hall. Sports availability returns 96 numbered seats. The live sports arena
  renders numbered North-stand seats; selecting A1 updates the estimate to ₹300,
  and deselecting restores ₹0/disabled Continue. No reservation was submitted.
- All nine bookable Events/Sports/Activities and 36 future event sessions are
  served. Sports browser navigation opens Cloudstep Hoops vs Indigo Orbit and
  future Bengaluru sessions priced Standard ₹300/Premium ₹500/VIP ₹800.
- Each browse category (Stream/Events/Sports/Activities) returns six retained
  cards. Stream remains browse-only, not invented bookable inventory.
- Live staging mode and disabled new payments remain active; PostgreSQL/Redis
  readiness is healthy. Existing signed-in session remains usable.

Ignored detailed evidence: `.staging-parity/import-verified.json` and
`.staging-parity/live-api-verification.json`. The frozen preview is retained,
not regenerated after applying (which would replace the approved evidence).

## Remaining gaps

Eight movies have no imported rating; fifteen have no supported official trailer,
as individually documented in staging-media-review.md. No values were fabricated.
Existing-user Google login/session/logout passed earlier hosted acceptance;
new-user registration with a separate identity is still not independently tested.

No tax policies were imported. Hosted checkout, coupon/bill generation requiring
those policies, Razorpay payment completion, paid booking confirmation/refunds and
official invoicing are NOT enabled or claimed as verified. Real payments remain
disabled. A separately approved hosted TEST-only financial configuration is needed
for those flows; the catalogue import does not authorize relaxing financial rules.
The current frontend design was not changed.
