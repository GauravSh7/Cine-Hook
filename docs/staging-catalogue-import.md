# Staging catalogue import

**Current workflow:** [Full-parity preview and commands](staging-parity-preview.md).
The CLI now reads the actual local catalogue, not the original static fixture.
The sections below describe the historical first preparation only; its
`--start-date` commands and 30-film counts are retired and must not be used.

## Diagnosis and current status

Render readiness reports PostgreSQL and Redis up. Cities, movies, theatres,
shows, events and all four browse-category endpoints return successful empty
lists. The same endpoints through Vercel return successful empty lists, so the
observed problem is missing catalogue records, not a demonstrated routing fault.

The importer is prepared locally. **Zero Neon records have been imported.**
The cloud dry-run stopped safely because dedicated staging credentials/target
settings have not been supplied. No commit, push or deployment was performed.

## Initial dataset

**Superseded for complete hosted parity:** the read-only local audit found
77 movies, 6,998 cities and 8 screens. The static counts below describe only the
initial importer fixture, not the complete local application. Do not apply this
plan as a complete parity import. See [hosted parity checkpoint](hosted-parity-checkpoint.md)
for actual counts, metadata/media gaps and the Google dashboard blocker.

| Records | Planned count |
| --- | ---: |
| Cities / theatres / screens | 3 / 3 / 6 |
| Movies | 30 |
| Physical cinema seats | 576 |
| Future cinema shows / show-tier prices | 126 / 378 |
| Bookable event listings / venues / sections | 9 / 9 / 30 |
| Physical event seats | 612 |
| Event sessions / session-tier prices | 63 / 189 |
| Browse-only category listings | 24 |
| Event performers / participants | 3 / 6 |

This initial import uses the original static 30-film manifest, not a copy of
the expanded local database. Venues and event/session inventory are fictional;
the staging UI identifies this explicitly. Cinema halls have 48 or 144 seats.
Seven upcoming days are generated from the explicitly chosen start date.
Stream listings are browse-only, not invented bookable streams.

Movie images use bundled original CC0 SVG compositions documented in
`frontend/public/demo-art/README.md`, not official movie posters. Existing stock
photo references use the [Unsplash license](https://unsplash.com/license).
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) does not waive trademark
or publicity rights; this inventory must not imply endorsement or real events.
No missing ratings or trailers are fabricated.

## Safety boundaries

- Existing local-development seed scripts and their guards are unchanged.
- No users, passwords, administrator accounts, bookings, payments, refunds,
  coupon redemptions or tax policies are imported.
- No updates, deletes, resets or schema migrations: only missing catalogue rows
  are created. Existing metadata, prices and statuses remain unchanged.
- Conflicting natural keys, changed layouts/parents or extra physical inventory
  abort the import. Seat layouts cannot be extended underneath existing sessions.
- Dedicated direct Neon endpoint, exact host/database/role, verified TLS and
  actual database identity are checked. No fallback to ordinary `DATABASE_URL`.
- Dry-run is a read-only transaction. Apply uses one atomic transaction and
  advisory lock; existing SQL constraints remain authoritative.
- Apply requires explicit approval and the exact dry-run plan hash. Changed
  data, target or date invalidates that plan and requires a new preview.
- Errors expose fixed safe messages/names/codes, not credentials or raw errors.

## Private setup and deployment prerequisite

From `C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend`:

```powershell
Copy-Item staging-import.env.example .env.staging
```

Privately populate the ignored `.env.staging` file. Set the dedicated
`STAGING_DATABASE_URL` to the intended **direct** Neon connection using
`sslmode=verify-full`; fill matching `STAGING_EXPECTED_HOST`,
`STAGING_EXPECTED_DATABASE` and `STAGING_EXPECTED_ROLE`. Keep
`STAGING_IMPORT_ENV=staging` and the supplied backend origin. Do not paste
credentials into chat. The importer never loads the ordinary backend `.env`.

Before applying, publish this safety patch and deploy both applications. In
Render, enable `STAGING_CATALOGUE_MODE=true` and leave
`DEV_RAZORPAY_TEST_CHECKOUT=false`. Staging mode blocks all new payment orders,
including live-key orders; existing verification, webhooks and refund processing
remain intact. No new migrations are needed. Use the existing deployment build
and start commands. The frontend deployment adds the staging inventory notice.

`GET /api/catalogue/status` must report staging mode, new payments disabled,
and a target fingerprint matching the importer. This fingerprint includes no
password. Apply refuses to proceed without this deployed safeguard.

## Preview, approval, apply

Choose a date at least tomorrow in India; use the identical date for all steps.
The example below must be refreshed if it is no longer in the future.

```powershell
npm run staging:catalogue:plan -- --start-date 2026-10-15
npm run staging:catalogue:dry-run -- --start-date 2026-10-15
```

The first command is an offline plan, **not** database verification. The second
verifies the cloud identity and completed migrations and reports missing-row
counts, target fingerprint and plan hash without writes. Review these results
and obtain explicit user approval before running:

```powershell
npm run staging:catalogue:apply -- --start-date 2026-10-15 --approve-write --approved-plan <dry-run-plan-hash>
```

If the preview changes, rerun the dry-run and obtain approval for the new plan.
A repeat dry-run after successful application should report zero missing rows
for the same date window. Never reuse an old apply hash to bypass a changed plan.

## Verification evidence

- 93 focused backend tests passed, including target/TLS guards, dry-run,
  idempotence, collisions, payment blocking, payment and refund regression tests.
- Real local PostgreSQL transaction created the complete graph, checked SQL
  constraints, read 14 catalogue API routes, verified repeat import adds zero,
  and rolled back. User/booking/payment counts remained unchanged.
- 34 focused frontend tests passed, including staging notice, discovery,
  location, categories and movie media.
- Backend/frontend typechecks and builds, frontend lint and Prisma validation
  passed; `git diff --check` passed.
- Local transaction API reads produced a pg single-client parallel-query
  deprecation warning; tests passed. No production repository behavior changed.

Populated **deployed** browsing, city selection and availability checks remain
pending private target setup, safety-patch deployment and approved Neon import.
