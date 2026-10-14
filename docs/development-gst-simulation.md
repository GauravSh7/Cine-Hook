# Development-only GST calculation — 13 October 2026

## Scope and what works

Normal React checkout on localhost:5173 now obtains simulated cinema quotes
from the existing authenticated quote/coupon APIs. Show Bill renders server
amounts, explicitly says **simulated calculation — not a GST tax invoice**, and
shows all seven requested lines including zero discount. Normal provider payment
is disabled: no capture, actual money or real GST collection is enabled.

FIRST50 and SAVE10 retain their approved server-only discount/reservation rules.
FIRST50 is permanently consumed only by captured provider evidence, including
later cancellation/refund. Controlled tests exercise those flows separately.
An unpaid preview can still be cancelled using the existing backend endpoint.

Comedy, sports, activities and other events have no development cinema policy.
Their ordinary checkout remains blocked pending category-specific contracts.
Isolated event fixtures in existing tests are not an approval of those categories.

## Explicit TEST assumptions (not certified liability)

- ShowSeatPrice/BookingSeat prices are GST-inclusive, integer paise.
- Cinema bracket is selected **per original inclusive ticket**, before coupon:
  <=10000 paise uses 500 basis points; above uses 1800. A coupon never changes
  that bracket in this test rule. This is NOT a legal conclusion about thresholds.
- Coupons are modelled as supplier-funded discounts at supply time, recorded
  in the financial breakdown. Platform/bank reimbursement is not modelled.
- Extract included GST per discounted ticket: round-half-up
  `discountedPaise * rateBps / (10000 + rateBps)`. Never add it again to payable.
- Discount allocation uses the existing deterministic largest-remainder method;
  per-ticket rounding can differ from an aggregate rounding by a paise.
- Platform fee is separately 700 paise; TEST SAC 998554 reservation service
  assumption uses 1800 basis points, adding 126 paise. Neither registration nor
  applicability to an actual CineHook business is certified.
- Both supplies use fictional same-state code 29 solely as a calculation
  fixture. This does not assert a supplier's location, registration or place of
  supply. It is deliberately not derived from browsing city/account address.
- Policy reference effective date is 22 September 2025, IST. Both verification
  flags remain false. Simulation kind/rule/funding/SAC are persisted in JSON.

## Official references and unresolved questions

