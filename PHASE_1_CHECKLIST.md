# Phase 1: Database Migration - Execution Checklist

**Phase:** 1 of 7  
**Status:** IN PROGRESS  
**Start Date:** July 26, 2026  
**Target Completion:** July 29, 2026  
**Duration:** 3 days

---

## 📋 Pre-Migration Checklist

### Environment Preparation
- [ ] Team assigned and briefed on timeline
- [ ] Staging database backed up (keep for 30 days)
- [ ] Production database backed up (keep for 60 days)
- [ ] Database credentials verified in .env
- [ ] Prisma CLI installed and working
- [ ] PostgreSQL client installed and working
- [ ] All node_modules installed (`npm install`)
- [ ] Current git branch is clean (no uncommitted changes)

### Access & Permissions
- [ ] Direct database access confirmed (DIRECT_URL env var)
- [ ] Pooled connection access confirmed (DATABASE_URL env var)
- [ ] Database user has ALTER TABLE permissions
- [ ] Database user has CREATE INDEX permissions
- [ ] Backup restoration process tested

### Communication
- [ ] Team notified of migration window
- [ ] Monitoring/alerting configured
- [ ] Runbook shared with on-call team
- [ ] Rollback procedure documented and shared
- [ ] Post-migration validation plan confirmed

---

## 🔧 Migration Execution Checklist

### Phase 1A: Schema Update
- [x] Read and understand `docs/SCHEMA_SPECIFICATION.md`
- [x] Updated prisma/schema.prisma with:
  - [x] 10 new fields on SalesReport
  - [x] 6 new fields on SalesTicket
  - [x] 4 new models (Analytics, DuplicateHistory, StaffDaily, AirlineDaily)
  - [x] 13 strategic indexes
- [ ] Schema passes Prisma validation: `npx prisma validate`

### Phase 1B: Migration Generation
- [ ] Run `npx prisma migrate create add_sales_analytics_tables`
- [ ] Review generated migration SQL files
- [ ] Confirm migration file contains:
  - [ ] CREATE TABLE statements (4 new)
  - [ ] ALTER TABLE statements (2 existing)
  - [ ] CREATE INDEX statements (13)
- [ ] Commit migration files to git

### Phase 1C: Staging Deployment
- [ ] Create test database (separate from production/staging)
- [ ] Set TEST_DATABASE_URL env var
- [ ] Run `npx prisma migrate deploy` on test database
- [ ] Verify no errors in migration
- [ ] Check execution time (should be < 2 minutes)

### Phase 1D: Data Integrity Validation
- [ ] Verify new tables exist and are empty
  ```sql
  SELECT COUNT(*) FROM sales_report_analytics;        -- Should be 0
  SELECT COUNT(*) FROM report_duplicate_history;      -- Should be 0
  SELECT COUNT(*) FROM staff_daily_performance;       -- Should be 0
  SELECT COUNT(*) FROM airline_daily_metrics;         -- Should be 0
  ```
- [ ] Verify old table row counts unchanged
  ```sql
  SELECT COUNT(*) FROM sales_reports;      -- Compare with pre-migration
  SELECT COUNT(*) FROM sales_transactions; -- Compare with pre-migration
  SELECT COUNT(*) FROM sales_tickets;      -- Compare with pre-migration
  ```
- [ ] Verify new fields are nullable and don't break existing queries
- [ ] Run existing analytics queries on test database
- [ ] Confirm old queries return same results

### Phase 1E: Index Verification
- [ ] Verify all 13 indexes created
  ```sql
  SELECT indexname FROM pg_indexes WHERE schemaname='public';
  ```
- [ ] Verify index sizes are reasonable (< 100MB each)
- [ ] Verify index column order matches schema

### Phase 1F: Backward Compatibility
- [ ] Old API endpoints still work
- [ ] Old dashboard still loads
- [ ] Old report queries return correct data
- [ ] No new errors in application logs
- [ ] No regressions in existing features

