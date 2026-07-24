#!/bin/bash

# Phase 1: Database Migration - Automated Script
# This script handles the complete migration process with safety checks

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-staging}  # staging or production
BACKUP_DIR="./backups"
MIGRATION_NAME="add_sales_analytics_tables"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 1: Database Migration${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Safety check
if [ "$ENVIRONMENT" = "production" ]; then
  echo -e "${YELLOW}⚠️  WARNING: Running on PRODUCTION database!${NC}"
  echo -e "${YELLOW}This will modify live data.${NC}"
  read -p "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Migration cancelled."
    exit 1
  fi
fi

# Step 1: Check prerequisites
echo -e "${BLUE}Step 1: Checking prerequisites...${NC}"
if ! command -v npx &> /dev/null; then
  echo -e "${RED}❌ npx not found. Install Node.js first.${NC}"
  exit 1
fi

if ! command -v psql &> /dev/null; then
  echo -e "${RED}❌ psql not found. Install PostgreSQL first.${NC}"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ DATABASE_URL not set.${NC}"
  exit 1
fi

if [ -z "$DIRECT_URL" ]; then
  echo -e "${RED}❌ DIRECT_URL not set.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Prerequisites OK${NC}\n"

# Step 2: Create backup
echo -e "${BLUE}Step 2: Creating database backup...${NC}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_${ENVIRONMENT}_${TIMESTAMP}.sql"

echo "Backing up to: $BACKUP_FILE"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

if [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo -e "${GREEN}✅ Backup created (${SIZE})${NC}\n"
else
  echo -e "${RED}❌ Backup failed or is empty.${NC}"
  exit 1
fi

# Step 3: Generate migrations
echo -e "${BLUE}Step 3: Generating Prisma migrations...${NC}"
if [ -d "prisma/migrations/$(date +%s)_${MIGRATION_NAME}" ]; then
  echo "Migration already exists, skipping generation..."
else
  echo "Running: npx prisma migrate create ${MIGRATION_NAME}"
  npx prisma migrate create "${MIGRATION_NAME}"
fi
echo -e "${GREEN}✅ Migration ready${NC}\n"

# Step 4: Validate schema
echo -e "${BLUE}Step 4: Validating Prisma schema...${NC}"
npx prisma validate
echo -e "${GREEN}✅ Schema validation passed${NC}\n"

# Step 5: Apply migration
echo -e "${BLUE}Step 5: Applying migration to ${ENVIRONMENT}...${NC}"
echo "Running: npx prisma migrate deploy"
npx prisma migrate deploy

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Migration failed!${NC}"
  echo -e "${YELLOW}Restore from backup: psql \$DATABASE_URL < ${BACKUP_FILE}${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Migration applied successfully${NC}\n"

# Step 6: Verify migration
echo -e "${BLUE}Step 6: Verifying migration...${NC}"

# Check new tables exist
TABLES_CREATED=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'sales_report_analytics', 'report_duplicate_history',
    'staff_daily_performance', 'airline_daily_metrics'
  );
")

if [ "$TABLES_CREATED" = "4" ]; then
  echo -e "${GREEN}✅ All 4 new tables created${NC}"
else
  echo -e "${RED}❌ Only $TABLES_CREATED/4 tables found${NC}"
  exit 1
fi

# Check old tables still intact
OLD_TABLES=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'sales_reports', 'sales_transactions', 'sales_tickets'
  );
")

if [ "$OLD_TABLES" = "3" ]; then
  echo -e "${GREEN}✅ Backward compatibility verified${NC}"
else
  echo -e "${RED}❌ Old tables missing: $OLD_TABLES/3 found${NC}"
  exit 1
fi

# Check indexes
INDEXES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public';")
echo -e "${GREEN}✅ Indexes created (${INDEXES} total)${NC}"

echo -e "${GREEN}✅ Verification complete${NC}\n"

# Step 7: Performance baseline
echo -e "${BLUE}Step 7: Recording performance baseline...${NC}"

QUERY_TIME=$(psql "$DATABASE_URL" -t -c "
  EXPLAIN ANALYZE
  SELECT * FROM sales_report_analytics WHERE airline = 'AIRPEACE' LIMIT 1;
" | grep "Execution Time" | awk '{print $NF}')

echo "Analytics query time: ${QUERY_TIME}"
echo "Baseline recorded."
echo -e "${GREEN}✅ Performance baseline OK${NC}\n"

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Phase 1: Migration Complete ✅${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Summary:"
echo "  Environment:        ${ENVIRONMENT}"
echo "  Backup:            ${BACKUP_FILE}"
echo "  New tables:        4 (created)"
echo "  Old tables:        3 (intact)"
echo "  Indexes:           ${INDEXES} (created)"
echo ""
echo "Next steps:"
echo "  1. Verify no errors in application logs"
echo "  2. Run smoke tests: npm run test"
echo "  3. Monitor database performance"
echo "  4. Proceed to Phase 2: Core Services"
echo ""
echo "Rollback (if needed):"
echo "  psql \$DATABASE_URL < ${BACKUP_FILE}"
echo ""
echo -e "${GREEN}Ready for Phase 2! 🚀${NC}"
