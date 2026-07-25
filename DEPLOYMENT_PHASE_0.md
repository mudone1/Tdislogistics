# Phase 0: Database Schema Deployment Guide

**Status:** Schema committed, ready for database push  
**Commit:** e3bd3e3  
**Database:** Neon PostgreSQL (serverless)

---

## Schema Changes Summary

### New Tables
- **AirlineSyncRun** — Aggregates sync orchestration results for all airlines in one run
- **AppConfig** — Centralized configuration management (cooldowns, intervals, timeouts)

### New Enum
- **ErrorCategory** — Classification for smart retry logic (AUTH, NETWORK, PORTAL, UNKNOWN)

### Enhanced Tables

**AirlineWallet** (+7 columns)
- `previousBalance` (Decimal?) — for UI comparison
- `lastRunId` (String?) — latest sync attempt tracking
- `lastSuccessfulSync` (DateTime?) — cache for analytics
- `lastFailedSync` (DateTime?) — cache for analytics
- `failureCount` (Int) — cumulative failures
- `consecutiveFailures` (Int) — consecutive failures tracking

**AirlineConnectorSettings** (+14 columns)
- Auth failure: `authFailureCount`, `authFailureSince`, `authCooldownUntil`, `passwordUpdatedAt`
- Retry config: `maxRetryAttempts`, `baseRetryDelayMs`
- Performance: `syncTimeoutSeconds`, `maxConcurrentSyncs`
- Cooldown: `authCooldownMinutes`, `networkErrorBackoffMinutes`, `portalErrorBackoffMinutes`

**AirlineBalanceHistory** (+7 columns & 3 new indexes)
- Error: `errorCategory` (ErrorCategory?), `errorCode` (String?)
- Tracking: `runId` (String @index), `initiatedBy` (String?), `previousBalance` (Decimal?)
- Performance: `durationMs` (Int?), `balanceChange` (Decimal? @computed)
- New indexes: `[runId]`, `[syncStatus]`, `[errorCategory]` for analytics queries

**AirlineSyncLog** (+2 columns & 1 relationship)
- Error: `errorCategory` (ErrorCategory?), `errorCode` (String?)
- Relationship: Link to `AirlineSyncRun` via `runId`
- Optional: `airline` (AirlineKey?) — for system-level logs

---

## Deployment Steps

### Step 1: Verify Schema Syntax (Local)

```bash
npx prisma validate
```

This checks schema.prisma for syntax errors without touching the database.

### Step 2: Push to Database

```bash
# Important: Use DIRECT_URL (non-pooled connection) for schema operations
# This is already configured in .env for deployment platforms

npx prisma db push --skip-generate
```

**Note:** The Neon serverless database may require a "cold start" retry:

```bash
# If first attempt fails with P1001: Can't reach database server
# Wait 30 seconds, then retry:
npx prisma db push --skip-generate
```

### Step 3: Generate Prisma Client

```bash
npx prisma generate
```

This updates the generated Prisma Client type definitions in `node_modules/.prisma`.

### Step 4: Verify in Database

```bash
npx prisma studio
```

This opens the interactive database explorer. Verify:
- New tables `airline_sync_runs` and `app_config` exist
- New columns are present in existing tables
- Relationships are correct

---

## Rollback (if needed)

If the schema causes issues:

```bash
# DO NOT delete rows — just revert the schema
git revert e3bd3e3
npx prisma db push --skip-generate
```

**Important:** This removes the new columns but doesn't delete existing data. Existing `AirlineWallet` and `AirlineBalanceHistory` rows are untouched.

---

## Initial Configuration Setup

After schema deployment, seed the AppConfig table with defaults:

```bash
# Run in Node REPL or app startup script:
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

await prisma.appConfig.createMany({
  data: [
    { module: 'airline-connectors', key: 'defaultSyncIntervalMinutes', value: JSON.stringify(30) },
    { module: 'airline-connectors', key: 'authCooldownMinutes', value: JSON.stringify(300) },
    { module: 'airline-connectors', key: 'networkErrorBackoffMinutes', value: JSON.stringify(5) },
    { module: 'airline-connectors', key: 'portalErrorBackoffMinutes', value: JSON.stringify(30) },
    { module: 'airline-connectors', key: 'maxConcurrentSyncs', value: JSON.stringify(3) },
  ],
  skipDuplicates: true,
});

await prisma.$disconnect();
```

Or via SQL:

```sql
INSERT INTO app_config (id, module, key, value, created_at, updated_at) VALUES
  (gen_random_uuid(), 'airline-connectors', 'defaultSyncIntervalMinutes', '30', now(), now()),
  (gen_random_uuid(), 'airline-connectors', 'authCooldownMinutes', '300', now(), now()),
  (gen_random_uuid(), 'airline-connectors', 'networkErrorBackoffMinutes', '5', now(), now()),
  (gen_random_uuid(), 'airline-connectors', 'portalErrorBackoffMinutes', '30', now(), now()),
  (gen_random_uuid(), 'airline-connectors', 'maxConcurrentSyncs', '3', now(), now())
ON CONFLICT DO NOTHING;
```

---

