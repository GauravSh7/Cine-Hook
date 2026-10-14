# SDD ledger — plan: docs/plans/2026-10-09-redesign-plan.md

Authority: the user-supplied final redesign specification, adopted explicitly in the current request. Baseline HEAD `54ac39c18037c0ffb851c3644e267f0fc658c556`; existing dirty checkout is preserved. No new-task implementation was present at initial audit.

## Preflight interface scan

| Task(s) | Produced / consumed interface or file | Checked outcome |
|---|---|---|
| 1 | Schema, public Movie DTO, dates, seed/artwork and their tests | Consistent nullable rating/provenance; future show predicate and IST dates explicitly specified; stable original IDs preserved |
| 2 | Verified Google identity/challenge → existing AuthResult/session | Nullable hash migration owned by 1; no auto-email linking; existing JWT/current-role checks preserved |
| 3 | UI/routes consume Movie DTO, dates and GoogleSignIn | Focused shell, only-home footer, no header search and actual API source agree with tests |
| 4 | Native DB/browser/regressions and documented evidence | Only verified dev/test targets; no live-provider claim without configuration |
| 1 + 2 | Prisma schema / Google User fields | Schema/migration exclusive to 1; 2 waits for generation before full type verification |
| 1 + 2 | Backend package/env shared with optional importer | Shared files exclusive to 2; 1 sends importer npm command without editing shared files |
| 1 + 3 | Public Movie DTO, city query and IST dates | Exact contract recorded in plan; 3 owns frontend types/API; 1 owns backend implementation |
| 1 + 3 | Original cinematic artwork → UI | 1 exclusively owns demo-art assets; 3 uses safe DTO URLs, does not recreate or overwrite assets |
| 2 + 3 | GoogleSignIn → AuthPage/session | 2 owns isolated new Google files; 3 owns AuthPage and mounts the agreed props |
| 3 + 4 | Browser findings → UI fixes | Root records precise repros; UI implementer owns fixes and automated tests where applicable |

## Rulings

- Ruling: continue in the explicitly requested existing checkout, without commits or a new worktree — this preserves the user's already-integrated uncommitted modules and runnable app — copying only HEAD would lose the actual foundation; the cost if wrong is ordinary reversible file rework, not lost data.
- Ruling: execute independent implementation work concurrently only across exclusive file ownership — higher-priority proactive delegation and user single-run scope take precedence over a skill's blanket serial suggestion — the cost if wrong is an integration conflict, mitigated by explicit shared-file ownership and full verification.
- Ruling: use durable documentation/report files instead of commit-based skill scratch history — the user forbids commits and needs a learning record — the cost if wrong is extra review packaging, not missing evidence.
- Ruling: no ordinary implementation approval pauses — the user has already approved this exact written scope and asks to finish it in this run — only genuine external/safety blockers require user input.
- Ruling: use original labelled illustration fixtures with unavailable ratings until a permitted provider is configured — third-party official posters/IMDb data cannot be assumed reusable — the visible cost is illustrative rather than official film art; optional permitted TMDB import supplies provider art/ratings later.
- Ruling: existing-email Google sign-in is rejected safely rather than automatically linked — this protects password accounts, including ADMIN, without adding unrequested sensitive linking behavior — the visible cost is that existing users must continue password login until explicit linking is approved.
- Ruling: preserve existing UTC show-date contract and add a separate IST localDate query/all-date endpoint — this fixes date-pill collapse and timezone mismatch without breaking old API callers — the cost is one additive read contract.

## Baseline findings

- Existing native `cinehook_dev` was verified in the preceding connection follow-up; it has 6 movies, 42 demo shows and 288 physical seats. Fresh verification will precede writes.
- Portfolio URL opened successfully in the browser at the exact supplied address; it displays the developer portfolio. No third-party login or mutation occurred.
- Source audit found global footer/navigation on focused booking screens, static cluttered hero, header search, primary wishlist cards, capped homepage inventory, disappearing date choices, cross-show selection state and same-home logo scroll gaps.
- Fresh baseline: backend `npm test` passed 521 tests across 27 files; frontend `npm test -- --run` passed 86 tests across 9 files. Both exited 0.
- Source baseline (279 non-secret text source/reference files) recorded at `C:/Users/gaura/AppData/Local/Temp/cinehook-redesign-20261009-AuXi75/baseline-files.json` for current-task diff packaging without Git commits.
- Skill-generated brief workspace: `.superpowers/sdd/2026-10-09-redesign-plan/`; each brief includes the exact common constraints/contracts and only its own task. Durable task reports remain in `docs/plans/` per user learning requirement.

