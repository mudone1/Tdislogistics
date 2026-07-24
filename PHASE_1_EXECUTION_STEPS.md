# Phase 1 Execution: Step-by-Step Instructions

**Status:** ACTIVE EXECUTION  
**Date:** July 26, 2026  
**Step:** 1 of 7  
**Estimated Time:** 30 minutes per step

---

## 🎯 STEP 1: Verify Environment (NOW - 15 min)

### 1A: Check Prerequisites

```bash
# Verify Node.js installed
node --version
# Expected: v18.0.0 or higher

# Verify npm installed
npm --version

# Verify Prisma CLI available
npx prisma --version
# Expected: Prisma CLI version installed

# Verify PostgreSQL client available
psql --version
# Expected: PostgreSQL version

# Verify git is clean
git status
# Expected: working tree clean, or list of changes
```

### 1B: Check Environment Variables

```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL
# Expected: postgresql://user:pass@host/dbname

# Verify DIRECT_URL is set
echo $DIRECT_URL
# Expected: postgresql://user:pass@host/dbname (non-pooled)

# If not set, update .env
cat .env | grep -E "DATABASE_URL|DIRECT_URL"
```

### 1C: Verify Database Connection

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT version();"
# Expected: PostgreSQL 13.0 or higher

# Check current database state
psql $DATABASE_URL -c "SELECT COUNT(*) as existing_reports FROM sales_reports;"
# Expected: Shows current row count (for baseline)
```

### ✅ STEP 1 COMPLETE WHEN:
- [ ] Node.js v18+ installed
- [ ] Prisma CLI available
- [ ] PostgreSQL client available
- [ ] DATABASE_URL verified working
- [ ] DIRECT_URL verified working
- [ ] Database connection tested
- [ ] Current row count documented

**Action:** Proceed to STEP 2 once all boxes checked.

---

## 🔧 STEP 2: Generate Migrations (15-20 min)

### 2A: Generate Migration Files

```bash
# Navigate to project root
cd /path/to/TDIS

# Generate Prisma migration
# This creates migration files based on schema.prisma changes
npx prisma migrate create add_sales_analytics_tables

# Expected output:
# ✔ Migration created successfully at prisma/migrations/20260726XXXXXX_add_sales_analytics_tables
```

### 2B: Verify Migration Files

```bash
# List migration directory
ls -la prisma/migrations/

# Expected output shows:
# - 20260726XXXXXX_add_sales_analytics_tables/ (NEW)
# - migration.sql (NEW)
# - migration_lock.toml

# View the generated SQL
cat prisma/migrations/20260726XXXXXX_add_sales_analytics_tables/migration.sql
```

### 2C: Review Migration SQL

The migration should contain:

```sql
-- Create new tables
CREATE TABLE "sales_report_analytics" (...)
CREATE TABLE "report_duplicate_history" (...)
CREATE TABLE "staff_daily_performance" (...)
CREATE TABLE "airline_daily_metrics" (...)

-- Modify existing tables
ALTER TABLE "sales_reports" ADD COLUMN "airlineDetectedBy" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "detectionConfidence" DOUBLE PRECISION;
...

-- Create indexes
CREATE INDEX "idx_..." ON "table_name"(...);
...
```

### ✅ STEP 2 COMPLETE WHEN:
- [ ] Migration files generated
- [ ] SQL file contains all expected changes
- [ ] No syntax errors in migration SQL
- [ ] All 4 new tables in CREATE statements
- [ ] All 10 SalesReport fields in ALTER
- [ ] All 6 SalesTicket fields in ALTER
- [ ] All 13 indexes in CREATE INDEX

**Action:** Commit migration files to git (optional) and proceed to STEP 3.

```bash
# Optional: Commit migration files
git add prisma/migrations/
git commit -m "Phase 1: Add sales analytics tables migration"
```

---

## 🧪 STEP 3: Test on Staging Database (20-30 min)

### 3A: Create Test Database

```bash
# Create clean test database
createdb tdis_test_migration

