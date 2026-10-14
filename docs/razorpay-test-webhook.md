# Temporary Razorpay TEST webhook — 13 October 2026

Current URL (renewed 14 October): https://marijuana-monitoring-utils-navy.trycloudflare.com/api/webhooks/razorpay

Temporary Cloudflare Quick Tunnel, forwarding to loopback relay 127.0.0.1:4011,
not directly to Express. Relay allows only exact POST /api/webhooks/razorpay,
limits bodies to 100 KiB, preserves raw bytes and Razorpay signature/event ID,
and forwards to fixed loopback 127.0.0.1:4000. All other routes/methods reject.
Cookies/authorization are not forwarded. No secrets or payloads are logged.
Targeted native relay tests pass. No database connection or data changes.

Dashboard: Test Mode → Webhooks → Add Webhook. Select payment.captured,
order.paid, payment.failed, refund.created, refund.processed, refund.failed.
Generate a separate secret of at least 32 characters; save privately to
backend/.env as RAZORPAY_WEBHOOK_SECRET. Never paste credentials into chat.

Opt-in checkout is now available via `npm run dev:razorpay-test` from backend,
with configured TEST keys and webhook secret. Its backend guard requires a
non-production environment, verified local cinehook_dev on 5432, rzp_test_ keys
and explicit DEV_RAZORPAY_TEST_CHECKOUT=true. Live keys/production are rejected.
Normal startup does not opt in. Simulated taxes remain unverified assumptions.
Update the Dashboard URL after this renewal; retain the privately saved secret.
An actual provider capture/webhook delivery is not claimed by browser SDK checks.
The
tunnel URL expires when its process stops; a restarted Quick Tunnel gives a new
URL which must be updated in Dashboard. No public admin/database/test utilities.

Relay launcher: node backend/scripts/dev-webhook-relay.mjs (from repo root).
Cloudflared binary is temporary, official release 2026.10.0, SHA256 checked
against official GitHub asset digest. No persistent Windows service installed.
