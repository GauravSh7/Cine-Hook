# Corrected event seed preservation checkpoint — 2026-10-11

Reviewed timezone fix and bounded seed-local advisory wait applied through explicit dev:events:seed only to identity-verified cinehook_dev/public/5432. Calendar rollover added9 missing future sessions and27 prices. Immediate rerun added0 of every entity. Canonical schedule13:00IST/07:30UTC; all63 earlier v1 sessions and legacy IDs remain unchanged.

Independent READ ONLY full-row SHA256 multiset comparison on every public table in BOTH databases: zero changed/removed pre-existing rows. Hashes and credentials are not included below. Original cinehook still6 migrations; dev12. Only new sessions/prices were inserted.

```json
{
  "cinehook_dev": {
    "identity": {
      "database": "cinehook_dev",
      "schema": "public",
      "port": 5432
    },
    "changedOrRemovedExistingRows": [],
    "counts": {
      "_prisma_migrations": 12,
      "booking_seats": 8,
      "bookings": 4,
      "cities": 3,
      "confirmed_seats": 0,
      "demo_listings": 24,
      "event_booking_seats": 0,
      "event_confirmed_seats": 0,
      "event_participants": 6,
      "event_performers": 3,
      "event_seats": 612,
      "event_sections": 30,
      "event_session_prices": 216,
      "event_sessions": 72,
      "event_venues": 9,
      "events": 9,
      "movie_wishlists": 0,
      "movies": 30,
      "payment_evidence": 0,
      "payment_reconciliations": 0,
      "payment_webhook_events": 0,
      "payments": 0,
      "refund_attempts": 0,
      "refunds": 0,
      "screens": 6,
      "seats": 288,
      "show_seat_prices": 306,
      "shows": 102,
      "theatres": 3,
      "users": 2
    }
  },
  "cinehook": {
    "identity": {
      "database": "cinehook",
      "schema": "public",
      "port": 5432
    },
    "changedOrRemovedExistingRows": [],
    "counts": {
      "_prisma_migrations": 6,
      "booking_seats": 0,
      "bookings": 0,
      "cities": 0,
      "confirmed_seats": 0,
      "movies": 0,
      "payment_evidence": 0,
      "payment_reconciliations": 0,
      "payment_webhook_events": 0,
      "payments": 0,
      "refund_attempts": 0,
      "refunds": 0,
      "screens": 0,
      "seats": 0,
      "show_seat_prices": 0,
      "shows": 0,
      "theatres": 0,
      "users": 0
    }
  }
}
```