# Verify it was created
psql -l | grep tdis_test

# Expected: Shows new database in list
```

### 3B: Set Test Database URL

```bash
# Set temporary environment variables for testing
export DATABASE_URL="postgresql://localhost/tdis_test_migration"
export DIRECT_URL="postgresql://localhost/tdis_test_migration"

# Verify the URLs are set
echo $DATABASE_URL
echo $DIRECT_URL
```

### 3C: Create Tables in Test Database

```bash
# Initialize Prisma on test database
# This creates the base schema
npx prisma db push --skip-generate

# Expected: Creates all tables including new ones
```

### 3D: Run Migration on Test Database

```bash
# Apply the migration
npx prisma migrate deploy

# Expected output:
# ✔ Prisma schema has been successfully synchronized with the database.
# Ran 1 migration:
#   add_sales_analytics_tables
```

### 3E: Verify Test Database

```bash
# Connect to test database
psql $DATABASE_URL << 'EOF'

-- Check new tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname='public' 
ORDER BY tablename;

-- Count rows in new tables (should be 0)
SELECT 
  (SELECT COUNT(*) FROM sales_report_analytics) as analytics,
  (SELECT COUNT(*) FROM report_duplicate_history) as duplicate_history,
  (SELECT COUNT(*) FROM staff_daily_performance) as staff_daily,
  (SELECT COUNT(*) FROM airline_daily_metrics) as airline_daily;

-- Check indexes
SELECT indexname FROM pg_indexes 
WHERE schemaname='public' AND indexname LIKE '%sales%' OR indexname LIKE '%staff%' OR indexname LIKE '%airline%'
ORDER BY indexname;

EOF

# Expected: 4 new tables exist with 0 rows, 13 indexes created
```

### ✅ STEP 3 COMPLETE WHEN:
- [ ] Test database created
- [ ] Environment variables set
- [ ] Migration deployed successfully
- [ ] All 4 new tables exist
- [ ] All 13 indexes created
- [ ] New tables are empty (0 rows)
- [ ] No errors in migration

**Action:** Proceed to STEP 4 to test backward compatibility.

---

## ✓ STEP 4: Test Backward Compatibility (15-20 min)

### 4A: Run Old Queries on Test Database

```bash
# Test that existing queries still work
psql $DATABASE_URL << 'EOF'

-- Old query: Find reports by airline
SELECT id, airline, reportDate, grandTotal 
FROM sales_reports 
WHERE airline = 'AIRPEACE' 
LIMIT 5;

-- Old query: Group by staff
SELECT staffName, COUNT(*), SUM(amount) 
FROM sales_transactions 
WHERE reportId IS NOT NULL 
GROUP BY staffName 
ORDER BY SUM(amount) DESC;

-- Old query: Tickets by airline
SELECT airline, COUNT(*), SUM(ticketValue) 
FROM sales_tickets 
GROUP BY airline;

EOF

# Expected: All queries execute without errors, return valid results
```

### 4B: Verify No Breaking Changes

```bash
# Test that application code still works
cd /path/to/TDIS

# Regenerate Prisma client
npx prisma generate

# Expected: ✔ Prisma client generated successfully

# Run TypeScript type check (if applicable)
npm run type-check
# Expected: No type errors
```

### ✅ STEP 4 COMPLETE WHEN:
- [ ] All old queries execute successfully
- [ ] No data integrity issues
- [ ] Prisma client regenerates without errors
- [ ] No TypeScript errors
- [ ] Backward compatibility confirmed

**Action:** Proceed to STEP 5 to test rollback procedure.

---

## ↩️ STEP 5: Test Rollback (15-20 min)

### 5A: Perform Rollback

```bash
# Mark migration as rolled back
npx prisma migrate resolve --rolled-back add_sales_analytics_tables

