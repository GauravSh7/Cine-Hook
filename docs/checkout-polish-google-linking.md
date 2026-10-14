# Checkout polish and secure Google linking — 13 October 2026

## Delivered

New simulated cinema bookings created after the development policy activation
waive the 700-paise platform fee and its 126-paise simulated GST. The bill shows
the original ₹7 struck through and green Free; its payable amount genuinely
excludes both charges. Activation is set once by `dev:pricing:simulate`, using
the database clock. Re-running the installer retains that timestamp. Existing
bookings and frozen quotes keep their original financial breakdown unchanged.

Admission taxes are grouped by component and rate instead of repeating each
ticket's CGST/SGST rows. The compact Test bill / Not a tax invoice label remains:
these assumptions cannot be represented as actual GST liability. A short note
explains that rates may change and that this bill uses test assumptions.

Checkout uses Pay within for the countdown and displays the full physical
screen layout below booking facts. Selected seats are highlighted; the preview
is read-only, scrollable and does not imply payment confirmation or claim other
seats are available. Physical seats come from the existing catalog API.

## Google account linking

Sign in with the existing password, open Account Info, enter the current
password and choose Link Google account. Select the Google account with the
same verified email. Future Google logins resolve to the original user ID.

`POST /api/auth/google/link` requires the application JWT, current user check,
strict validation, trusted Origin, challenge cookie/CSRF/nonce, verified Google
signature/claims and bcrypt password proof. The service checks ownership and
the repository conditionally updates only googleSubject, comparing the current
password hash and existing identity atomically. Unique subject constraints
prevent linking one Google identity to multiple users. No account is merged by
email alone; role, profile, password and booking relationships remain intact.

Incorrect password or invalid provider evidence returns a retryable 403 rather
than logging out a valid application session. Invalid application JWT remains
401. Editing the password abandons any outstanding provider attempt. Passwords
and Google credentials are never written to browser storage.

## Files

- backend/src/modules/pricing/{pricing-engine.ts,pricing.repository.ts,pricing.test.ts}
- backend/scripts/dev-pricing-simulation.ts
- backend/prisma/migrations/20261013000100_simulated_platform_fee_waiver/migration.sql
- backend/src/modules/auth/auth.routes.ts and auth/google/{google.types.ts,google.repository.ts,google.service.ts,google.controller.ts,google.routes.ts,google.middleware.ts}
- backend/tests/{pricing.integration.mjs,google-auth.test.ts,google-auth.integration.mjs}
- frontend/src/api/{pricing.ts,google.ts,client.ts}
- frontend/src/components/{CheckoutPricing.tsx,CheckoutSeatPreview.tsx,BookingFacts.tsx,GoogleSignIn.tsx}
- frontend/src/pages/{CheckoutPage.tsx,AccountPage.tsx}
- frontend/tests/{pricing.test.tsx,booking-flow.test.tsx,google-auth.test.tsx}

## Verification and limits

Safe additive constraint migration applied only to verified cinehook_dev on
5432; three existing development policy settings gained activation timestamps,
without modifying booking/payment/quote records. No reset or original cinehook
database changes. Integration tests ran against a fresh isolated `_test`
database on 55438 and Redis 55439, never personal data.

21 pricing integration results passed, including waived order capture/refund,
immutable frozen amount, coupon concurrency and payment/cancellation races.
Google PostgreSQL integration passed: wrong password rejection, competing
identity links (one success, one conflict), idempotent same-subject retry and
preserved user ID/profile/role/password. Frontend focused tests, typechecks,
builds and lint pass; backend focused tests, typecheck/build and Prisma
validate/generate pass. Existing pg query-concurrency deprecation warning remains.

Actual Google account interaction requires the user's own password/provider
selection and was not performed on their behalf. Provider-boundary tests use
controlled evidence. Actual Razorpay payments remain disabled: webhook secret
and verified real-business tax requirements are still missing. Normal frontend
shows the server bill preview, not a working real-money payment button.

No commit, push or deployment. Foundation history remains unchanged.
