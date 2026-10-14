# CineHook Authentication

## Plan and design

Use the existing Route -> Middleware -> Controller -> Service -> Repository ->
Prisma -> PostgreSQL architecture, global errors and environment parser.
Register/login are public; /me requires a signed Bearer JWT. There are no
in-memory accounts/sessions in production. Redis is not needed for this module.

User: UUID id, name, unique normalized email, passwordHash, USER/ADMIN role,
createdAt and updatedAt. Registration can only create USER. Plaintext passwords
are request inputs only; only a bcrypt cost-12 hash is persisted. Public User
selection excludes hashes. Passwords must be 8 characters to 72 UTF-8 bytes,
without NUL characters, and are never trimmed or silently truncated.

JWT: HS256, secret from validated config, userId and role, automatic iat/exp,
issuer cinehook and audience cinehook-api. Default lifetime: 3600 seconds.
Verification pins algorithm/issuer/audience, requires expiry and typed claims.
GET /me reads the current user from the database; a deleted user receives 401.
Future privileged operations must check the current database role, since a
JWT role is a snapshot until expiry. No refresh/logout/revocation is added in
this module; those need an explicit shared revocation design if requested.

## Implementation checklist

- [x] Auth HTTP tests fail before implementation.
- [x] Add bcrypt/JWT, User schema and migration.
- [x] Implement repository, AuthService, TokenService, validation and middleware.
- [x] Wire public register/login and protected me into app/server.
- [x] Update config, examples, Compose and existing test fixtures.
- [x] Run tests, Prisma validate/generate, typecheck, build and runtime smoke.
- [x] Review files and document exact flow, results and limitations.

No commits or pushes. Existing foundation changes are preserved.

## Exact request flows

All requests first run the existing request-ID, security headers, CORS and
bounded JSON middleware in app.ts. Auth responses use Cache-Control: no-store.

```text
POST /api/auth/register { name, email, password }
  -> auth.routes.ts
  -> validateBody(registerSchema): validate input, normalize email, reject role
  -> AuthController.register: read validated body
  -> AuthService.register
     -> UserRepository.findByEmail -> Prisma.user.findUnique -> PostgreSQL
     -> bcrypt.hash(password, 12)
     -> UserRepository.create -> Prisma.user.create -> PostgreSQL
        unique email constraint protects concurrent requests; default USER role
     -> TokenService.sign: issue expiring JWT
  -> controller: 201 { success, data: { user, accessToken, tokenType } }

POST /api/auth/login { email, password }
  -> auth.routes.ts -> validateBody(loginSchema) -> AuthController.login
  -> AuthService.login
     -> UserRepository.findByEmail -> Prisma.user.findUnique -> PostgreSQL
     -> bcrypt.compare(password, stored hash or dummy hash)
     -> absent user / mismatch: AppError(INVALID_CREDENTIALS)
     -> success: safe user projection + TokenService.sign
  -> controller: 200 { success, data: { user, accessToken, tokenType } }

GET /api/auth/me, Authorization: Bearer <token>
  -> auth.routes.ts -> authMiddleware -> TokenService.verify
     verify signature, algorithm, issuer, audience, expiry and claim types
     attach verified identity to this request's res.locals.identity
  -> AuthController.me -> AuthService.getMe(verified userId)
  -> UserRepository.findById -> Prisma.user.findUnique -> PostgreSQL
     select public fields only; read current role, not a cached profile
  -> controller: 200 { success, data: { user } }

Errors -> existing global errorHandler -> safe JSON + request ID
  validation: 400; duplicate email: 409; incorrect login: 401
  missing/invalid/expired JWT or deleted user: 401
  unexpected database/server errors: safe 500
```

Plaintext passwords are short-lived request inputs only. They are never saved
in the database, put in JWTs, echoed in responses, or logged. UserRepository
fetches passwordHash only for login; create and /me use explicit public selects.
AuthService also builds public response objects explicitly as a second boundary.

## Match to HLD/LLD and decisions

- Controller: HTTP only. Service: registration, bcrypt verification, safe user
  projection and token coordination. Repository: Prisma data access. Middleware:
  request validation and verification. PostgreSQL: permanent user records.
- JWT verification is stateless. Every API instance uses the configured signing
  key; no process-local session registry or in-memory user store exists.
- TokenService is extracted from the notes' conceptual AuthService token methods
  so signing and verification share one policy across service and middleware.
- Verified identity uses res.locals.identity instead of the notes' req.user.
  Both are request-local; this avoids adding global Express request type fields.
