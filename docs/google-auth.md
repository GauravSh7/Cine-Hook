# Google authentication

## Hosted checkpoint — 14 October 2026

The deployed origin restriction was reproduced and the owner added the hosted
origin to the matching Google Web client. A later real Chrome inspection found
Google's `Failed to open popup window` errors, including after the owner allowed
site popups. No successful sign-in/session/logout is claimed.

Prepared a small frontend change: GIS initialization opts into
`use_fedcm_for_button: true` with `button_auto_select: false` and `auto_select: false`.
Modern Chrome can mediate the account chooser instead of relying on a legacy
popup. Older browsers follow GIS fallback behavior. Nonce, CSRF challenge,
cryptographic verification, identity matching and application JWT flow are unchanged.
See [Google's official FedCM migration guide](https://developers.google.com/identity/gsi/web/guides/fedcm-migration).
The new option has a failing-then-passing boundary/lifecycle test, but requires
frontend deployment and a real account-selection/session/logout acceptance check.
No browser security setting was disabled globally or modified by the agent.

The original implementation notes below remain historical where superseded.

Local implementation checkpoint: 2026-10-10. Provider credentials are absent;
the real Google popup/account journey has not been claimed as tested.

## Request flow

1. `GET /api/auth/google/config` returns `{ clientId: string | null }`.
   Without configuration the UI explains that email/password must be used; it
   does not load a pretend Google button or create an identity.
2. `POST /api/auth/google/challenge` accepts only `{}` from the configured
   frontend Origin. It issues a signed five-minute HttpOnly/SameSite challenge
   cookie and returns `nonce`, `csrfToken` and `expiresAt`.
3. Google Identity Services receives the public client ID and nonce. Its
   credential callback sends `{ credential, csrfToken }` to
   `POST /api/auth/google`. This is a JSON callback flow, not Google's HTML
   form-post integration; the application owns its CSRF/nonce challenge.
4. Route -> Origin/content/challenge middleware -> GoogleAuthController ->
   GoogleAuthService -> Google verifier / GoogleUserRepository -> Prisma ->
   PostgreSQL. The official `google-auth-library` verifies Google's signature;
   the service independently checks audience, issuer, expiry, issued time,
   verified email, nonce and stable `sub` identity.
5. The service returns the existing CineHook JWT/public-user contract.
   `SessionProvider` uses the same protected `/me` and current database role
   checks as password login. Provider credentials and hashes are not returned.

## Persistence and safety

- `User.googleSubject` is nullable and unique; `passwordHash` is nullable for a
  Google-only account. Password registrations still require bcrypt hashing.
- Google creation can only create a USER. There is no client role selection.
- Returning Google users are identified by verified `sub`, never by email alone.
- An existing email/password account is **not automatically linked**. A safe
  collision message directs that user to password login, including for ADMIN.
- Concurrent identical Google registrations converge on one subject record;
  mismatched subject/email conflicts cannot take over another account.
- Challenge cookies are bounded, signed, Origin/client scoped and cleared when
  consumed/abandoned. They are stateless: this is not a globally single-use
  replay cache. A stolen valid token **and** challenge can be replayed within
  their remaining validity window. No process-memory auth state was added.
- Production requires HTTPS. No Google access/refresh token is stored; this is
  sign-in only, not access to the user's Google APIs.

## Configure locally

Create/configure your own Google OAuth **Web application** client. Add
`http://localhost:5173` as an authorized JavaScript origin, matching the existing
`FRONTEND_ORIGIN`. If intentionally using 127.0.0.1 instead, authorize that exact
origin and align backend configuration; the two origins are not interchangeable.
The popup credential-callback implementation does not invent a redirect route.

In the ignored backend configuration, set `GOOGLE_CLIENT_ID` to your issued web
client ID, then restart `npm run dev:populated`. This ID is public configuration,
not a client secret. Do not put Google secrets in frontend/VITE variables.
Keep the existing private JWT secret private. Do not share credentials in chat.

Verify the config response, Google popup, new-user sign-in, returning-user
sign-in, password-account collision and `/me` on your own configured account.
Our local controlled-verifier/JWKS tests cover validation/races but are not a
substitute for this provider-configured acceptance test.

## Files and tests

### Hosted acceptance — 15 October 2026

Owner-approved frontend-only commits `4d12b6b` and `194e948` were pushed to main.
The served Vercel entry contains the FedCM opt-in and mounted media credits;
the official logo returns image/svg+xml. From a signed-out hosted Login page,
Continue with Google rendered the provider account control, activation signed
into CineHook, reload retained the authenticated account menu, and Logout
returned to the Login link. No password/email entry or security bypass was used.
No new-account registration with a second Google identity was performed; that
acceptance case remains unverified. Existing nonce/CSRF/account-link safeguards
are unchanged. Fifteen focused frontend Google/media tests and builds passed.

Backend: `src/modules/auth/google/` (challenge, middleware, routes, controller,
service, repository, types, verifier), existing AuthService/routes, configuration
and server wiring. Frontend: `api/google.ts`, `domain/google-identity.ts`,
`components/GoogleSignIn.tsx`, AuthPage and sanitized API error mapping.
The exact redesign inventory is in [redesign-files.md](redesign-files.md).

Unit tests cover invalid/expired/audience/issuer/nonce claims, cryptographic
verification failures, Origin/CSRF rejection, unavailable configuration, subject
races, email collision, lifecycle cancellation and preserved session roles.
`npm run test:integration` includes the Google PostgreSQL suite;
`GOOGLE_AUTH_TEST_DATABASE_URL` must explicitly name a migrated loopback `_test`
database. Never point tests at a personal/development data database.

Primary reference: [Google server-side verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## 14 October 2026 — Login-only Google control and verified existing-account link

Supersedes the Account Info placement below: Google is offered only on Login.
An already-linked Google subject signs in directly. A new verified Gmail
identity can link to the same exact existing email, and a Google Workspace
identity can do so only when its verified hosted-domain claim matches that
email's domain. The repository updates only the matching user's empty Google
subject; password hash, account ID, role and booking history stay intact. An
identity already owned by another account cannot be linked. Other email domains
use the existing fresh-password-confirmation route. Provider account selection
and final session acceptance still require the user's click.

13 October 2026: existing password accounts can explicitly link a verified
same-email Google identity from Account Info, with authenticated ownership and
fresh password confirmation. No email-only auto-linking. See
checkout-polish-google-linking.md for the protected endpoint, atomic identity
update, retry behavior and PostgreSQL concurrency verification.
