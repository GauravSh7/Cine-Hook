# CineHook implementation foundation

## Approved direction

React + Vite + TypeScript + Tailwind; Node + Express + TypeScript;
PostgreSQL + Prisma; Redis; JWT + bcrypt; Razorpay; Cloudinary; Docker.
Business request flow: Route -> Middleware -> Controller -> Service ->
Repository -> Prisma -> PostgreSQL. Temporary shared locks live in Redis.

## Inspection (2026-10-06)

Repository: C:/Users/gaura/OneDrive/Desktop/Cine-Hook.
Base: 54ac39c, main, clean working tree, origin GauravSh7/Cine-Hook.
Only the React/Vite starter and README exist. Tailwind and backend are absent.
The starter includes its tracked hero.png. Docker is unavailable locally.
The ChatGPT mirror has no source files. The available conversation confirms
architecture, but full DB column definitions and approved UI designs could
not be retrieved. Do not use the generated study PDF as an exact schema spec:
its tail was reconstructed in the earlier PDF task rather than retrieved.

## First deliverable

Keep frontend and backend independent npm projects. Add validated server
configuration, Express bootstrap, bounded JSON input, CORS, security headers,
request identifiers, safe global errors, and health routes. HealthController
calls HealthService; HealthRepository uses Prisma for a SELECT 1 database probe
and the shared Redis client for PING. Liveness must work without dependencies;
readiness returns 503 when either dependency is unavailable. Infrastructure
probes do not imply that business repositories should access Redis.

Add Prisma 7 generation/configuration and PostgreSQL adapter, with no guessed
domain models or migrations. Add Redis connection lifecycle and bounded probe
timeouts, graceful shutdown, environment examples, local Docker services,
backend image, CI and Tailwind integration while preserving the starter UI.
Business modules follow later: Auth, catalog, shows, booking/locking, payments,
cancellation/refunds, then approved UI integration.

## Implementation plan

- [x] Add dependency manifests and tests for invalid config, live/ready health,
  unavailable dependencies, unknown endpoints, malformed JSON and safe errors.
- [x] Run tests to establish the missing implementation failure.
- [x] Implement configuration, middleware, health layers and shared clients.
- [x] Add Docker, CI, Tailwind and setup documentation.
- [x] Run backend tests/typecheck/build, Prisma validate/generate, frontend
  lint/build, secret-ignore checks and diff review.
- [x] Record verified results and local infrastructure limitations.

## Decisions

No separate worktree: the user explicitly requested work in the existing clean
repository, and direct edits keep it available for learning. No commits/pushes
are required for this deliverable. Prisma uses its stable 7 release rather than
the registry's 8 release candidate. Tailwind uses the Vite plugin. Health probes
are infrastructure checks, not a reason to bypass layers in business modules.

## Verification and review

- Initial tests failed because the backend implementation did not exist.
- The first HTTP run exposed a CORS callback error (8 timeouts). The library
  requires a callback for function origins. An allowed-origin array fixed it.
- 14 tests pass: valid/invalid config, liveness during outages, readiness for
  both/either dependencies, safe 404/400/413/500 errors, CORS restriction,
  and bounded readiness for a dependency that never responds.
- Two compiled-runtime smoke tests pass: actual server liveness and 503 with
  real unavailable PostgreSQL/Redis addresses; invalid configuration exits
  without revealing connection values.
- Prisma generation/validation, backend typecheck/build, frontend lint/build,
  and git diff whitespace checks pass.
- npm audit initially found four high findings in Prisma's CLI dependency tree.
  Explicit overrides use deepmerge-ts 8.0.2 and mysql2 3.24.5. Prisma generation,
  validation and builds were rerun. Final audit: zero findings. Revisit/remove
  overrides when Prisma adopts patched dependencies.
- Successful live PostgreSQL/Redis connections, Docker image/Compose execution
  and GitHub Actions execution were not verified here. Docker is unavailable,
  and no live data services were configured. No domain migrations were applied.
- Source review checked layer boundaries, secret handling, generated/build file
  exclusions, readiness failures/timeouts and client lifecycle. No commits or
  pushes were performed.

## Files and learning map

| Files | Responsibility |
| --- | --- |
| backend/package.json, package-lock.json, tsconfig.json | Installation, scripts, strict TypeScript |
| backend/src/app.ts | HTTP assembly and route registration |
| backend/src/server.ts | Shared clients, listener, shutdown |
| backend/src/config/env.ts | Validate required configuration without printing values |
| backend/src/errors/app-error.ts | Error metadata |
| backend/src/middleware/request-id.ts, error-handler.ts | Request tracing and safe HTTP errors |
| backend/src/modules/health/health.routes.ts | Map health URLs to handlers |
| backend/src/modules/health/health.controller.ts | HTTP status and response |
| backend/src/modules/health/health.service.ts | Readiness decisions and bounded checks |
| backend/src/modules/health/health.repository.ts | PostgreSQL/Redis infrastructure probes |
| backend/src/lib/prisma.ts, redis.ts | Shared clients per process |
| backend/prisma.config.ts, prisma/schema.prisma | CLI/client generation without guessed models |
| backend/tests/foundation.test.ts, runtime-smoke.mjs | HTTP/config tests and compiled-server checks |
| backend/.env.example, .dockerignore, Dockerfile | Local config example and API container |
| compose.yaml | Local PostgreSQL, Redis and optional API |
| .github/workflows/ci.yml | Backend checks and frontend lint/build |
| frontend/package.json, package-lock.json, vite.config.ts, src/index.css | Tailwind and API development proxy |
| .gitignore, README.md, this document | Exclusions and setup/learning notes |

The Prisma 7 adapter is a library requirement, not an architecture change:
repositories still use Prisma for PostgreSQL. Tailwind's Vite plugin adds the
agreed styling tool without changing the product design.

Official setup references:
- https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- https://tailwindcss.com/docs/installation/using-vite
