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

The [free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan) currently permits 300 emails/day, shared with other account sends. Quota exhaustion may queue emails beyond the OTP's 10-minute lifetime; request a fresh code when sending is available. Inbox delivery cannot be guaranteed for every recipient. No paid upgrade is performed by this application.

The adapter uses HTTPS POST https://api.brevo.com/v3/smtp/email with the api-key header; despite its URL, this is not an SMTP connection. API acceptance is not proof of inbox delivery. Provider failures are mapped to bounded diagnostic codes without printing provider response bodies, recipients or credentials.

Before mail is configured, requesting a reset returns PASSWORD_RESET_UNAVAILABLE for every address. The frontend displays the unavailable message rather than claiming an email was sent.

## Request flow

Login → Forgot password → enter email → POST /api/auth/forgot-password → origin/body validation → controller → recovery service → repository lookup → Brevo HTTPS email with a cryptographically random six-digit OTP. The API returns a random challenge ID, never the OTP. Redis stores a keyed HMAC of the challenge/code and a credential fingerprint, not the plaintext OTP. Challenges expire after 600 seconds. Requests are limited to five per account email/hour and 1,000 per network/hour; the UI also spaces resend clicks by one minute. Responses do not disclose account existence. Google-only accounts keep Google sign-in.

Delivery runs asynchronously so provider latency does not reveal account existence. The API accepts a request without guaranteeing inbox delivery. Sending is best-effort; an interrupted process can require requesting a new code. There is no durable email queue. Delivery failures log a fixed event and bounded provider code with no recipient, OTP, token, provider response or key.

Enter OTP → POST /api/auth/verify-reset-otp with challengeId and otp. An atomic Redis Lua script permits at most five attempts, preserves the original expiry on wrong attempts, invalidates the challenge on the fifth failure, and consumes successful codes exactly once even under concurrent requests. Resending invalidates the preceding unverified challenge. Successful verification issues a random reset grant, stored only as a digest in Redis, expiring after at most five minutes and never later than the original OTP deadline. The browser keeps it only in component memory, never in URLs or storage. Refreshing requires a new code. Legacy URL fragments are erased, not accepted by the new UI.

After verified OTP → new password and confirmation → POST /api/auth/reset-password → validation → credential fingerprint check → bcrypt comparison rejecting the current password → atomic Redis GETDEL → bcrypt cost 12 → shared session revocation → PostgreSQL conditional password replacement. Rejecting a reused password leaves the verified grant usable within its original TTL. The conditional update prevents different grants from concurrently overwriting each other. Reset does not sign the user in automatically. Temporary failures after token consumption require a new code.

Access tokens created by password login include a server-signed credential tag. Middleware checks it against the current database credential, including logins racing a reset. Old sessions are revoked in Redis for the maximum token lifetime. Existing signed tokens remain schema-compatible; their normal expiry still applies. A Redis outage fails session checks closed with a safe temporary-unavailability error.

## Verification

Targeted backend tests cover safe unavailable responses, password hashing, single use, expiry, invented tokens, changed credentials, concurrent resets, neutral provider failures, Google-only accounts, token revocation and a password-login/reset race. Frontend tests cover the login link, email submission, matching passwords, fragment removal, success and missing-mail configuration.

17 October 2026: following private API-key and sender corrections, both external diagnostic emails were accepted and Brevo recorded delivered events for both. This establishes provider delivery, not proof of the hosted OTP flow. No private recipient addresses or keys are recorded here. Render must receive the same private settings; local .env does not configure Render. The OTP change needs both backend and frontend deployments; no new environment variables or database migration are required.

Verification includes unit/UI coverage for OTP → password reset, wrong codes, password reuse, confirmation, unavailable email, session revocation and replay. A real local-Redis integration test covers expiry, five-attempt lockout, concurrent verification, resend invalidation, grant expiry bounds, single-use consumption and email-request limits. Run it with `node --import tsx --test tests/password-reset-otp.integration.mjs` from backend; its target is restricted to loopback Redis, and it removes only its own randomized test keys.
