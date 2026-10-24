# Local development and deployment

Current setup guide for `76c42a74`. Older module documents preserve dated
checkpoints; they are not current installation instructions. No hosted commands
in this guide are permission to change the deployed application.

## Prerequisites

- Node.js 24.14+ within 24.x and npm; separate `backend/` and `frontend/` packages.
- PostgreSQL on loopback port **5432**, with permission for `citext` and
  `btree_gist`; Redis on the address configured privately in the backend.
- A separate database **cinehook_dev**, owned by your local application role.
  Create it through your local administrator if absent. Never reset/recreate an
  existing database or repurpose the original `cinehook` database.
- Optional infrastructure: `docker compose up -d redis` starts only local Redis
  if 6379 is free. Do not start Compose PostgreSQL over an existing 5432 service.
  Compose's optional backend profile is not the guarded populated setup below
  and does not forward all provider credentials.

## 1. Install and configure privately

```sh
git clone https://github.com/GauravSh7/Cine-Hook.git
cd Cine-Hook/backend
npm ci
```

Copy [`.env.example`](../backend/.env.example) to `backend/.env` **only if no
configuration exists already**. Set your local connection credentials, Redis URL
and a private signing key. The example's local database credentials are examples,
not working hosted credentials.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the generated value as `JWT_SECRET` in the ignored file, not in Git or
browser configuration. Keep `NODE_ENV=development`, `PORT=4000`,
`FRONTEND_ORIGIN=http://localhost:5173`, `JWT_EXPIRES_IN_SECONDS=86400`.
Use `AUTH_TRUSTED_PROXY_CIDRS=` empty; `AUTH_OTP_RATE_LIMIT_MODE=mailbox-budget`
with `AUTH_OTP_DAILY_EMAIL_BUDGET=240` is the approved bounded hosted-style option.
The sample's `network` mode remains suitable only where socket identity is useful.
Do not enable broad proxy trust.

`DATABASE_URL` must describe a loopback PostgreSQL connection on 5432 for these
commands. The development launcher derives **cinehook_dev** without changing your
file; an explicit `DEV_DATABASE_URL`, if supplied, must already name cinehook_dev.
It verifies the actual database/schema/server port before running operations.

## 2. Generate, migrate and populate only the isolated local database

From `backend/`, stop on any failed command:

```sh
npm run db:generate
npm run dev:db:check
npm run dev:db:migrate
npm run db:seed:dev
# Optional supported event inventory and simulated TEST pricing:
npm run dev:events:seed
npm run dev:pricing:simulate
npm run dev:populated
```

The base seed inserts missing movie/venue/layout/show fixtures using stable
identities and guarded transactions. It is repeatable and preserves existing
records. It is **not** a clone of the enriched hosted catalogue, accounts or
financial history. No seed runs in migrations or application startup. TMDB import,
larger-hall and city expansion tools are separate deliberate operations; review
their target guards and media terms before use.

The first base seed prompts privately for an administrator password and does not
ship a default password. **Important compatibility limit:** its historical
`admin@cinehook.local` fixture is not an email-ownership bypass and is not promised
to authenticate under the current verification rules. A working verified admin
requires separately reviewed local provisioning; do not disable OTP or promote
public registrations. For ordinary booking, register a mailbox you control.

## 3. Start the frontend

In another terminal, from `frontend/`:

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to
`http://localhost:4000`; there is no required frontend `.env.example` or API key.
Both processes must remain running. On later restarts, use `dev:populated` and the
frontend dev command; migrations/seeding are not required every time.

## 4. Provider-dependent features

| Feature | Backend-only settings and prerequisites |
| --- | --- |
| Registration/ownership/reset OTP | `BREVO_API_KEY`, `PASSWORD_RESET_FROM`, optional `PASSWORD_RESET_FROM_NAME`; active verified sender, deliverable mailbox and provider quota. Uses HTTPS API, not SMTP. Without mail configuration, new password registration/recovery cannot complete. |
| Google | `GOOGLE_CLIENT_ID`; Google Web client authorized JavaScript origin must match `FRONTEND_ORIGIN` exactly, such as `http://localhost:5173`. Use the existing nonce/CSRF flow; do not add unsafe email auto-linking. |
| Avatar | Complete `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` group. Server validates JPEG/PNG/WebP and a 3 MiB limit. |
| Enrichment | `TMDB_READ_ACCESS_TOKEN` for guarded explicit import tools, not browser card calls. Retain TMDB attribution and source rights. |
| Razorpay TEST | Complete `RAZORPAY_KEY_ID` with `rzp_test_` prefix, `RAZORPAY_KEY_SECRET`, separate `RAZORPAY_WEBHOOK_SECRET` of at least 32 characters. Configure a signature-preserving HTTPS endpoint for `/api/webhooks/razorpay`. |

No private value belongs in `VITE_*`: frontend environment values are public.
Never substitute live Razorpay keys to make a failed TEST configuration start.

For local simulated TEST checkout, after the guarded pricing setup, replace the
backend launcher with **`npm run dev:razorpay-test`**. It requires non-production,
loopback cinehook_dev:5432, TEST credentials and valid webhook configuration.
`npm run dev:billing-preview` deliberately blanks provider settings at runtime
and is preview-only. A pricing setup command does not itself enable payment.
Supported webhook events are `payment.captured`, `order.paid`, `payment.failed`,
`refund.created`, `refund.processed`, `refund.failed`. Do not return a fake 2xx
from a relay or skip raw-body signature validation.

## Checks and database safety

```sh
# backend/
npm run db:validate
npm run typecheck
npm test
npm run build
npm run test:smoke
# frontend/
npm run lint
npm run typecheck
npm test
npm run build
```

Mutating integration suites need explicitly migrated **disposable** PostgreSQL
databases and isolated Redis. They may skip without their environment variables;
skip is not PASS. Reproduce the target identities/ports/roles in
[the CI workflow](../.github/workflows/ci.yml), not the hosted `.env`.
`test:integration`, `test:ownership:integration`, `test:rate-limit:integration`
and pricing checks have different target guards; consult their actual scripts.
No full test suite is necessary merely to read this documentation.

## Hosted deployment overview

Render builds [backend/Dockerfile](../backend/Dockerfile), generates Prisma and
compiles TypeScript; runtime is **`npm start`**. Vercel builds `frontend/` and
uses [API/SPA rewrites](../frontend/vercel.json). Provider/environment settings on
Render are separate from local `.env` files. Keep automatic deployments paused
unless separately approved.

Migration workflow: verify exact database identity, inspect pending migrations,
take/verify recovery backup, establish maintenance and approve the exact set;
then run `npm run db:deploy` only on that target. It applies **all** pending
migrations. Never use reset, seed or `migrate dev` against Neon. Release compatible
backend/frontend, verify guard/readiness, reconcile deferred webhooks, then reopen
only under approval. See [recovery](testing-and-recovery.md) and
[operations](pointer2-operations.md). No deployment was performed for Pointer 4.
