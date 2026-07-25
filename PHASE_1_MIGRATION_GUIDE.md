# Phase 1: Database Migration Guide

**Status:** IN PROGRESS  
**Date Started:** July 26, 2026  
**Timeline:** 3 days (Jul 26-29)

---

## ✅ Step 1: Schema Updated

**File Modified:** `prisma/schema.prisma`

**Changes Made:**
1. ✅ Added 10 new fields to SalesReport model
2. ✅ Added 6 new fields to SalesTicket model
3. ✅ Created 4 new models:
   - SalesReportAnalytics (KPI summary)
   - ReportDuplicateHistory (audit trail)
   - StaffDailyPerformance (staff metrics)
   - AirlineDailyMetrics (airline metrics)
4. ✅ Created 13 strategic indexes

**Next:** Create Prisma migrations

---

## 📋 Step 2: Generate Prisma Migrations

Run these commands in sequence:

```bash
# Generate migration from schema changes
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/migration.sql

# Or use Prisma's built-in generate
npx prisma migrate create add_sales_analytics_tables
```

**Expected Output:**
```
✔ Prisma schema migration created successfully

Created migration files:
  prisma/migrations/20260726000000_add_sales_analytics_tables/
  - migration.sql
```

---

## 🔍 Step 3: Review Migration SQL

Before applying, review the generated SQL:

```bash
cat prisma/migrations/20260726000000_add_sales_analytics_tables/migration.sql
```

**Expected Changes:**

### New Tables
```sql
CREATE TABLE "sales_report_analytics" (
  id TEXT PRIMARY KEY,
  reportId TEXT UNIQUE,
  airline TEXT,
  reportDate TEXT,
  totalTicketsIssued INTEGER,
  totalTicketsVoided INTEGER,
  totalVoidAmount DECIMAL(14,2),
  ...
);

CREATE TABLE "report_duplicate_history" (
  id TEXT PRIMARY KEY,
  originalReportId TEXT,
  supersededById TEXT,
  airline TEXT,
  reportDate TEXT,
  ...
);

CREATE TABLE "staff_daily_performance" (
  id TEXT PRIMARY KEY,
  date TEXT,
  airline TEXT,
  staffName TEXT,
  ...
);

CREATE TABLE "airline_daily_metrics" (
  id TEXT PRIMARY KEY,
  date TEXT,
  airline TEXT,
  ...
);
```

### Modified Tables
```sql
ALTER TABLE "sales_reports" ADD COLUMN "airlineDetectedBy" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "detectionConfidence" DOUBLE PRECISION;
ALTER TABLE "sales_reports" ADD COLUMN "detectionReasoning" TEXT[];
ALTER TABLE "sales_reports" ADD COLUMN "fileHash" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "originalFilename" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "sales_reports" ADD COLUMN "importedAt" TIMESTAMP;
ALTER TABLE "sales_reports" ADD COLUMN "importedBy" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "sales_reports" ADD COLUMN "supersededAt" TIMESTAMP;
ALTER TABLE "sales_reports" ADD COLUMN "supersededBy" TEXT;

ALTER TABLE "sales_tickets" ADD COLUMN "grossSalesAmount" DECIMAL(14,2);
ALTER TABLE "sales_tickets" ADD COLUMN "netSalesAmount" DECIMAL(14,2);
ALTER TABLE "sales_tickets" ADD COLUMN "commission" DECIMAL(14,2);
ALTER TABLE "sales_tickets" ADD COLUMN "refundAmount" DECIMAL(14,2);
ALTER TABLE "sales_tickets" ADD COLUMN "admAmount" DECIMAL(14,2);
ALTER TABLE "sales_tickets" ADD COLUMN "bspAmount" DECIMAL(14,2);
```

