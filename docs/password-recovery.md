# Password recovery

Added 17 October 2026. Existing users, bookings and payment records are preserved. No database migration is required.

## Setup still required

The owner confirmed no email provider is configured. The UI and backend flow are implemented, but real email delivery remains unavailable until both settings below are privately configured on Render (and locally if desired):

```dotenv
RESEND_API_KEY=
PASSWORD_RESET_FROM=
```

Create a Resend account, verify a sender domain you own, create a sending API key, and use an email address from that verified domain for PASSWORD_RESET_FROM. Save the values privately in Render Environment and redeploy. The FRONTEND_ORIGIN must be the intended frontend origin, currently https://cine-hook-xi.vercel.app. Never put private keys in frontend variables or Git. Provider setup: https://resend.com/docs/api-reference/emails/send-email.

Before mail is configured, requesting a reset returns PASSWORD_RESET_UNAVAILABLE for every address. The frontend displays the unavailable message rather than claiming an email was sent.

## Request flow

Login → Forgot password → POST /api/auth/forgot-password → origin/body validation → controller → recovery service → repository lookup. A cryptographically random link expires after 15 minutes. Redis stores only its SHA-256 digest and an HMAC credential fingerprint; raw links are never returned through the API or written to application logs. Account-specific requests are limited to five per hour; the coarser network bucket is 1,000 per hour to tolerate a shared reverse proxy. Responses do not disclose whether a password account exists. Google-only accounts keep Google sign-in.

Delivery runs asynchronously so provider latency does not reveal account existence. The API accepts a request without guaranteeing inbox delivery. Sending is best-effort; an interrupted process can require requesting a new link. There is no durable email queue. Delivery failures log a fixed event with no recipient, token, provider response or key.

The link uses /reset-password#token=… so the token is not included in server request URLs. The reset page removes the fragment after reading it, uses no-referrer, and never forwards the token to Google or another external asset.

Reset form → POST /api/auth/reset-password → validation → controller → atomic Redis GETDEL → credential fingerprint check → bcrypt cost 12 → shared session revocation → PostgreSQL conditional password replacement. The conditional update prevents different recovery links from concurrently overwriting each other. Reset does not sign the user in automatically. Temporary failures after token consumption require a new link.

Access tokens created by password login include a server-signed credential tag. Middleware checks it against the current database credential, including logins racing a reset. Old sessions are revoked in Redis for the maximum token lifetime. Existing signed tokens remain schema-compatible; their normal expiry still applies. A Redis outage fails session checks closed with a safe temporary-unavailability error.

## Verification

Targeted backend tests cover safe unavailable responses, password hashing, single use, expiry, invented tokens, changed credentials, concurrent resets, neutral provider failures, Google-only accounts, token revocation and a password-login/reset race. Frontend tests cover the login link, email submission, matching passwords, fragment removal, success and missing-mail configuration. Automated mail tests use a delivery adapter; actual inbox delivery is BLOCKED until sender setup and a user-operated end-to-end check.