## Task status

- Task 1: implementing as `/root/redesign_catalog_implementation`; schema/generated client prepared, exact shared DTO/dates contract confirmed; final migration checks pending.
- Task 2: implementing as `/root/redesign_google_implementation`; secure Google focused tests green, optional frontend component mounted by UI task; complete verification/review pending.
- Task 3: implementing as `/root/redesign_ui_implementation`; test-first route/carousel/discovery changes underway; full suite/lint/browser review pending.
- Task 4: baseline/audit in progress.

## Database/infra baseline

- Fresh read-only identity: original `cinehook`, public schema, port 5432, 6 applied migrations, existing domain tables empty. SHA-256 row fingerprints retained without row contents/secrets.
- Fresh read-only `cinehook_dev`: port 5432, public schema, 7 migrations; users 1, movies 6, cities/theatres 3 each, screens 6, seats 288, shows 42, prices 126, zero financial/wishlist records.
- Database baseline artifact: `C:/Users/gaura/AppData/Local/Temp/cinehook-redesign-20261009-AuXi75/baseline-database.json`.
- Configuration-presence-only check: Google, TMDB, Razorpay and Cloudinary absent. No actual values were printed or modified. Live provider verification remains blocked by missing configuration; controlled provider/native tests remain possible.
- Restarted task-owned isolated PostgreSQL on loopback port 55438 and task-owned Redis on loopback 55439. Created explicitly disposable databases `redesign_core_20261009_test`, `redesign_seed_20261009_test`, `redesign_layout_20261009_test`, `redesign_ui_20261009_test`. No original/development database resets, row deletions or shared Redis flushes.

Reports and review findings will be appended without deleting earlier evidence.

## Final reconciled status — 2026-10-10

The earlier "implementing" statuses are historical. All four approved tasks are
implemented and locally verified; the root resumed and finished remaining browser
checks/documentation after the connection interruption. No new agents, commits,
worktrees, database resets or duplicated seed fixtures were required in this
continuation. Original financial/Redis source and foundation notes are unchanged.

- Task1 complete: safe movie metadata/provenance projections, selected-city
  future availability, independent IST dates, 30-film repeatable seed and
  60 original illustration assets. Eight migrations are deployed only on dev/
  isolated test targets. Provider TMDB import remains optional/unconfigured.
- Task2 complete: provider-verification boundary, unique Google subject,
  challenge/Origin/nonce checks, collision-safe account identity, frontend GIS
  component and setup/security documentation. Real Google acceptance requires
  the operator's client configuration; controlled tests are explicitly labelled.
- Task3 complete: approved carousel/rails/nav/footer, dedicated details,
  focused seats/checkout/ticket, correct unavailable actions and current API data.
  Final narrow 320px body-minimum-width defect was reproduced and corrected.
- Task4 complete: fresh 581 backend/108 frontend tests; 73 native PG/Redis tests,
  2 seed and 2 smoke tests; typechecks/lint/Prisma/builds/audits pass. Final 105
  responsive states have no page overflow. Browser flows include confirmed
  booking, cancellation, pending/complete refund, released seats, real TTL expiry,
  DOB persistence, wishlist, city/menu, carousel and accessible Offers filters.

Evidence and exact files: [handoff](../redesign-handoff.md),
[inventory](../redesign-files.md), [Google](../google-auth.md),
[responsive measurements](../verification/responsive-results.json),
[database identity/counts](../verification/database-report.json).
The initial unmigrated test-target attempt was stopped and rerun correctly;
registry errors resolved on independent audit retries. The pinned pg driver
emits a non-failing client-query deprecation warning in native tests. No fake
provider success, legal licence, deployment or production-readiness claim exists.