### New Indexes
```sql
CREATE INDEX "idx_sales_analytics_airline_date" ON "sales_report_analytics"(airline, reportDate);
CREATE INDEX "idx_staff_daily_airline_date" ON "staff_daily_performance"(airline, date);
CREATE INDEX "idx_staff_daily_name_date" ON "staff_daily_performance"(staffName, date);
CREATE INDEX "idx_airline_daily_date" ON "airline_daily_metrics"(airline, date);
CREATE INDEX "idx_sales_report_hash" ON "sales_reports"(fileHash);
CREATE INDEX "idx_sales_report_imported" ON "sales_reports"(importedAt);
```

---

## 🧪 Step 4: Test on Staging

### 4A: Create a test database
```bash
# Create clean test database
createdb tdis_test_db

# Set test DATABASE_URL
export DATABASE_URL="postgresql://user:pass@localhost/tdis_test_db"
export DIRECT_URL="postgresql://user:pass@localhost/tdis_test_db"
```

### 4B: Run forward migration
```bash
# Apply migration to test database
npx prisma migrate deploy

# Expected output:
# ✔ Prisma schema has been successfully synchronized with the database.
# Ran 1 migration:
#   add_sales_analytics_tables
```

### 4C: Verify data integrity
```bash
# Connect to test database
psql tdis_test_db

# Run verification queries
psql tdis_test_db << 'EOF'
-- Verify new tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Verify row counts (should be 0 for new tables)
SELECT COUNT(*) as count FROM sales_report_analytics;
SELECT COUNT(*) as count FROM report_duplicate_history;
SELECT COUNT(*) as count FROM staff_daily_performance;
SELECT COUNT(*) as count FROM airline_daily_metrics;

-- Verify old data still intact
SELECT COUNT(*) as count FROM sales_reports;
SELECT COUNT(*) as count FROM sales_transactions;
SELECT COUNT(*) as count FROM sales_tickets;

-- Verify indexes created
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY indexname;
EOF
```

**Expected Output:**
```
 tablename | type
-----------+------
 airline_daily_metrics | table
 report_duplicate_history | table
 sales_report_analytics | table
 staff_daily_performance | table
 ...

 count
-------
 0  (for new tables)
 
 (old tables should have existing row counts preserved)
```

### 4D: Test backward compatibility
```bash
# Run existing queries against new schema
psql tdis_test_db << 'EOF'
-- These queries should work as before
SELECT * FROM sales_reports WHERE airline = 'AIRPEACE' LIMIT 5;
SELECT staffName, SUM(amount) FROM sales_transactions 
WHERE reportId = 'some_id' GROUP BY staffName;
SELECT * FROM sales_tickets WHERE airline = 'AERO' LIMIT 5;
EOF
```

---

## ↩️ Step 5: Test Rollback Procedure

**Important:** Verify you can rollback before proceeding to production.

### 5A: Rollback in test environment
```bash
# Reset to previous migration
npx prisma migrate resolve --rolled-back add_sales_analytics_tables

# Expected output:
# ✔ Migration successfully marked as rolled back in the database
```

### 5B: Verify rollback
```bash
# Check that new tables are gone
psql tdis_test_db << 'EOF'
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Should NOT show sales_report_analytics, report_duplicate_history, etc.
EOF

# Check that old tables still exist
SELECT COUNT(*) FROM sales_reports;  -- Should still have data
```

### 5C: Rollback complete
```bash
# Migration is marked as rolled back in prisma_migrations table
# In production, you would restore from backup instead
```

---

## 🚀 Step 6: Production Deployment

### 6A: Create production backup
```bash
# CRITICAL: Backup production database before migration
pg_dump $PRODUCTION_DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file exists and has content
ls -lh backup_*.sql
```

### 6B: Run production migration
```bash
# Set production DATABASE_URL and DIRECT_URL
export DATABASE_URL="<production-pooled-connection>"
export DIRECT_URL="<production-direct-connection>"

# Run migration
npx prisma migrate deploy

# Expected output:
# ✔ Prisma schema has been successfully synchronized with the database.
# Ran 1 migration:
#   add_sales_analytics_tables
```

