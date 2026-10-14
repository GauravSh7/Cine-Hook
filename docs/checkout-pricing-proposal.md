# Checkout pricing contract approved 2026-10-12

Requested on 2026-10-12: first-booking offer, server-side coupon application,
GST, Rs 7 platform fee and an itemised Show bill control.

Proposed v1 implementation:

- FIRST50: 50% off the ticket subtotal on the user's first successfully paid
  booking, no cap. One qualifying booking across movie and event bookings.
- Reserve eligibility durably so concurrent pending bookings cannot both use
  the first-booking offer. Failed unpaid bookings release eligibility. A captured
  payment consumes it, including subsequently refunded payments.
- Optional second offer SAVE10: 10% off ticket subtotal, capped at Rs 100.
  One coupon per booking; no stacking.
- Platform fee: Rs 7 per booking. Discounts do not apply to the fee.
- Freeze the server-calculated quote before provider order creation; reject
  coupon changes once an order exists. Keep immutable financial breakdowns.
- Persist subtotal, discount, taxable bases, tax rates/amounts, platform fee,
  final amount and coupon identity. Razorpay receives only the persisted total.
- Show bill renders the persisted server breakdown. Full-refund v1 policy
  continues to refund the trusted captured total, including fees and taxes.
- Use explicit admission tax classification, effective date and inclusive vs
  exclusive price basis. Never infer one rate for every sport or activity.
- No unverified extra government tax or cess will be invented.

Approved decision: current ShowSeatPrice/EventSessionPrice values are
GST-inclusive ticket prices, deduct the ticket discount, extract included GST
under the configured admission classification, and add the Rs 7 platform fee
plus its applicable tax as separate lines. This preserves advertised ticket
prices and avoids silently adding admission GST a second time.

Government references to verify during implementation:
https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163560
https://gstcouncil.gov.in/sites/default/files/2025-09/faq_0.pdf

Implemented contract, configuration requirements and fresh verification are in
`docs/checkout-pricing.md`. Existing bookings and payment evidence retain their
original amounts. New checkout fails closed without operator-reviewed tax settings.