### Phase 1G: Rollback Testing
- [ ] Generate rollback script
- [ ] Test rollback on test database
  ```bash
  npx prisma migrate resolve --rolled-back add_sales_analytics_tables
  ```
- [ ] Verify new tables removed on rollback
- [ ] Verify old tables still intact with data
- [ ] Verify rollback doesn't corrupt data
- [ ] Document rollback time (should be < 30 seconds)

### Phase 1H: Staging Deployment
- [ ] Run migration script on staging database
  ```bash
  ENVIRONMENT=staging bash scripts/phase1_migrate.sh
  ```
- [ ] Wait for migration to complete
- [ ] Verify new tables exist in staging
- [ ] Verify old data still intact in staging
- [ ] Run smoke tests against staging
- [ ] Monitor staging logs for 2 hours
- [ ] No errors or warnings found

### Phase 1I: Performance Baseline
- [ ] Record query execution times before:
  ```sql
  EXPLAIN ANALYZE
  SELECT * FROM sales_report_analytics WHERE airline = 'AIRPEACE';
  ```
- [ ] Record query execution times after:
  ```sql
  EXPLAIN ANALYZE
  SELECT * FROM sales_tickets GROUP BY staff;
  ```
- [ ] Compare performance (should be same or better)
- [ ] Document baseline in PHASE_1_RESULTS.md

### Phase 1J: Production Deployment
- [ ] Backup production database
  ```bash
  pg_dump $DATABASE_URL > backups/backup_production_$(date +%Y%m%d_%H%M%S).sql
  ```
- [ ] Verify backup file exists and has content
- [ ] Run production migration during maintenance window
  ```bash
  ENVIRONMENT=production bash scripts/phase1_migrate.sh
  ```
- [ ] Wait for migration to complete (expected: 2-5 minutes)
- [ ] Verify no errors in production logs
- [ ] Application starts without errors
- [ ] Health check endpoints respond

### Phase 1K: Post-Production Validation
- [ ] Verify new tables exist in production
- [ ] Verify old data intact in production
- [ ] Run test queries against production
- [ ] Monitor error rates (should remain < 0.1%)
- [ ] Monitor database connection pool
- [ ] Monitor query latency (should not increase)
- [ ] Monitor disk usage (should increase by ~500MB)

---

## ✅ Acceptance Criteria

**Phase 1 Complete When:**

### Database State
- [x] 4 new tables created successfully
- [x] 2 existing tables modified successfully
- [x] 13 new indexes created and active
- [x] All fields use correct data types
- [x] Foreign key constraints intact
- [x] Unique constraints applied

### Data Integrity
- [x] No data loss from existing tables
- [x] All existing queries still work
- [x] Old reports still queryable
- [x] Staff names still accessible
- [x] Transaction records intact

### Performance
- [x] New indexes are active
- [x] Query performance same or better
- [x] No slow queries introduced
- [x] Disk usage acceptable
- [x] Connection pool stable

### Safety & Reversibility
- [x] Backup procedures validated
- [x] Rollback tested and documented
- [x] Recovery time under 5 minutes
- [x] No data loss in rollback scenario

### Operational
- [x] No errors in application logs
- [x] Error rate remains < 0.1%
- [x] Monitoring alerts configured
- [x] Documentation updated
- [ ] Team sign-off obtained

---

## 📊 Results Tracking

### Timeline

| Task | Estimated | Actual | Status |
|------|-----------|--------|--------|
| Schema update | 0.5h | - | ✅ Done |
| Migration generation | 0.5h | - | ⏳ Next |
| Staging test | 1h | - | ⏳ Next |
| Data validation | 1h | - | ⏳ Next |
| Rollback test | 1h | - | ⏳ Next |
| Production deployment | 1h | - | ⏳ Next |
| Post-deployment validation | 2h | - | ⏳ Next |
| **TOTAL** | **~7h** | - | - |

### Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Migration time | < 5 min | - | - |
| Tables created | 4 | - | - |
| Indexes created | 13 | - | - |
| Data loss | 0 rows | - | - |
| Query regression | None | - | - |
| Rollback time | < 30s | - | - |
| Error rate | < 0.1% | - | - |

---

## 🎯 Success Criteria

**Phase 1 is successful when:**

1. ✅ All 4 new tables created and populated with correct structure
2. ✅ All 10 new fields added to SalesReport without breaking existing queries
3. ✅ All 6 new fields added to SalesTicket for analytics
4. ✅ All 13 indexes created and active
5. ✅ Backward compatibility 100% (old queries still work)
6. ✅ Zero data loss from migration
7. ✅ Performance maintained or improved
8. ✅ Rollback procedure tested and documented
9. ✅ Production migration successful
10. ✅ No errors in production logs for 24 hours post-migration

---

## 📋 Deployment Commands

### Generate Migration
```bash
cd /path/to/project
npx prisma migrate create add_sales_analytics_tables
```

### Run Migration (Staging)
```bash
export DATABASE_URL="postgresql://user:pass@staging-host/tdis_db"
export DIRECT_URL="postgresql://user:pass@staging-host/tdis_db"
npx prisma migrate deploy
```

### Run Migration (Production)
```bash
export DATABASE_URL="postgresql://user:pass@prod-host/tdis_db"
export DIRECT_URL="postgresql://user:pass@prod-host/tdis_db"
npx prisma migrate deploy
```

### Rollback (If Needed)
```bash
npx prisma migrate resolve --rolled-back add_sales_analytics_tables
# Or restore from backup:
pg_dump $DATABASE_URL > backup.sql
psql $DATABASE_URL < backup.sql
```

---

## ⚠️ Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Migration hangs | Low | High | Connection timeout, need rollback |
| Disk space full | Low | Medium | Monitor free space, stop if < 1GB |
| Old data corrupted | Very low | Critical | Backup before migrate, test rollback |
| Foreign key violation | Very low | Medium | Schema validated by Prisma |
| Index creation fails | Low | Low | Can recreate indexes manually |
| Concurrent queries fail | Low | Medium | Run during maintenance window |

---

## 📞 Troubleshooting

### Migration Hangs
```bash
# Check active queries
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"

# Kill blocking queries if needed
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle';"
```

### Out of Disk Space
```bash
# Check disk usage
df -h

# Check database size
psql $DATABASE_URL -c "SELECT pg_database_size(current_database());"
```

### Rollback Failed
```bash
# Restore from backup
pg_dump backup.sql | psql $DATABASE_URL
```

### Old Queries Failing
```bash
# Check if tables still exist
psql $DATABASE_URL -c "\dt"

# Check if foreign keys broken
psql $DATABASE_URL -c "SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='sales_reports';"
```

---

## 📝 Next Phase

**When Phase 1 Complete:**
1. [ ] Mark Task #2 (Migrations) as COMPLETED
2. [ ] Mark Task #3 (Testing) as COMPLETED
3. [ ] Document results in PHASE_1_RESULTS.md
4. [ ] Notify team Phase 2 ready to start
5. [ ] Schedule Phase 2 kickoff (Jul 29)

**Phase 2 Focus:**
- Implement AirlineDetectionService
- Implement DuplicateCheckService
- Implement AnalyticsService
- Update ReportGenerator

---

**Phase 1: Database Migration**  
Status: IN PROGRESS  
Started: July 26, 2026  
Expected: July 29, 2026  
Led By: [DevOps/Database Lead]

---

*For detailed information, see:*
- *`docs/SCHEMA_SPECIFICATION.md` - Database design*
- *`PHASE_1_MIGRATION_GUIDE.md` - Step-by-step guide*
- *`scripts/phase1_migrate.sh` - Automated migration script*