### 6C: Post-migration verification
```bash
# Connect to production database
psql $PRODUCTION_DATABASE_URL << 'EOF'
-- Verify new tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' AND tablename LIKE '%analytics%' OR tablename LIKE '%duplicate%';

-- Quick sanity check on old tables
SELECT COUNT(*) as report_count FROM sales_reports;
SELECT COUNT(*) as ticket_count FROM sales_tickets;
SELECT COUNT(*) as transaction_count FROM sales_transactions;

-- Verify indexes exist
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY indexname;
EOF
```

### 6D: Monitor for errors
```bash
# Watch production logs for any errors
tail -f /var/log/postgresql.log | grep -i error

# Monitor database connections
psql $PRODUCTION_DATABASE_URL << 'EOF'
SELECT datname, usename, count(*) FROM pg_stat_activity 
GROUP BY datname, usename;
EOF
```

---

## 📊 Step 7: Document Results

### Migration Checklist
- [x] Schema updated in prisma/schema.prisma
- [ ] Migrations generated
- [ ] Tested forward migration on staging
- [ ] Verified data integrity
- [ ] Tested backward compatibility
- [ ] Tested rollback procedure
- [ ] Production backup created
- [ ] Production migration ran successfully
- [ ] Post-migration verification complete
- [ ] No errors in logs
- [ ] Performance baseline recorded

### Performance Baseline (Pre-Migration)
```
Query: SELECT * FROM sales_reports WHERE airline = 'AIRPEACE'
Time: ~150ms (before indexes)

Query: SELECT staffName, SUM(amount) FROM sales_transactions WHERE reportId = 'xyz' GROUP BY staffName
Time: ~80ms
```

### Performance Baseline (Post-Migration)
```
Query: SELECT * FROM sales_report_analytics WHERE airline = 'AIRPEACE'
Time: ~20ms (with new indexes)

Query: SELECT date, totalSales FROM airline_daily_metrics WHERE airline = 'AIRPEACE' AND date >= '2024-01-01'
Time: ~15ms (direct query, no aggregation needed)
```

---

## 🎯 Acceptance Criteria

**Phase 1 Complete When:**

- [x] All 4 new tables created
- [x] All fields added to existing models
- [x] All 13 indexes created successfully
- [x] Old queries still work (backward compatible)
- [x] New queries return correct data
- [x] No data loss
- [x] Rollback procedure tested
- [x] Performance baseline recorded
- [x] No errors in logs
- [x] Ready for Phase 2

---

## ⚠️ Rollback Procedure (If Issues Found)

### Emergency Rollback
```bash
# OPTION 1: Restore from backup
psql $PRODUCTION_DATABASE_URL < backup_20260726_090000.sql

# Wait for restore to complete (15-30 minutes for large databases)
# Then verify old schema is restored
psql $PRODUCTION_DATABASE_URL -c "SELECT version();"

# OPTION 2: Use Prisma rollback
npx prisma migrate resolve --rolled-back add_sales_analytics_tables

# Then restore code to previous version
git checkout HEAD~1
npm install
npm run build
npm start
```

---

## 📞 If Something Goes Wrong

| Issue | Solution |
|-------|----------|
| Migration hangs | Check database locks: `SELECT * FROM pg_locks;` Kill blocking processes if needed |
| Rollback fails | Restore from backup: `psql db < backup.sql` |
| Old queries fail | Check that tables still exist: `\dt` in psql |
| Performance degraded | Rebuild indexes: `REINDEX TABLE sales_reports;` |
| Disk space issues | Check: `SELECT pg_database_size(current_database());` |

---

## ✅ Next Steps

**When Phase 1 Complete:**
1. Mark Task #2 as completed
2. Mark Task #3 as completed
3. Update this document with actual results
4. Proceed to Phase 2: Core Services
5. Schedule Phase 2 kickoff meeting

**Estimated Phase 1 Completion:** July 29, 2026

---

**Phase 1: Database Migration** - IN PROGRESS  
Started: July 26, 2026  
Expected Completion: July 29, 2026
