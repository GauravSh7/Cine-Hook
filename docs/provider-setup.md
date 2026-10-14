# CineHook — add your provider credentials later

This is the single operator checklist for optional integrations. No real key is
included here or in committed source. Blank optional values deliberately disable
the corresponding integration; they never simulate a successful provider action.
An API credential is not a copyright/data licence. Confirm the provider's terms
for your intended usage separately. Do not put secrets in browser code or VITE_*
variables, send them in chat, or commit them.

## Where to put values

Edit your existing ignored file:
`C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend\.env`.

Use `backend/.env.example` as a list of names only. Do not copy it over your
existing `.env`: that would replace the working database/signing configuration.
All optional provider entries in the example are blank. Keep actual existing
credentials if you already configured any; this refinement does not erase them.
Restart the backend after editing environment settings.

| Integration | Exact backend variable(s) to fill | Enables | If blank |
| --- | --- | --- | --- |
| Google Identity Services | `GOOGLE_CLIENT_ID` | Real provider-verified Google sign-in | Email/password still works; Google shows unavailable |
| TMDB | `TMDB_READ_ACCESS_TOKEN` | Explicit server-side movie artwork/rating/trailer import | Demo art stays labelled; ratings/trailers unavailable |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Orders, backend capture verification, raw webhooks and refunds | Real checkout fails closed, no fake success |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Authenticated, validated profile-image uploads | Profile text/wishlist work; image upload fails closed |

### Google

Create a Web OAuth client in your own Google Cloud project. Configure the exact
authorized JavaScript origin you use, normally `http://localhost:5173`. Put its
client ID in `GOOGLE_CLIENT_ID`. This GIS ID-token flow does **not** require a
Google client secret in the frontend, and does not use an OAuth redirect handler.
Keep `FRONTEND_ORIGIN` aligned. The backend validates Google signature, issuer,
audience, expiry, verified email, Origin/CSRF and challenge nonce. Existing
password accounts are not silently linked by email or promoted to ADMIN.
See [Google auth details](google-auth.md).

### TMDB and media rights

Obtain an API Read Access Token from your TMDB account API settings and put it in
`TMDB_READ_ACCESS_TOKEN`. The app never sends this token to a browser. For the
educational/non-commercial developer API, comply with TMDB's current attribution
and usage requirements; commercial usage needs the appropriate provider agreement.

Before importing or publicly using TMDB content, download an **approved TMDB
logo yourself** from its official logos/attribution page and save it at:
`frontend/public/provider-assets/tmdb-logo.svg`.
The directory's README explains this intentionally empty asset slot. Do not use
an improvised logo. The details page's About & media credits section displays it
only for movies using TMDB data and includes the required attribution notice.
If the asset is absent, the section explains the setup gap instead of claiming
the branding is complete. No unlicensed source logo is shipped.