- The previously empty schema gets the minimal requested User model with UUIDs,
  USER/ADMIN roles and timestamps. The SQL migration adds a normalized-email
  check so other database writers cannot bypass canonical email uniqueness.
- JWT adds only standard iat/iss/aud claims alongside userId/role/exp. These are
  not profile data; they bind tokens to this issuer/API and token lifetime.
- Redis remains reserved for shared temporary coordination in later modules.

## Every source/config/test file changed by this module

Paths below are relative to C:/Users/gaura/OneDrive/Desktop/Cine-Hook.
Existing foundation files remain uncommitted; "created" here means new in Auth,
not every untracked file from the previous foundation task.

| Action | File | Responsibility |
| --- | --- | --- |
| Created | backend/prisma/migrations/20261006000100_auth_users/migration.sql | Users table, roles, email constraints |
| Created | backend/prisma/migrations/migration_lock.toml | PostgreSQL migration provider |
| Created | backend/src/middleware/auth.middleware.ts | Bearer JWT verification and request identity |
| Created | backend/src/middleware/validate-body.ts | Shared safe schema validation |
| Created | backend/src/modules/auth/auth.types.ts | Identity/input/public-user/repository contracts |
| Created | backend/src/modules/auth/auth.validation.ts | Register/login schemas |
| Created | backend/src/modules/auth/token.service.ts | Shared JWT signing/verification policy |
| Created | backend/src/modules/auth/user.repository.ts | Prisma user operations and duplicate mapping |
| Created | backend/src/modules/auth/auth.service.ts | Auth business logic and bcrypt |
| Created | backend/src/modules/auth/auth.controller.ts | HTTP handlers and responses |
| Created | backend/src/modules/auth/auth.routes.ts | Public/protected route wiring |
| Created | backend/tests/auth.test.ts | HTTP Auth coverage with real bcrypt/JWT |
| Created | backend/tests/auth-config.test.ts | Required signing key and bounded TTL |
| Created | backend/tests/user.repository.test.ts | Prisma error translation |
| Created | backend/tests/auth.integration.mjs | Real PostgreSQL repository/migration/race checks |
| Created | docs/authentication.md | This module's plan and learning notes |
| Changed | backend/package.json | bcrypt/JWT dependencies and integration-test script |
| Changed | backend/package-lock.json | Locked dependency updates |
| Changed | backend/prisma/schema.prisma | User model and UserRole enum |
| Changed | backend/src/app.ts | Require Auth dependencies and mount /api/auth |
| Changed | backend/src/server.ts | Construct UserRepository/AuthService/TokenService |
| Changed | backend/src/config/env.ts | Required JWT_SECRET and token TTL |
| Changed | backend/.env.example | Blank signing key and local key-generation instructions |
| Changed | backend/tests/foundation.test.ts | Supply Auth dependency and config to existing tests |
| Changed | backend/tests/runtime-smoke.mjs | Test signing key and actual protected endpoint check |
| Changed | compose.yaml | Supply configured JWT key to optional API container |
| Changed | .github/workflows/ci.yml | Disposable PostgreSQL, migration and integration checks |
| Changed | README.md | Updated setup and Auth API instructions |

Ignored generated Prisma client files and compiled backend output were refreshed.
No frontend files were changed by this module. No real signing key/.env created.

## Verification results

- npm test: 49 passed (including the 14 foundation tests).
- npm run db:validate: schema valid.
- npm run db:generate: Prisma 7.10.0 client generated.
- npm run typecheck and npm run build: passed.
- npm run test:smoke: 2 passed; compiled /me rejects missing JWT.
- npm audit: zero vulnerabilities.
- npm run test:integration: 1 skipped locally, because no disposable live
  PostgreSQL URL was configured. Docker and PostgreSQL are unavailable here.
  No migration was applied to a local database. CI is configured to run this
  test with actual PostgreSQL, but CI has not been executed (no push).

## Running locally

1. Start PostgreSQL using the existing Compose infrastructure setup.
2. Copy backend/.env.example to the ignored backend/.env; generate and fill
   JWT_SECRET. Keep DATABASE_URL pointed at your intended development database.
3. In backend/, run npm run db:generate, npm run db:deploy, npm run dev.
4. Register/login with JSON requests; pass the returned accessToken as Bearer
   authorization when calling /me.

For live integration verification, use a separate disposable database ending
in _test, apply migrations with DATABASE_URL targeting that database, build,
then set AUTH_TEST_DATABASE_URL to that same database and run
npm run test:integration. It cleans only its generated test-email rows.

Library references:
- [bcrypt input limit](https://www.npmjs.com/package/bcrypt)
- [JWT signing and verification options](https://github.com/auth0/node-jsonwebtoken)