The official [PIB 5 October 2025 static factsheet](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/oct/doc2025105657401.pdf)
describes cinema tickets <=Rs100 reduced from 12% to 5%. The regional page link
in the earlier tax document was unreliable and has been corrected to this PDF.
The [CBIC service schedule](https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html)
lists above-Rs100 cinema admission at 18% and other support services at 18%;
its below-Rs100 entry is stale (12%), so it is not our source for the 2025 cut.
[GST Council 56th-meeting FAQ](https://gstcouncil.gov.in/sites/default/files/2025-09/faq_0.pdf)
supports the service-change effective date, 22 September 2025.

[Government SAC mapping](https://content.dgft.gov.in/Website/Purpose%20Code%20and%20SAC%20Code%20Mapping.pdf)
identifies 998554 as reservation services for entertainment/event/cinema tickets.
This classification reference plus heading 9985's rate explains the fee TEST
assumption; it does not decide composite supply, exemptions or actual liability.

[CBIC discount guidance](https://cbic-gst.gov.in/hindi/sectoral-faq.html)
requires qualifying before/at-supply discounts to be recorded in an invoice.
It does not conclusively settle whether these coupons change the Rs100 cinema
rate threshold or how third-party-funded offers affect consideration. Those
questions require notified rules and actual supplier/funding facts before any
real-business configuration; our test rule is explicitly different from a claim
of verified law. An order summary is not the statutory invoice cited by that law.

The [8 October 2026 57th GST Council release](https://www.gstcouncil.gov.in/sites/default/files/2026-10/press_release.pdf)
was checked: its service recommendations do not specify cinema admission or
SAC998554 rate changes. Council recommendations are not automatically effective
amending notifications. No October cinema/fee rate or effective date was invented.

## Architecture and boundaries

`Route -> auth/current-user/validation -> PricingController -> PricingService
-> PricingRepository -> Prisma -> PostgreSQL` is unchanged. Preview composition
is restricted to development + loopback cinehook_dev:5432 and checked against
actual database name/port. Default repositories reject simulation configuration.

PaymentRepository's default pricing context remains verified. It checks stored
quote provenance for both NEW and EXISTING reservations before provider orders.
A frozen simulation cannot be reused by the real provider. Reads preserve frozen
totals but report payment availability for the current context. Controlled
context is explicitly injected only by the existing isolated test infrastructure
and requires its pricing *_test database on port55438. No client paid flag,
signature bypass or public confirmation endpoint was added.

The setup command only inserts missing theatre policies after verified local
database identity. It preserves any existing policy, quote, payment, seat price
and user. It is explicit, never automatically run in production, and repeatable.
No schema/migration change was necessary; policy metadata uses existing JSON.

## Local preview launch (PowerShell)

Backend terminal:

```powershell
cd 'C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend'
npm run dev:db:check
npm run dev:pricing:simulate
npm run dev:billing-preview
```

Frontend terminal:

```powershell
cd 'C:\Users\gaura\OneDrive\Desktop\Cine-Hook\frontend'
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://localhost:5173. PostgreSQL5432 and Redis6379 must already run.
`dev:billing-preview` blanks only the CHILD PROCESS Razorpay config; the ignored
`.env` credentials are untouched. This avoids starting an incomplete provider
configuration while the real webhook secret is absent. Normal `dev:populated`
still requires a complete Razorpay key group if any provider key is configured.

## Actual normal-API bill verification

Authenticated booking/coupon requests against cinehook_dev returned HTTP200:

| Line | Amount |
|---|---:|
| Two original inclusive tickets | Rs500.00 |
| SAVE10 ticket-only discount | -Rs50.00 |
| Discounted inclusive tickets | Rs450.00 |
| Included admission GST (not added again) | Rs68.64 |
| Ticket base within Rs450 | Rs381.36 |
| Platform fee | Rs7.00 |
| Simulated fee GST | Rs1.26 |
| Final calculated payable | Rs458.26 |

Response `simulated:true`, `paymentAllowed:false`. Attempting a provider order
returned HTTP503/PAYMENTS_UNAVAILABLE, with no Payment created. The one explicit
administrator-owned verification booking was cancelled through the backend and
its seats released; it remains as cancellation history, not deleted.

Before/after configuration, the original 34 bookings and associated financial
rows had the same SHA256 snapshot:
`91dad9baa9782ce994c35dd608505b54c00294d5a789da652e8f3efacc6b9bf0`.
A separate user-created booking appeared during execution; it was not touched.
Installer first run added3/retained0; repeat run added0/retained3.

## Targeted verification and files

45 backend unit tests across pricing, controlled-provider boundaries and
development launcher; 23 frontend billing/booking-flow tests; 20 actual
PostgreSQL/Redis integration results, no skips/failures. Coverage includes mixed
brackets, original-price rule, odd paise, coupon concurrency, immutable totals,
invalid signature, repeat verification, refunds, cancellation/payment races,
existing simulated reservation rejection and event misclassification rejection.
Backend/frontend typechecks and builds, Prisma validate/generate pass. No
unrelated full suite or extensive browser sweep. Integration output has an
existing pg client-query concurrency deprecation warning; no failing assertion.

Changed/created:

- backend/src/modules/pricing/{pricing-engine.ts,pricing.repository.ts,pricing.test.ts,cinema-simulation.ts}
- backend/src/modules/payments/payment.repository.ts, backend/src/server.ts
- backend/scripts/{dev-pricing-simulation.ts,dev-launch.ts}, backend/package.json
- backend/tests/{pricing.integration.mjs,dev-seed.test.ts}
- frontend/src/api/pricing.ts, frontend/src/components/CheckoutPricing.tsx,
  frontend/src/pages/CheckoutPage.tsx
- frontend/tests/{pricing.test.tsx,booking-flow.test.tsx}
- docs/{development-gst-simulation.md,tax-configuration-required.md,implementation-progress.md,ui-integration.md}

Actual Razorpay remains blocked by missing webhook secret and unapproved real
business tax configuration. Controlled tests use private generated test evidence
and the existing provider transport; there are no real provider network charges.
Verification databases are retained, not reset/deleted. No commit/push/deploy.
