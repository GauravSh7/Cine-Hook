# Hosted Razorpay TEST checkout

Hosted checkout can use only Razorpay TEST credentials and the exact approved
Neon target. The published backend remains in catalogue staging mode;
`newPaymentsAllowed` stays false for live payments. The separate
`testPaymentsAllowed` status is true only when the explicit hosted TEST flag is
enabled and all startup checks pass.

## Render configuration

Keep `STAGING_CATALOGUE_MODE=true`. Set `STAGING_RAZORPAY_TEST_CHECKOUT=true`
only after the TEST credentials and webhook are configured in Render. The
backend also requires `NODE_ENV=production`, the hard-coded approved target
fingerprint, complete `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
`RAZORPAY_WEBHOOK_SECRET`, and a key ID beginning `rzp_test_`. Any missing or
mismatched condition prevents startup. A live key is rejected.

The `.env` on a developer machine is not used by Render. Add the same TEST API
key ID, API secret, and webhook secret in Render's private environment settings;
never add these values to Git, Vercel `VITE_*` settings, or chat. For hosted
payment recovery, the Razorpay TEST webhook must deliver to
`https://cinehook.onrender.com/api/webhooks/razorpay` with the six existing
payment/refund events. If a separate webhook endpoint is created, save that
endpoint's generated secret in Render.

## Simulated tax settings

The staging database receives the exact 12 non-verified pricing policies from
the guarded local `cinehook_dev` database: one policy per 3 theatres and 9
supported Events/Sports/Activities listings. This does not verify GST liability.
Pricing and discounts are calculated on the backend in integer paise. Existing
payments, bookings, quotes, coupon reservations, seat prices and users are not
changed. FIRST50 and SAVE10 retain their existing server-side rules.

After deploying the code and enabling the Render flag, first preview the
configuration from the repository root's backend directory:

```powershell
npm run staging:pricing:sync
```

The preview must show database fingerprint
`b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a`, 3 movie
targets, 9 event targets, and 12 policies to create (or exact matching rows to
retain). Only then apply:

```powershell
npm run staging:pricing:sync -- --apply
```

The command rechecks local and Neon database identity, the deployed API's
TEST-only status and target fingerprint, then inserts missing policies in one
transaction. It never overwrites a differing policy. Test receipts are not GST
tax invoices, and live payments remain disabled.
