# Password recovery

Added 17 October 2026. Existing users, bookings and payment records are preserved. No database migration is required.

## Brevo HTTPS setup

Set these privately in Render Environment, then redeploy. Use an API v3 key, not an SMTP credential. No SMTP ports, new domain purchase, or additional dependency are required:

```dotenv
BREVO_API_KEY=
PASSWORD_RESET_FROM=
PASSWORD_RESET_FROM_NAME=CineHook
FRONTEND_ORIGIN=https://cine-hook-xi.vercel.app
```

Verify an address you control in Brevo Settings → Senders, Domains & IPs → Senders. Put that address in PASSWORD_RESET_FROM; do not invent a brevosend.com address. PASSWORD_RESET_FROM_NAME is optional (defaults to CineHook). Existing Redis, database and JWT settings remain required. Never put the API key in frontend variables or Git. RESEND_API_KEY is no longer used.

Brevo documents temporary replacement of unauthenticated/free-email sender domains with a Brevo-managed brevosend.com address. This provides a possible no-owned-domain route, not a permanent delivery guarantee. Sender verification and transactional-account activation are still necessary. Different recipients need not own Brevo accounts. References: [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [managed-domain fallback](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

The [free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan) currently permits 300 emails/day, shared with other account sends. Quota exhaustion may queue emails beyond the reset link's 15-minute lifetime; request a fresh link when sending is available. Inbox delivery cannot be guaranteed for every recipient. No paid upgrade is performed by this application.

The adapter uses HTTPS POST https://api.brevo.com/v3/smtp/email with the api-key header; despite its URL, this is not an SMTP connection. API acceptance is not proof of inbox delivery. Provider failures are mapped to bounded diagnostic codes without printing provider response bodies, recipients or credentials.

Before mail is configured, requesting a reset returns PASSWORD_RESET_UNAVAILABLE for every address. The frontend displays the unavailable message rather than claiming an email was sent.

## Request flow

Login → Forgot password → POST /api/auth/forgot-password → origin/body validation → controller → recovery service → repository lookup. A cryptographically random link expires after 15 minutes. Redis stores only its SHA-256 digest and an HMAC credential fingerprint; raw links are never returned through the API or written to application logs. Account-specific requests are limited to five per hour; the coarser network bucket is 1,000 per hour to tolerate a shared reverse proxy. Responses do not disclose whether a password account exists. Google-only accounts keep Google sign-in.

Delivery runs asynchronously so provider latency does not reveal account existence. The API accepts a request without guaranteeing inbox delivery. Sending is best-effort; an interrupted process can require requesting a new link. There is no durable email queue. Delivery failures log a fixed event and bounded provider code with no recipient, token, provider response or key.

The link uses /reset-password#token=… so the token is not included in server request URLs. The reset page removes the fragment after reading it, uses no-referrer, and never forwards the token to Google or another external asset.

Reset form → POST /api/auth/reset-password → validation → controller → atomic Redis GETDEL → credential fingerprint check → bcrypt cost 12 → shared session revocation → PostgreSQL conditional password replacement. The conditional update prevents different recovery links from concurrently overwriting each other. Reset does not sign the user in automatically. Temporary failures after token consumption require a new link.

Access tokens created by password login include a server-signed credential tag. Middleware checks it against the current database credential, including logins racing a reset. Old sessions are revoked in Redis for the maximum token lifetime. Existing signed tokens remain schema-compatible; their normal expiry still applies. A Redis outage fails session checks closed with a safe temporary-unavailability error.

## Verification

Targeted backend tests cover safe unavailable responses, password hashing, single use, expiry, invented tokens, changed credentials, concurrent resets, neutral provider failures, Google-only accounts, token revocation and a password-login/reset race. Frontend tests cover the login link, email submission, matching passwords, fragment removal, success and missing-mail configuration.

17 October 2026: private local configuration was present. Live HTTPS account and sender checks both returned 401 Unauthorized. Two sends to distinct privately configured external recipients were attempted; both returned BREVO_AUTH_REJECTED. No delivery was accepted or verified. Replace the private API key with an active Brevo API v3 key, retry both sends and check delivered events/inboxes before declaring this feature operational. Do not commit BREVO_TEST_RECIPIENTS or recipient addresses. Render must also receive the corrected settings; local .env does not configure Render.