# Expected output:
# ✔ Migration successfully marked as rolled back in the database
```

### 5B: Verify Rollback

```bash
# Check that new tables are gone
psql $DATABASE_URL << 'EOF'

SELECT tablename FROM pg_tables 
WHERE schemaname='public' 
ORDER BY tablename;

-- Should NOT show:
-- sales_report_analytics
-- report_duplicate_history
-- staff_daily_performance
-- airline_daily_metrics

-- But SHOULD still show:
-- sales_reports
-- sales_transactions
-- sales_tickets

EOF
```

### 5C: Re-Apply Migration

```bash
# Re-apply the migration to restore state
npx prisma migrate deploy

# Expected: Migration applied again successfully
```

### ✅ STEP 5 COMPLETE WHEN:
- [ ] Rollback marked successfully
- [ ] New tables removed in rollback
- [ ] Old tables still intact
- [ ] Migration re-applies successfully
- [ ] Rollback procedure verified

**Action:** Proceed to STEP 6 to deploy to staging.

---

## 🚀 STEP 6: Deploy to Staging (20-30 min)

### 6A: Reset Environment Variables

```bash
# Switch back to actual staging database
# (Or set to staging if using staging environment)

unset DATABASE_URL
unset DIRECT_URL

# Source from .env or set manually
export DATABASE_URL="postgresql://user:pass@staging-host/tdis_db"
export DIRECT_URL="postgresql://user:pass@staging-host/tdis_db_direct"

# Verify
echo $DATABASE_URL
echo $DIRECT_URL
```

### 6B: Create Backup

```bash
# Create backup of staging database
mkdir -p backups
pg_dump $DATABASE_URL > backups/backup_staging_$(date +%Y%m%d_%H%M%S).sql

# Verify backup was created
ls -lh backups/backup_staging_*.sql

# Expected: File should be several MB in size
```

### 6C: Deploy Migration

```bash
# Run the migration on staging
npx prisma migrate deploy

# Expected output:
# ✔ Prisma schema has been successfully synchronized with the database.
# Ran 1 migration:
#   add_sales_analytics_tables
```

### 6D: Verify Staging

```bash
# Connect to staging and verify
psql $DATABASE_URL << 'EOF'

-- Count new tables
SELECT 
  (SELECT COUNT(*) FROM pg_tables WHERE tablename='sales_report_analytics') as has_analytics,
  (SELECT COUNT(*) FROM pg_tables WHERE tablename='report_duplicate_history') as has_duplicate,
  (SELECT COUNT(*) FROM pg_tables WHERE tablename='staff_daily_performance') as has_staff,
  (SELECT COUNT(*) FROM pg_tables WHERE tablename='airline_daily_metrics') as has_airline;

-- Verify old data still intact
SELECT COUNT(*) as report_count FROM sales_reports;
SELECT COUNT(*) as transaction_count FROM sales_transactions;
SELECT COUNT(*) as ticket_count FROM sales_tickets;

EOF

# Expected: All 4 new tables exist, old tables unchanged
```

### ✅ STEP 6 COMPLETE WHEN:
- [ ] Staging backup created
- [ ] Migration deployed to staging
- [ ] All 4 new tables exist in staging
- [ ] Old tables intact with data
- [ ] No errors in staging logs

**Action:** Monitor staging for 24 hours, then proceed to STEP 7 for production.

---

## 🎯 STEP 7: Production Deployment (30-45 min)

### 7A: Final Backup

```bash
# Create backup of production database
# THIS IS CRITICAL - DO NOT SKIP

pg_dump $PRODUCTION_DATABASE_URL > backups/backup_production_$(date +%Y%m%d_%H%M%S).sql

# Verify backup size and integrity
ls -lh backups/backup_production_*.sql

# Verify backup can be read
file backups/backup_production_*.sql