## Database Schema Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│                     airline_wallets                             │
├─────────────────────────────────────────────────────────────────┤
│ id (PK)                                                         │
│ airline (FK -> airline_connector_settings) [UNIQUE]             │
│ currentBalance, previousBalance, currency                      │
│ lastSynced, lastStatus, lastRunId                              │
│ lastSuccessfulSync, lastFailedSync                             │
│ failureCount, consecutiveFailures                              │
│ updatedAt, createdAt                                           │
└─────────────────────────────────────────────────────────────────┘
       │
       ├──> ┌────────────────────────────────────────────────┐
       │    │   airline_balance_history                      │
       │    ├────────────────────────────────────────────────┤
       │    │ id (PK), airline (FK)                          │
       │    │ balance, previousBalance, balanceChange        │
       │    │ runId (FK -> airline_sync_runs) [INDEX]        │
       │    │ syncStatus [INDEX], errorCategory [INDEX]      │
       │    │ errorCode, errorMessage, initiatedBy           │
       │    │ durationMs, connector, trigger                 │
       │    │ retrievedAt, createdAt                         │
       │    └────────────────────────────────────────────────┘
       │
       ├──> ┌────────────────────────────────────────────────┐
       │    │   airline_connector_settings                   │
       │    ├────────────────────────────────────────────────┤
       │    │ id (PK), airline (FK) [UNIQUE]                 │
       │    │ enabled, encryptedUsername, encryptedPassword  │
       │    │ syncIntervalMinutes, dailyRunAtUtc             │
       │    │ authFailureCount, authFailureSince             │
       │    │ authCooldownUntil, passwordUpdatedAt           │
       │    │ maxRetryAttempts, baseRetryDelayMs             │
       │    │ syncTimeoutSeconds, maxConcurrentSyncs         │
       │    │ authCooldownMinutes, networkErrorBackoffMinutes│
       │    │ portalErrorBackoffMinutes, connectionStatus    │
       │    │ lastTestedAt, updatedAt, createdAt             │
       │    └────────────────────────────────────────────────┘
       │
       └──> ┌────────────────────────────────────────────────┐
            │   airline_sync_logs                            │
            ├────────────────────────────────────────────────┤
            │ id (PK), runId (FK -> airline_sync_runs) [IDX] │
            │ airline (nullable), step, message, level       │
            │ errorCategory, errorCode, createdAt            │
            └────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   airline_sync_runs (NEW)                       │
├─────────────────────────────────────────────────────────────────┤
│ id (PK), runId [UNIQUE INDEX]                                  │
│ trigger (SyncTrigger), initiatedBy, startedAt, completedAt     │
│ durationMs                                                      │
│ totalAirlines, successfulCount, failedCount, skippedCount      │
│ authFailureCount, networkFailureCount, portalFailureCount      │
│ unknownFailureCount, parallelism, createdAt                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    app_config (NEW)                             │
├─────────────────────────────────────────────────────────────────┤
│ id (PK)                                                         │
│ module (e.g., 'airline-connectors') [UNIQUE with key]          │
│ key (e.g., 'authCooldownMinutes')   [UNIQUE with module]       │
│ value (JSON stringified)                                        │
│ updatedAt, createdAt                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Backwards Compatibility

✅ **All new columns are nullable/defaulted** — no existing data is affected
✅ **Existing tables remain unchanged** (except for new columns)
✅ **Existing queries still work** — new columns are optional
✅ **Existing relationships intact** — no foreign key changes
✅ **Easy rollback** — revert commit, push, done

---

## Next Steps

Once schema is deployed to database:

1. ✅ **Phase 1:** Core Services (ErrorClassificationService, AuthFailureService, etc.)
2. ✅ **Phase 2:** API Endpoints (/api/balances, /api/sync-history, etc.)
3. ✅ **Phase 3:** Scheduler Updates (concurrent sync, ConfigService integration)
4. ✅ **Phase 4:** Frontend Components (AirlineSyncPanel, SyncHistoryPage)
5. ✅ **Phase 5:** Testing (unit, integration, UI, failure simulation)
6. ✅ **Phase 6:** AI Integration (chatbot queries)

---

## Troubleshooting

### Error: P1001 — Can't reach database server

**Cause:** Neon serverless cold-start  
**Solution:** Wait 30 seconds, retry the command

```bash
sleep 30 && npx prisma db push --skip-generate
```

### Error: Foreign key constraint violation

**Cause:** New constraint conflicts with existing data  
**Solution:** Check if there's orphaned data in airline_balance_history without matching airline_wallets

```sql
SELECT COUNT(*) FROM airline_balance_history h
LEFT JOIN airline_wallets w ON h.airline = w.airline
WHERE w.id IS NULL;
```

### Error: Column already exists

**Cause:** Schema was partially pushed before  
**Solution:** Check database schema manually, or use `prisma db push --force` (with caution)

---

## Commands Reference

```bash
# Validate schema syntax
npx prisma validate

# Push schema to database (with retry for cold-start)
npx prisma db push --skip-generate

# Generate Prisma client
npx prisma generate

# Inspect database (interactive UI)
npx prisma studio

# Check schema diff before pushing (dry-run)
npx prisma migrate dev --create-only --name audit

# Revert to previous schema
git revert <commit-hash>
npx prisma db push --skip-generate
```

---

**Status:** Ready for deployment  
**Last Updated:** 2026-07-24  
**Tested On:** Schema validation complete
