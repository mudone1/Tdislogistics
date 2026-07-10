# TDIS Connector Service

The Playwright-driven half of the Airline Connector Framework. Deployed
**separately** from the Next.js app, on anything that gives you a
persistent Node process — a small VPS, a Docker container, a background
worker on Railway/Render/Fly.io, etc. **Not deployable to Vercel** —
Playwright needs a real, long-lived OS process with a browser binary, which
serverless/edge functions don't provide.

```
Airline Portal  →  Connector Service (this)  →  PostgreSQL (source of truth)
                                                        ↓
                                                  Sync Service
                                                   ↙          ↘
                                          Firestore        Future
                                          (realtime          Analytics
                                           dashboard)
```

The Next.js app never runs Playwright itself — it calls this service's
internal HTTP API (see below), which is the only thing that touches a
browser.

## Local development

```bash
cd connector-service
npm install
npx playwright install --with-deps chromium   # only needed once
cp .env.example .env   # fill in DATABASE_URL, CONNECTOR_SERVICE_API_KEY, etc.
npm run dev
```

This imports `../src/modules/airline-connectors/*` directly via relative
paths (no build step needed in dev — `tsx` handles TS on the fly).

## Internal API

All routes require an `x-internal-api-key` header matching
`CONNECTOR_SERVICE_API_KEY`. This is a service-to-service secret, not a
user-facing auth token — never expose it to the browser.

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/connectors/:airline/sync` | Run a full sync (body: `{ "trigger": "MANUAL" \| "SCHEDULED" }`) |
| POST | `/internal/connectors/:airline/test` | Login-only connectivity check, no balance read/save |
| GET | `/internal/connectors/:airline/status` | Current wallet + settings row |
| GET | `/internal/connectors/:airline/history` | Balance history (`?limit=50`) |
| GET | `/internal/health` | Liveness check (no auth required upstream of a load balancer) |

`:airline` is one of `AIRPEACE`, `AERO`, `ARIK`, `IBOM`, `NGEAGLE` (case-insensitive).

## Scheduler

Runs inside this same process (`src/scheduler.ts`) — checks every minute
which enabled airlines are due, based on each one's
`AirlineConnectorSettings.syncIntervalMinutes` (e.g. `120` for every 2
hours) or `dailyRunAtUtc` (e.g. `"00:00"`). Configure these per-airline
from Admin → Airline Connectors in the Next.js app; they're read straight
out of Postgres, so no restart is needed after changing one.

## Docker

```bash
# from the repo root (needs ../src and ../prisma in the build context)
docker build -f connector-service/Dockerfile -t tdis-connector-service .
docker run --env-file connector-service/.env -p 4100:4100 tdis-connector-service
```

Note: the TypeScript build output lands at
`dist/connector-service/src/server.js`, not `dist/server.js` — this is
because the service compiles both its own code and the shared
`src/modules/airline-connectors` module together, and `tsc` mirrors the
common root directory structure into `dist/`. The `start` script in
`package.json` already points at the right path; this is just worth
knowing if you're debugging the build output directly.

## Credentials

Never stored in plaintext. `CredentialService` (in the shared framework
module) encrypts with AES-256-GCM before anything touches Postgres, and
decrypts only in-memory, immediately before a `login()` call, inside this
service. The Next.js app never sees decrypted credentials — it only ever
sends/receives encrypted blobs or triggers actions by airline key.
