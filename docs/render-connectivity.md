# Render PostgreSQL / Redis connectivity

## Finding and patch

Previously both clients allowed only 2 seconds to connect, and readiness gave
each dependency 2.5 seconds. Health failures discarded all exception details;
Redis emitted only a generic event. Those are confirmed code limitations, not
proof of the deployed service's particular DNS, TLS, authentication or timeout
failure. Render environment values and private deployment logs were not accessed.

Connection deadlines are now 10 seconds for PostgreSQL and Redis. Readiness
allows 15 seconds and still returns the same up/down JSON and HTTP 200/503.
The database statement timeout remains 2 seconds; UTC sessions, pool size,
Redis reconnect backoff, disabled offline queue, lock command deadlines,
5-minute TTL, ownership checks and atomic Lua operations remain unchanged.

Logs include only recognized error names/codes from the connection event,
health failure, or nested Prisma driver error. Unknown names/codes are omitted
or replaced by UnknownError. Messages, stacks, URLs, credentials and arbitrary
metadata are never serialized. Example:

```json
{"event":"dependency_probe_failed","dependency":"database","errorName":"PrismaClientKnownRequestError","codes":["P2010","28P01"]}
```

| Diagnostic | Check privately in Render/provider settings |
| --- | --- |
| 28P01 / P1000 | Database credentials and selected database role |
| 3D000 / P1003 | Database name exists on the selected Neon branch |
| ENOTFOUND / EAI_AGAIN | Correct hostname and DNS resolution |
| ECONNREFUSED / ECONNRESET | Endpoint, port, service availability and TLS configuration |
| Certificate error / P1011 | Provider TLS settings and trusted certificate chain |
| WRONGPASS / NOAUTH / NOPERM | Upstash TCP username/password or access permissions |
| ConnectionTimeoutError / ETIMEDOUT / P1002 / HEALTH_TIMEOUT | Connection latency, network reachability or provider availability |
| REDIS_NOT_READY | Redis is connecting/reconnecting; inspect the preceding redis_unavailable event |

## Deployment preparation

1. Render root directory: backend. Build: `npm ci && npm run db:generate && npm run build`.
   Start: `npm start`. Use Node 24 (at least 24.14, below 25), matching package.json.
   No migrations or seed commands are needed for this patch.
2. Privately verify Render's DATABASE_URL uses the intended Neon connection
   string with its provider TLS parameters. Keep certificate validation enabled.
   Do not substitute local development URLs or remove TLS to fix a failure.
3. REDIS_URL must be Upstash's **TCP** connection string with `rediss://` and
   the configured username/password. An HTTPS REST endpoint/token cannot be
   used by the existing node-redis client. Keep the current Redis/Lua architecture.
4. Render health checks have a five-second response deadline. The existing
   `/api/health/live` route is suitable for process liveness; use
   `/api/health/ready` for the longer dependency diagnostic check (allow at least
   20 seconds in the client). A live response alone does not establish booking
   availability. A deployment currently using readiness must account for this
   limit; no Render settings were changed by this patch.
5. After rollout, request readiness and inspect only the new safe diagnostic
   JSON lines if either dependency is down. Authentication/DNS/TLS configuration
   errors still require correction in Render/provider settings; longer deadlines
   cannot repair them.

Verified locally: 74 focused tests, 8 real Redis concurrency/TTL/ownership tests,
backend typecheck/build, and a read-only readiness check using the actual Prisma
and Redis factories (both up). Remote deployment remains unverified.

Official references:

- [Neon connection latency and timeouts](https://neon.com/docs/connect/connection-latency)
- [Upstash TLS/ECONNRESET guidance](https://upstash.com/docs/redis/troubleshooting/econn_reset)
- [node-postgres pool timeouts and error events](https://node-postgres.com/apis/pool)
- [Render health-check response deadline](https://render.com/docs/health-checks)
