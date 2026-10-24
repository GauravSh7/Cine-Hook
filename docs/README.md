# Documentation index

Start here rather than treating every historical module checkpoint as current.
The application baseline is `76c42a74`; Pointer 3 and Pointer 4 are reviewed
documentation-only follow-ups. Publishing these documents does not deploy the app.

## Current entry points

- [Project overview](../README.md): product, stack, engineering decisions and limits.
- [Architecture](architecture.md): implemented system, identity, seats, payments,
  CI and monitoring diagrams with source references.
- [Local setup](local-development.md): current commands, private provider settings,
  development database boundaries and the legacy seeded-admin limitation.
- [Testing and recovery](testing-and-recovery.md): actual reviewed CI totals,
  restorable checkpoint evidence, safe recovery steps and unverified guarantees.
- [Test organization and commands](../backend/tests/README.md): suite boundaries,
  disposable integration targets and resource-conscious local verification.
- [Pointer 2 operations](pointer2-operations.md): rate-limit budgets, logging and
  monitoring setup. Its pre-push verification paragraphs are dated history;
  current CI and manual monitoring run evidence are linked in the root README.
- [Live screenshot provenance](assets/README.md): public captures and manual gaps.
- [Pointer 4 documentation review](documentation-review.md): checks and scope.
- [Final UX release](final-ux-release.md): final authentication/loading changes,
  evidence, controlled release order and owner-only live acceptance.

## Deeper implementation records

- [Authentication ownership rollout](auth-ownership-rollout.md)
- [Booking and Redis](booking-redis.md)
- [Payment and webhook evidence](payments-webhooks.md)
- [Cancellation/refunds](cancellation-refunds.md)
- [Event inventory and shared booking](events-sports-booking.md)
- [FIRST50 regression fix](pointer1-final-fixes.md)
- [Media provenance review](staging-media-review.md)

These files preserve decisions, intermediate counts, old approval gates and
verification dates. Statements such as “not deployed,” “30 movies,” “CI not run,”
“no OTP,” or the original cancellation window may describe an earlier stage;
they must not override current code, the current setup/architecture, or the
versioned test evidence. Do not execute an old rollout/import/seed command merely
because it appears in a historical document. No historical approval authorizes a
new production operation. Private recovery dumps and credentials are not Git assets.
