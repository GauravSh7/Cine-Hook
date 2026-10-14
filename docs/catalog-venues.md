# Catalog and venue module

## Scope and planned schema

Keep existing Auth/foundation and Route -> Middleware -> Controller -> Service
-> Repository -> Prisma -> PostgreSQL. No Redis, Show, Seat or Booking code.

Movie: UUID, title, description, durationMinutes, date-only releaseDate,
language, genres[], optional HTTPS posterUrl, isActive and timestamps.
City: UUID, name, state, countryCode (default IN), timestamps, theatres[].
Theatre: UUID, name, address, cityId, timestamps, city and screens[].
Screen: UUID, name, capacity, theatreId, timestamps, theatre.

City names are unique per country/state; theatre names per city; screen names
per theatre. Use PostgreSQL citext for case-insensitive uniqueness with display
casing preserved. Foreign keys restrict parent deletion. Movie genres use GIN;
active/language/title and parent/name indexes serve listing queries. Substring
title search is supported without introducing a search engine; revisit trigram
indexing only when measured volume warrants it.

## Plan

- [x] Write failing HTTP tests before catalog implementation.
- [x] Add schema, migration and generated client.
- [x] Add current-database ADMIN middleware and query/param validation.
- [x] Add separate Movie/City/Theatre/Screen repositories, services, controllers.
- [x] Wire public/admin routes and existing tests without weakening Auth.
- [x] Run unit/HTTP, runtime and optional PostgreSQL integration checks.
- [x] Run Prisma validation/generation, typecheck, build, audit and review.

Public GET: /api/movies, /api/movies/:id, /api/cities, /api/theatres,
/api/theatres/:id. Lists return {items,page,limit}, default 20, maximum 100.
Movie list supports search/language/genre combined with AND. Blank optional
filters are treated as absent. Disabled movies are hidden from public reads.

Admin POST: /api/admin/movies, /cities, /theatres, /screens.
Admin PATCH: /api/admin/movies/:id, /theatres/:id, /screens/:id.
Admin DELETE /api/admin/movies/:id soft-disables idempotently.

Every admin route verifies JWT then reads the current database role via
AuthService.getMe. Validation is strict; IDs are UUIDs and patches nonempty.
No commit or push. Existing uncommitted changes belong to the user.

## Relationships and persistence

```text
City.id (UUID)
  1 -> N Theatre.cityId (UUID FK, RESTRICT parent deletion)
            1 -> N Screen.theatreId (UUID FK, RESTRICT parent deletion)

Movie (independent, no Show relation yet)
User (unchanged, used by existing Auth and ADMIN guard)
```

All four new entities have createdAt/updatedAt. Capacity is metadata for now;
there are no seat rows, layouts, locks or bookings. No venue deletion API exists.
The SQL migration includes positive capacity/duration and nonempty-value checks
in addition to the Prisma foreign keys, compound uniqueness and query indexes.
These SQL checks intentionally complement the HTTP schemas; Prisma does not
represent CHECK constraints in schema.prisma.

## Exact flows

```text
Public movies list/detail
  catalogRoutes -> validateRequest(query/UUID)
  -> MovieController -> MovieService -> MovieRepository
  -> Prisma.movie.findMany/findUnique -> PostgreSQL
  -> safe JSON response (disabled detail returns 404)

Public cities/theatres list/detail
  catalogRoutes -> validateRequest
  -> CityController/TheatreController -> corresponding service -> repository
  -> Prisma -> PostgreSQL (theatre detail includes city and screens)

Every admin mutation
  catalogRoutes /admin -> existing authMiddleware -> TokenService.verify
  -> requireRole(ADMIN) -> existing AuthService.getMe
  -> existing UserRepository -> Prisma -> PostgreSQL: current role
  -> validateRequest(UUID, where needed) -> existing validateBody(schema)
  -> corresponding Controller -> corresponding Service -> Repository
  -> Prisma -> PostgreSQL -> Controller JSON (201 create, 200 update/disable)

Theatre creation / city reassignment
  TheatreService -> CityService.getById -> CityRepository -> Prisma -> DB
  -> TheatreRepository.create/update -> Prisma -> DB

Screen creation / theatre reassignment
  ScreenService -> TheatreService.getById -> TheatreRepository -> Prisma -> DB
  -> ScreenRepository.create/update -> Prisma -> DB

Movie disable
  MovieService.disable -> MovieRepository.update({ isActive: false })
  -> Prisma.movie.update -> PostgreSQL (row retained)

Validation/role/domain/Prisma errors -> existing global errorHandler
  400 invalid input; 401 missing/invalid/deleted-user JWT identity
  403 current role lacks permission; 404 missing record/parent
  409 duplicate or concurrent parent conflict; safe 500 unexpected failure
```

Services decide existence rules and soft-disable behavior. Repositories alone
emit Prisma queries. Database constraints are authoritative if simultaneous
requests pass application checks. No Prisma is imported by controllers or
business services (only type imports in shared contracts).

## Choices beyond the conceptual notes

- Added GET cities and ADMIN POST cities so theatre creation does not require
  manual SQL or an undisclosed seed step. There is no city-edit API in this scope.
