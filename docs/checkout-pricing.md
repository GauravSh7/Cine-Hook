# Checkout pricing — approved v1 implementation

## Flow and immutable history

GET `/api/bookings/:id/quote`; PUT `/api/bookings/:id/coupon` with only
`{"code":"FIRST50"}`, `{"code":"SAVE10"}` or `{"code":null}`. Both require
JWT, a current authenticated user and booking ownership; coupon mutation also
checks the live hold through BookingService/EventBookingService.
Route → authentication/validation → PricingController → PricingService →
PricingRepository → Prisma/PostgreSQL. The shared payment repository freezes
the quote in its short order-reservation transaction, before provider HTTP.

Booking.totalPaise and BookingSeat/EventBookingSeat prices remain the original
ticket subtotal. Existing SQL constraints require those immutable snapshots to
agree. Additive BookingPricingQuote stores the new final payable and full JSON
breakdown instead of modifying booking history. New repository-created bookings
use pricingVersion=1; existing version-zero bookings retain exactly their prices,
without new fees/coupons. Payment.amountPaise equals the frozen quote for v1 and
the original booking subtotal for v0. Capture verification and refunds continue
using authentic persisted payment/evidence amounts, including fees and taxes.

## Offers and concurrency

FIRST50 discounts ticket subtotal by 50%, no cap; SAVE10 discounts 10%, capped
at 10,000 paise. One coupon only. A user-row lock serializes all first-offer
reservations across movies and events. An issued payment on another checkout
blocks FIRST50 until its outcome can safely be established. While FIRST50 is
reserved, another booking cannot start payment first. A frozen reservation
cannot be transferred, including through direct SQL. Captured financial evidence
permanently consumes eligibility via a database trigger, independent of booking
fulfillment/refund. Historical capture evidence is also checked on eligibility.

A failed/expired hold without a payment record releases its reservation lazily
on the next eligibility attempt. Removing an unfrozen coupon releases it too.
Provider failure or lost acknowledgement alone does NOT prove an issued order
cannot capture later: retain that reservation. No provider-specific order-closure
mechanism is invented; uncertain issued orders require reconciliation.

## Tax configuration: deliberately not fabricated

Cinema: the government-issued 15/2025-CTR amendment takes effect 22 September
2025 and reduces the <=Rs100 admission bracket to 5% total GST. Above Rs100
remains 18%; classification is per discounted, inclusive admission ticket.
Verified sporting classifications can select exempt <=Rs500/18% above, or the
40% IPL-like classification. Event/workshop exemptions or 18% classifications
must be reviewed for each actual event; no blanket category-to-rate mapping.
The engine supports these classifications but does not certify seeded events.

Sources: [2025 government notification text](https://taxo.online/wp-content/uploads/2025/09/15-2025-CTR-eng.pdf)
(original government document, hosted mirror because CBIC fetch failed),
[GST Council government FAQ](https://gstcouncil.gov.in/sites/default/files/2025-09/faq_0.pdf),
[cinema bracket baseline](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1557063),
[CBIC service-rate schedule](https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html).
The notified support-service rate is 18%; applying that classification to this
supplier's Rs7 fee still requires explicit operator review/registration facts.
Fee verification/source and legally relevant supplier/place-of-supply state
codes are separate from admission settings and browsing city.

PricingTaxPolicy is operator-only, keyed by theatre/event and effective period.
Exactly one valid policy must match. Missing, unverified or overlapping policy
blocks new checkout. No real issuer/state/GST registration has been supplied,
so cinehook_dev tax policies remain EMPTY. This is the external configuration
blocker, not a claim that real-money tax compliance is complete. Checkout bills
are order summaries, NEVER official GST invoices.

Fill a private copy of `backend/prisma/pricing-tax.example.json` with reviewed
target UUIDs, sources, state codes and verification fields. The example defaults
are intentionally invalid. In backend PowerShell:

```powershell
$env:PRICING_TAX_CONFIG_FILE='C:\absolute\path\reviewed-tax-settings.json'
npm run dev:pricing:configure
```

This verifies cinehook_dev on local port5432 before importing; rejects production,
unknown target IDs, arbitrary fields/rates and unverified policies. No secret
or tax configuration is automatically created or applied to production.
Razorpay credentials/webhook delivery remain a separate provider-setup gate.

## Rounding and actual test bill

Integer BigInt paise throughout; half-up rounding for aggregate coupon and tax.
Allocate aggregate discount proportionally with largest remainders and stable
ticket-ID tie breaking. Extract each ticket's included GST as
round(inclusivePaise*rateBps/(10000+rateBps)); taxable base is the remainder.
Intra-state component splitting assigns an odd tax paise to the state component;
inter-state settings select IGST. Fee GST is calculated separately on 700 paise.
All line totals reconcile exactly. Frozen policy/breakdown is retained.

Actual persisted isolated-server test: two Rs200 tickets, FIRST50 → Rs200
discount; discounted tickets Rs200; included cinema GST Rs9.52, base Rs190.48;
platform fee Rs7, fixture-verified fee GST Rs1.26; Razorpay order/refund total
Rs208.26. This uses explicit test supplier settings, NOT invented live tax details.

## Files and verification

New: modules/pricing engine/test/repository/service/controller/routes; two
20261012 additive migrations; dev-pricing-tax script/example; pricing integration
runner/tests; frontend pricing API/component/CSS/tests. Changed: schema, server,
app, movie/event booking creation, payment reserve, npm scripts, checkout,
BookingFacts/history, OffersPage, shared async resource and relevant UI fixtures.
UI/media changes: FeaturedCarousel/HomePage, CategoryPage/ListingPage,
experience-media, main CSS import, catalogue-media and guarded seed manifests/core.

Final test/build counts are recorded in implementation-progress.md. The test
runner requires a fresh suffix and verifies the isolated PostgreSQL55438 role,
creates a new test DB, migrates and retains it; it never resets/deletes a DB or
flushes Redis. Temporary Redis is55439/DB15, separate from app Redis6379.

12 October follow-up: no-order checkout cancellation releases FIRST50 immediately;
late captured evidence on cancelled/failed bookings atomically seeds full refund
obligations before returning. Issued/uncertain orders remain reserved until a
terminal provider outcome can be established. See checkout-cancellation-scrolling.md
and tax-configuration-required.md for the approved implementation and live blocker.