Import one exactly matched movie, after configuration:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
npm run catalog:import:tmdb -- --movie-id <existing-movie-UUID> --tmdb-id <verified-TMDB-film-ID>
```

Use an existing UUID from `GET /api/movies?limit=100` and the exact TMDB film ID
you verified by title, release year and original language. Angle-bracket arguments
are instructions, not literal PowerShell input. The importer checks all three
against returned provider data before updating. It rejects wrong-film responses,
unsafe image paths, bad scores and invalid video keys; network failures preserve
existing metadata. Missing trailers do not invent video IDs. It accepts only
official=true YouTube Trailer entries from the selected film's TMDB videos API.

Ratings are source-labelled TMDB on a 0–10 scale with votes/source/timestamp and
a seven-day visibility cache. Expired or unavailable ratings show unavailable.
Movie imports are explicit; adding a token alone does **not** fetch data for all
30 movies. Rerun the import for each verified film ID as needed. Approved image
and video rights are still your responsibility; no generic LICENSE_KEY variable
can grant those rights. The UI uses a click-open YouTube privacy-enhanced player,
with close/Escape/focus restoration and an official external-watch fallback.
Actual playback can still be restricted by the uploader or region.

IMDb/Rotten Tomatoes numeric ratings are not imported by the current adapter.
Their authorization cannot be replaced by an undocumented scraping-service key.
If you later obtain authorized access, approve a dedicated adapter before adding
those scores. Current licensing references:
[IMDb](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX),
[Rotten Tomatoes](https://www.rottentomatoes.com/help_desk/licensing),
[TMDB FAQ](https://developer.themoviedb.org/docs/faq).

### Razorpay

Fill all three Razorpay values together. Start with your own test-mode keys.
`RAZORPAY_WEBHOOK_SECRET` is the separate secret configured for your Razorpay
webhook destination, not the API key secret. Endpoint:
`POST /api/webhooks/razorpay`. A provider cannot call a bare localhost URL; set up
your own approved HTTPS test tunnel/provider-accessible destination separately.
Do not deploy, create a tunnel or charge real money just to test the UI.
Server-stored booking amounts/signatures/provider evidence remain authoritative.
See [payments](payments-webhooks.md) and [refunds](cancellation-refunds.md).

### Cloudinary

Fill the cloud name, API key and API secret from your own account. Signed uploads
go through the backend with authenticated ownership and safe size/image limits;
no secret is required in frontend code. Do not configure an unsigned public
upload preset as a workaround. See [profile/wishlist](account-wishlist.md).

## Required local settings (not optional provider licences)

Existing `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET` must remain configured for
the app. Preserve the working values; the example's blank JWT field is not a
runtime default. Generate a strong JWT signing secret locally only if setting up
a new environment. `JWT_SECRET` is CineHook's signing key, not a Google secret.
`DEV_ADMIN_PASSWORD` is needed only on first dev ADMIN creation and must never
reset an existing administrator's credentials. Current development data lives in
`cinehook_dev` on port 5432. Guarded dev commands derive/check that identity;
do not run a reset against the original `cinehook` database.

## Safe local setup / restart

For additive migrations and development content (repeatable):

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\backend"
npm run dev:db:check
npm run dev:db:migrate
npm run db:generate
npm run db:seed:dev
npm run dev:content:seed
npm run dev:populated
```

In another terminal:

```powershell
cd "C:\Users\gaura\OneDrive\Desktop\Cine-Hook\frontend"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. For an ordinary restart after changing a key, just
restart the backend with `npm run dev:populated`; rerun migrations/seed only when
needed. Keep PostgreSQL/Redis and the two app processes running. No provider
credential is necessary to browse demo content, use email/password auth, edit
profile text, save wishlist or inspect supported movie booking state.

## Still deliberately deferred

Dedicated physical event/comedy/sports bookings now share the movie payment and
refund backend. Real provider delivery still requires the blank Razorpay slots
and an approved reachable webhook setup; controlled local fixture success is
not proof of an account test-mode or real-money payment.
Read-only sample activities, streaming playback/subscriptions and the real chatbot
remain unavailable and have no dedicated key slot. Offers
collect no card/bank/UPI account data and contain no invented bank promotions.
Do not add a random key and expect those unimplemented products to become live.

## Checkout pricing configuration (not a license key)

FIRST50 and SAVE10 are implemented and require no third-party license key.
New checkout also requires verified admission/fee classifications, effective
dates and supplier/place-of-supply state codes. Those facts cannot be replaced
with an API key or inferred from browsing location. Start with the intentionally
blank/disabled `backend/prisma/pricing-tax.example.json`; reviewed imports use
`PRICING_TAX_CONFIG_FILE` and `npm run dev:pricing:configure`. See checkout-pricing.md.
Without that configuration new checkout remains safely disabled. Existing
booking/payment prices are unchanged. Razorpay test credentials remain necessary
for genuine provider checkout; no real payment or webhook delivery was tested.
