# Post-event migration preservation check

Reviewed migrations11/12 applied only through guarded dev launcher to cinehook_dev/public5432. Every pre-existing table count in both databases matches before migration; original cinehook still has6 migrations. No reset/delete/seed occurred in this check.

```json
{"cinehook_dev":{"identity":{"database":"cinehook_dev","schema":"public","port":5432},"counts":{"_prisma_migrations":12,"booking_seats":8,"bookings":4,"cities":3,"confirmed_seats":0,"demo_listings":24,"event_booking_seats":0,"event_confirmed_seats":0,"event_participants":0,"event_performers":0,"event_seats":0,"event_sections":0,"event_session_prices":0,"event_sessions":0,"event_venues":0,"events":0,"movie_wishlists":0,"movies":30,"payment_evidence":0,"payment_reconciliations":0,"payment_webhook_events":0,"payments":0,"refund_attempts":0,"refunds":0,"screens":6,"seats":288,"show_seat_prices":306,"shows":102,"theatres":3,"users":2}},"cinehook":{"identity":{"database":"cinehook","schema":"public","port":5432},"counts":{"_prisma_migrations":6,"booking_seats":0,"bookings":0,"cities":0,"confirmed_seats":0,"movies":0,"payment_evidence":0,"payment_reconciliations":0,"payment_webhook_events":0,"payments":0,"refund_attempts":0,"refunds":0,"screens":0,"seats":0,"show_seat_prices":0,"shows":0,"theatres":0,"users":0}}}
```

