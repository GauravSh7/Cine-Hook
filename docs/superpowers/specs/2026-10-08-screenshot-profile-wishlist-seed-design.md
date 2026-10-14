# Approved screenshot UI / Profile / Wishlist / Development seed

Source: user approval on 2026-10-08 and the eight attached screenshots.
Existing repository/dirty changes remain in place; no Git mutations or destructive
data operations. Synced sources and historical foundation stay unchanged.

## Contracts

Preserve Route -> Middleware -> Controller -> Service -> Repository -> Prisma ->
PostgreSQL, all booking/Redis/payment/refund semantics, and the existing stack.
The screenshots supersede MagicPath visually. Dark teal-black cinematic surfaces,
red/white brand, shared search/location/menu/category navigation, image-led movie
cards, footer, account sidebar and two-column auth are the primary composition.

Account supports authenticated edits to name, DOB and phone, read-only email and
Cloudinary photo replacement. Store DOB as DATE and derive age. Optional fields
are nullable; phone is unverified/nonunique, not a login identity. Define public
DTOs explicitly: never leak passwordHash or provider asset identifiers. Avatar
uploads accept only decoded JPEG/PNG/WebP, maximum 3 MiB, maximum 16 million
pixels and 4096 pixels per edge, re-encoded/metadata-stripped before Cloudinary.
Authenticate before multipart parsing, one file, bounded fields/body and provider
timeout. No browser URL or userId accepted. Missing provider config fails closed.

Movie Wishlist is persisted/owner-scoped/duplicate-safe, independent of bookings.
Active existing movies may be saved; saved disabled movies remain removable and
unavailable. GET list defaults 20/max100; GET status plus idempotent PUT/DELETE
per movie. Client controls no owner or copied movie metadata.

Movies/location/shows/seats/auth/history/checkout/refunds remain functional.
Stream/Events/Sports/Activities use screenshot-consistent cinematic layouts with
explicit unavailable states, no invented live inventory or watch/book buttons.
Offers has All/UPI/Net Banking/Credit Card/Debit Card filters and truthful no-offers
state, no discounts/redemptions or financial-details storage. Help & Support is
only a clearly labelled future chatbot placeholder, following latest approval.
No social login, reset, remember-me, notification/card/address/security settings
are simulated. Existing admin remains usable. All pages responsive/accessibility.

## Development target / seed

Use existing verified local PostgreSQL service on port5432 and a separate database
named cinehook_dev. Verify server/database identity before any migration/seed.
Preserve cinehook and every existing record. Do not assume port5434 exists.
Use additive migration deploy only, never reset/db push. Secrets stay local and
must not be printed, committed or entered in chat.

Explicit development-only seed outside runtime src; stable manifest IDs and
natural-key reuse; missing rows only, no password reset or existing USER promotion.
Real movie metadata/matching HTTPS posters; real cities, clearly demo theatres;
48 complete physical seats per screen; actual-duration future rolling seven-day
shows with per-type positive integer-paise pricing. Same-day reruns are identical;
later runs append upcoming dates while preserving booked/past/cancelled shows.
READ COMMITTED and serialized seeds; verify existing layouts without seat writes
after scheduling; collision/incompatible data aborts. One dedicated dev ADMIN is
created from a secure prompted password, never hardcoded/logged. No payment,
booking or refund seed, no simulated checkout in development.

## Verification

TDD for new contracts, input/security/ownership and provider failure boundaries;
real PG seed-twice/preservation/concurrency tests; frontend API/layout/profile/
wishlist/empty-category tests. Full tests/typechecks/lint/Prisma validate/generate/
deploy/status/builds/audits. Actual Express/browser journeys and mobile/tablet/
desktop QA. Document exact files/APIs/models/commands and external limitations.
