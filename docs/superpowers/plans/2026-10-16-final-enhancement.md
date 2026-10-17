# CineHook final enhancement and verification plan

Goal: complete the existing portfolio application, fix password reset, improve venue presentation, prepare additive catalogue data and record independent hosted evidence.

Architecture: retain Route → Middleware → Controller → Service → Repository → Prisma. Redis owns temporary recovery tokens and abuse limits; passwords stay bcrypt hashes in PostgreSQL. Provider mail delivery is behind an interface. Existing financial and seat allocation services remain authoritative.

User brief: attachment 115fc10c-bd65-4a70-a85c-8e9d42d826fa. Independent execution is explicitly requested; owner approvals remain required for Neon catalogue writes and hosted payment configuration changes.

- [ ] Trace forgot-password and implement expiring single-use recovery, neutral responses, reset abuse limits, safe mail adapter and frontend forms. Test token reuse, expiry, concurrent requests, validation and failure delivery; configure no credentials automatically.
- [ ] Improve cinema and cricket presentation using exact existing seats, tiers and IDs; verify keyboard and responsive behavior.
- [ ] Align cancellation backend/UI to age strictly under 24h, before start and not on the current Kolkata show date. Preserve compensation. Label simulated receipts.
- [ ] Prepare 12 additive TMDB films plus nonoverlapping future shows. Verify read-only baseline, metadata, prices, media, relationships and approval hash. Prepare create-only apply and recovery; stop before Neon writes.
- [ ] Run complete unit/component suites, isolated database/Redis integrations where available, lint/typechecks/Prisma/builds and secret checks. Fix actual defects and identify test-only failures accurately.
- [ ] Inspect deployed pages/APIs and use isolated test users for authorized registration/session/booking checks. Do not claim personal Google login or payment capture without observed evidence.
- [ ] Produce docs/CINEHOOK-FINAL-VERIFICATION.md with PASS/FAIL/BLOCKED/NOT TESTED evidence, exact commands, counts, deployment state and remaining setup. Deploy authorized code only after checks; verify the served release.

Review focus: recovery links never enter logs or query strings; concurrent resets cannot both update a password; mail failures do not disclose account existence; cancelled-booking timers stop immediately; catalogue replay adds zero and never modifies private records.
