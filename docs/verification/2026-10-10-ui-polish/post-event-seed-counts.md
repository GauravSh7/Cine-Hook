# Development event seed verification

Verified target: cinehook_dev/public on PostgreSQL5432. Original cinehook is preserved.
Reviewed explicit npm dev:events:seed first run added9 events,3 performers,6 participants,9 venues,30 sections,612 seats,63 sessions and189 typed prices. Immediate rerun added0 in every entity.
All pre-existing table counts in both databases match the post-migration baseline, including users/booking history/financial evidence; original cinehook still has6 migrations. Development has12 migrations.

```json
{
  "cinehook_dev": {
    "identity": {
      "database": "cinehook_dev",
      "schema": "public",
      "port": 5432
    },
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
      "event_session_prices": 189,
      "event_sessions": 63,
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