# Expected: File should be large (50MB+) and type 'ASCII text'
```

### 7B: Switch to Production URLs

```bash
# Set production database URLs
export DATABASE_URL="postgresql://user:pass@prod-host/tdis_db"
export DIRECT_URL="postgresql://user:pass@prod-host/tdis_db_direct"

# Verify
echo $DATABASE_URL
```

### 7C: Deploy to Production

```bash
# Run the migration on production
# This is the live step - run with confidence after staging validation

npx prisma migrate deploy

# Expected output:
# ✔ Prisma schema has been successfully synchronized with the database.
# Ran 1 migration:
#   add_sales_analytics_tables

# Monitor for any errors
# If anything goes wrong, rollback immediately using backup
```

### 7D: Post-Deployment Verification

```bash
# Verify all tables created in production
psql $DATABASE_URL << 'EOF'

-- Quick sanity check
SELECT 
  (SELECT COUNT(*) FROM sales_report_analytics) as analytics_count,
  (SELECT COUNT(*) FROM report_duplicate_history) as duplicate_count,
  (SELECT COUNT(*) FROM staff_daily_performance) as staff_count,
  (SELECT COUNT(*) FROM airline_daily_metrics) as airline_count,
  (SELECT COUNT(*) FROM sales_reports) as report_count;

-- Verify indexes
SELECT COUNT(*) as index_count FROM pg_indexes WHERE schemaname='public';

EOF

# Expected: All tables exist, old data counts unchanged, 13+ indexes
```

### 7E: Monitor Production

```bash
# Monitor application logs for next 24 hours
tail -f /var/log/application.log | grep -i error

# Monitor database for any issues
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"

# Watch for slow queries
psql $DATABASE_URL -c "SELECT * FROM pg_stat_statements WHERE mean_time > 1000;"
```

### ✅ STEP 7 COMPLETE WHEN:
- [ ] Production backup created and verified
- [ ] Migration deployed successfully
- [ ] All 4 new tables exist in production
- [ ] All 13 indexes created
- [ ] Old data intact and queryable
- [ ] Application running without errors
- [ ] 24-hour monitoring shows no issues

---

## ✨ PHASE 1 COMPLETE!

**When all 7 steps verified:**

```bash
# Clean up test database
dropdb tdis_test_migration

# Update task status
# (Mark Task #2 and #3 as completed)

# Archive backups
# (Keep for 60 days minimum)

# Document results
# (Update PHASE_1_RESULTS.md)

# Notify team
# Phase 1 complete ✅
# Phase 2 ready to start
```

---

## 📊 Quick Reference

| Step | Task | Time | Checkpoint |
|------|------|------|------------|
| 1 | Verify environment | 15m | Prerequisites OK |
| 2 | Generate migrations | 20m | SQL files created |
| 3 | Test on staging | 30m | Tables created, 0 rows |
| 4 | Test compatibility | 20m | Old queries work |
| 5 | Test rollback | 20m | Rollback verified |
| 6 | Deploy to staging | 30m | Staging verified |
| 7 | Deploy to production | 45m | Production verified |
| **TOTAL** | **Phase 1** | **~3.5h** | **✅ COMPLETE** |

---

## 🆘 If Something Goes Wrong

**Migration hung?**
```bash
# Check for blocking queries
psql $DATABASE_URL -c "SELECT * FROM pg_locks;"

# Kill blocking processes if needed
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle';"
```

**Need to rollback?**
```bash
# Quick rollback in database
npx prisma migrate resolve --rolled-back add_sales_analytics_tables

# Or restore from backup
psql $PRODUCTION_DATABASE_URL < backups/backup_production_XXXXXX.sql
```

**Database corrupted?**
```bash
# Restore from backup immediately
pg_restore -d $PRODUCTION_DATABASE_URL backups/backup_production_XXXXXX.sql
```

---

**Phase 1 Execution: ACTIVE** 🚀  
**Current Step:** 1 of 7  
**Estimated Completion:** July 29, 2026

Begin with STEP 1 now!