- Movie genre is a normalized array because a movie can have multiple genres;
  the API's singular genre filter checks array membership. Language and genre
  keys are lowercase, while display titles/venue names retain entered casing.
- Chose UUIDs/timestamps consistent with Auth. Movie title is not unique because
  distinct films/releases may share a title. Venue uniqueness is parent-scoped.
- PostgreSQL citext enforces case-insensitive name uniqueness without separate
  lowercased display fields. The catalog migration installs the bundled extension.
- Lists use bounded page/limit pagination with stable ID tie-breakers. No total
  count is promised. Optional blank filters are absent; malformed IDs are 400.
- Parent checks live in services; FK constraints handle deletion races. Moving
  venues is allowed while there are no Shows. The Show module must revisit such
  mutations once scheduled shows/seats depend on a screen and location.
- ADMIN middleware reads the database role, not JWT role snapshots. A revoked
  ADMIN token is immediately forbidden; a deleted account is unauthorized.
- Movie DELETE is soft-disable. Updates cannot alter id/isActive/timestamps;
  no restore endpoint is added. Repeated disable succeeds for an existing row.
- Added practical validation bounds (movie duration 1-600 minutes, screen
  capacity 1-1000) because the supplied notes did not specify exact limits.

## Every file created or modified in this module

Paths relative to C:/Users/gaura/OneDrive/Desktop/Cine-Hook. "Created" means new
in this module, not every still-untracked foundation/Auth file.

| Action | File |
| --- | --- |
| Created | backend/prisma/migrations/20261006000200_catalog_venues/migration.sql |
| Created | backend/src/middleware/require-role.ts |
| Created | backend/src/middleware/validate-request.ts |
| Created | backend/src/modules/catalog/catalog.types.ts |
| Created | backend/src/modules/catalog/catalog.validation.ts |
| Created | backend/src/modules/catalog/catalog.routes.ts |
| Created | backend/src/modules/catalog/create-catalog.ts |
| Created | backend/src/modules/catalog/database-write.ts |
| Created | backend/src/modules/catalog/movie.repository.ts |
| Created | backend/src/modules/catalog/movie.service.ts |
| Created | backend/src/modules/catalog/movie.controller.ts |
| Created | backend/src/modules/catalog/city.repository.ts |
| Created | backend/src/modules/catalog/city.service.ts |
| Created | backend/src/modules/catalog/city.controller.ts |
| Created | backend/src/modules/catalog/theatre.repository.ts |
| Created | backend/src/modules/catalog/theatre.service.ts |
| Created | backend/src/modules/catalog/theatre.controller.ts |
| Created | backend/src/modules/catalog/screen.repository.ts |
| Created | backend/src/modules/catalog/screen.service.ts |
| Created | backend/src/modules/catalog/screen.controller.ts |
| Created | backend/tests/helpers/catalog.ts |
| Created | backend/tests/catalog.test.ts |
| Created | backend/tests/catalog.repository.test.ts |
| Created | backend/tests/catalog.integration.mjs |
| Created | docs/catalog-venues.md |
| Modified | backend/prisma/schema.prisma |
| Modified | backend/src/app.ts |
| Modified | backend/src/server.ts |
| Modified | backend/package.json |
| Modified | backend/tests/foundation.test.ts |
| Modified | backend/tests/auth.test.ts |
| Modified | backend/tests/auth.integration.mjs |
| Modified | backend/tests/runtime-smoke.mjs |
| Modified | README.md |

Prisma generated files and compiled output refreshed (ignored). No dependencies
were added, so package-lock.json and existing dependency versions are unchanged.
No frontend, secret/.env, Redis, Show, Seat or Booking changes were made.

## Review and verification

Tests cover public filtering, active-only reads, literal LIKE escaping, date and
UUID validation, pagination, strict patches, all admin write guards, current-role
revocation/promotion/deletion, parent existence, parent-scoped duplicates, venue
updates and Prisma error mapping. Initial regression tests caught SQL wildcard
semantics, JavaScript accepting year zero, and an empty city filter. Each was
corrected and rerun. Malformed poster URLs are also explicitly rejected with 400
rather than throwing during URL parsing. Real PostgreSQL integration covers
duplicate races, foreign
keys, SQL capacity constraints, filters, soft-disable and role revocation.

The integration command uses the existing AUTH_TEST_DATABASE_URL for the same
disposable database ending in _test. CI already runs this command after deploy
migrations, so no new CI environment or deployment action is necessary.

Final verification: npm test 90 passed (including all existing Auth/foundation
tests); Prisma validate/generate passed; typecheck/build passed; compiled runtime
smoke tests 2 passed; npm audit zero findings; git diff --check passed.
Live PostgreSQL tests
remain skipped here because no test database/Docker is configured; no local
migration or CI run is claimed. No commit or push was performed.

References:
- [Prisma PostgreSQL extension migration](https://www.prisma.io/docs/orm/v7/prisma-schema/postgresql-extensions)
- [PostgreSQL citext](https://www.postgresql.org/docs/17/citext.html)
