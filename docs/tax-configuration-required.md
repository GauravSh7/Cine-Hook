# Checkout tax configuration required — 12 October 2026

## 13 October 2026 update — approved development simulation

The zero-policy inspection below is historical. `cinehook_dev` now contains
three **development-only cinema simulation policies**, not verified business
policies. Admission `verified` and `feeVerified` remain false. Normal frontend
movie checkout can preview a server-generated simulated bill and apply coupons;
normal provider payments remain disabled. No event policy was added. See
[development-gst-simulation.md](development-gst-simulation.md) for assumptions,
commands, actual bill and targeted verification. Existing financial rows were
not rewritten and no schema migration was required.

Verified against the guarded local `cinehook_dev` database on port 5432:
`pricing_tax_policies` contains **0 rows**. All three cinema theatre targets and
all nine bookable event targets lack a matching operator-reviewed policy. This
is not a missing API/license key and is not fixed by retrying checkout.
No tax policy was fabricated or imported during this change.

## Official classification evidence

- Cinema admission of Rs100 or less: 5% from the 2025 reform.
  [Government PIB factsheet PDF](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/oct/doc2025105657401.pdf).
  The former regional page link did not reliably expose the cited cinema
  passage; use this official static publication instead.
  Above Rs100: 18%, as established by the
  [Government cinema rate announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1557063).
- The effective date of the 2025 service changes is 22 September 2025.
  Specified IPL-like sporting admission is 40%; other/recognised sporting
  admission is exempt at tickets not exceeding Rs500 and 18% above that threshold.
  [Official GST Council/Ministry of Finance FAQ](https://gstcouncil.gov.in/sites/default/files/2025-09/faq_0.pdf).
  This does not certify the seeded sports events as recognised sporting events.
- The CBIC schedule lists other support services under heading 9985 at 18%
  (9% central + 9% state). This is a possible classification to review, not proof
  that CineHook's particular platform fee legally falls under that heading.
  [Official CBIC service-rate schedule](https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html).
- Comedy admission/workshops need their own actual service classification,
  exemption and supplier review. Do not infer exemptions or an IPL-like rate
  from a UI category, sport name or development listing.

The approved inclusive-ticket engine extracts admission GST; it does not charge
it a second time. Platform fee tax is separate. No order summary is presented
as a statutory GST invoice. Business-specific applicability must be reviewed
against the notified rules and actual time/place of supply before activation.

## Exact configuration missing

For each target supply: `classification`, `effectiveFrom`, `effectiveTo`,
`verified: true`, `source`, and a named `verifiedBy` reviewer.
Confirm the real admission supplier, registration/tax treatment and legal place
of supply; then populate `supplierState` and `supplyState` with actual GST state
codes. Browsing-city selection must never determine these values.

Separately confirm the platform fee supplier, registration, SAC/service
classification, exemption if any, rate and place of supply. Populate
`feeRateBps`, `feeSource`, `feeVerified: true`, `feeSupplierState`, `feeSupplyState`.
The current validated importer accepts a reviewed 0 or 1800 basis-point fee
rate; if another classification requires a different rate, obtain a contract
change rather than force an incorrect supported value.

Those verification fields describe actual business review and must not be set
true just to unblock a portfolio checkout. The separately approved simulation
uses explicit provenance and guarded development/test contexts, not these flags.

There must be exactly one verified, non-overlapping policy effective for each
target. Unsupported/unverified/missing classification remains blocked.

### Existing target IDs

Movie policy target is the **theatre**, not a movie/show UUID:

| Theatre | targetId |
|---|---|
| Bengaluru | `768ea4d4-7c5f-54e6-a784-b67c23dceb53` |
| Delhi | `5a145786-6dba-58bf-adbc-4b5933b5f680` |
| Mumbai | `d497cb79-5199-5311-a66b-4efc8908a69a` |

Event policy target is the **event**, not a session/venue UUID:

| Event | targetId |
|---|---|
| Cloudstep Hoops vs Indigo Orbit | `0bf23c98-cca5-5ea4-afe4-9b5e68c7a310` |
| Kavya Paperkite | `4564ac30-393b-52f7-abec-846c14f9a873` |
| Lantern Rovers vs Harbour Mosaic FC | `0c7b645d-47fc-54d6-a668-dfe268a0b9fb` |
| Meera Cloudstep | `53e35342-f421-5e2c-a3d2-779d23f68509` |
| Paper & Light Bengaluru | `c15905b6-ca0d-5a37-a0ae-71eb3b02667f` |
| Paper & Light Mumbai | `b3dd7761-92c3-5b4f-a5df-6f456d49f3cb` |
| Paper & Light New Delhi | `b1b9a0fa-8ebe-5506-af35-fac6ce816ef3` |
| Paperkite XI vs Copper Comets XI | `82caaffb-cb4b-578b-a75a-bd4e14e09cb0` |
| Rohan Lantern | `2c3da434-7f36-5bb1-a9d5-b5df639970a5` |

## Setup after actual review/approval

Copy `backend/prisma/pricing-tax.example.json` to a private JSON file; replace
all placeholders with reviewed facts and add one object per target. Do not
simply flip verification flags or reuse a ticket supplier's state for the fee.
In PowerShell:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
$env:NODE_ENV = 'development'
$env:PRICING_TAX_CONFIG_FILE = 'C:\absolute\path\reviewed-tax-settings.json'
npm run dev:pricing:configure
```

The command validates input and checks the actual database identity before
upserting policies into cinehook_dev. It preserves frozen quotes and financial
history; no reset, deletion or production automatic configuration.
Razorpay credentials/webhook setup is a separate gate in `provider-setup.md`.
