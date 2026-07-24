# Sales Report Modernization - Implementation Master Plan

**Status:** APPROVED FOR IMPLEMENTATION  
**Estimated Effort:** 120 developer hours  
**Timeline:** 7 weeks (7 phases)  
**Start Date:** July 25, 2026  
**Go-Live Target:** September 5, 2026

---

## 📋 Executive Overview

This is the definitive implementation guide for modernizing the Sales Report module with:
- **Intelligent airline auto-detection** with confidence scoring
- **Multi-factor duplicate prevention** with overwrite control
- **Full-featured analytics engine** with KPIs, trends, and staff performance
- **Natural language chatbot** integration for upload and queries
- **Modern executive dashboard** with animations and real-time data
- **Phased rollout** starting with Admin/Finance, then all users

All code is modular, reusable, and scalable for future AI analytics.

---

## 🗂️ PHASE 0: SPECIFICATION & DESIGN (Week 1, Days 1-2)

### Deliverables
1. **Database Schema Specification** (`SCHEMA_SPECIFICATION.md`)
   - Complete Prisma model definitions with all fields
   - Relationships and constraints
   - Indexes for query optimization
   - Migration strategy

2. **API Specification** (`API_SPECIFICATION.md`)
   - All endpoints (request/response schemas)
   - Authentication & authorization
   - Error codes and messages
   - Rate limiting strategy

3. **Service Architecture** (`SERVICE_ARCHITECTURE.md`)
   - AirlineDetectionService design
   - DuplicateCheckService algorithm
   - AnalyticsService query patterns
   - SalesReportAssistant intent mapping

4. **Frontend Component Structure** (`FRONTEND_STRUCTURE.md`)
   - Component hierarchy and file locations
   - State management patterns
   - Styling approach (Tailwind + Framer Motion)
   - Responsive breakpoints

5. **Chatbot Intent System** (`CHATBOT_INTENTS.md`)
   - All intent types and examples
   - Parameter extraction rules
   - Context awareness strategy
   - Response templates

### Key Decisions to Lock In
- [ ] Airline detection algorithm specifics
- [ ] Duplicate detection tolerance levels (±2% on sales amount?)
- [ ] Analytics caching strategy (Redis? Materialized views?)
- [ ] Chatbot NLU provider (Claude API? Groq if available?)
- [ ] Date format and timezone handling

### Acceptance Criteria
- [ ] All specifications reviewed and approved
- [ ] No ambiguity in requirements
- [ ] API contracts finalized
- [ ] Database design reviewed for scalability
- [ ] Team understands full scope

**Owner:** Architecture Lead  
**Duration:** 2 days  
**Status:** NOT STARTED

---

## 🗄️ PHASE 1: DATABASE SETUP (Week 1, Days 3-5)

### Phase 1A: New Analytics Tables

**Create Prisma migrations for:**

```typescript
// SalesReportAnalytics - Executive KPI summary per report
model SalesReportAnalytics {
  id                    String      @id @default(cuid())
  reportId              String      @unique
  airline               AirlineKey
  reportDate            String      // "DD/MM/YYYY"
  reportingPeriod       String?     // e.g., "Jul 2024"
  
  // Executive KPIs
  totalTicketsIssued    Int
  totalTicketsVoided    Int
  totalVoidAmount       Decimal @db.Decimal(14, 2)
  totalCreditAmount     Decimal @db.Decimal(14, 2)
  totalDebitAmount      Decimal @db.Decimal(14, 2)
  grossSalesAmount      Decimal @db.Decimal(14, 2)
  netSalesAmount        Decimal @db.Decimal(14, 2)
  totalCommission       Decimal @db.Decimal(14, 2)
  
  // Airline-specific metrics
  bspValues             Decimal? @db.Decimal(14, 2)
  refundValues          Decimal? @db.Decimal(14, 2)
  admValues             Decimal? @db.Decimal(14, 2)
  
  // Metadata
  createdAt             DateTime    @default(now())
  
  report SalesReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  
  @@index([airline, reportDate])
  @@map("sales_report_analytics")
}

// ReportDuplicateHistory - Track report supersessions
model ReportDuplicateHistory {
  id                String   @id @default(cuid())
  originalReportId  String
  supersededById    String?  // Which report replaced this
  airline           AirlineKey
  reportDate        String
  
  originalStatus    SalesReportStatus
  replacedAt        DateTime?
  replacedBy        String?  // User who approved replacement
  
  createdAt         DateTime @default(now())
  
  @@index([airline, reportDate])
  @@map("report_duplicate_history")
}

// StaffDailyPerformance - Denormalized staff metrics for queries
model StaffDailyPerformance {
  id                String   @id @default(cuid())
  date              String   // "DD/MM/YYYY"
  airline           AirlineKey
  staffName         String
  
  ticketsIssued     Int
  salesAmount       Decimal @db.Decimal(14, 2)
  commission        Decimal @db.Decimal(14, 2)
  
  createdAt         DateTime @default(now())
  
  @@index([airline, date])
  @@index([staffName, date])
  @@map("staff_daily_performance")
}

// AirlineDailyMetrics - Airline totals for trend analysis
model AirlineDailyMetrics {
  id                String   @id @default(cuid())
  date              String   // "DD/MM/YYYY"
  airline           AirlineKey
  
  totalSales        Decimal @db.Decimal(14, 2)
  totalTickets      Int
  totalVoids        Int
  netSales          Decimal @db.Decimal(14, 2)
  
  createdAt         DateTime @default(now())
  
  @@index([airline, date])
  @@map("airline_daily_metrics")
}
```

### Phase 1B: Modify Existing Models

**Update SalesReport model:**
```typescript
model SalesReport {
  // ... existing fields ...
  
  // New fields for detection and tracking
  airlineDetectedBy      String?     // "MANUAL" | "CONTENT" | "FORMAT" | "METADATA" | "VISION"
  detectionConfidence    Float?      // 0-1, detection confidence score
  fileHash               String?     // SHA-256 of uploaded file
  supersededById         String?     // If overwritten, which report replaced it
  supersededAt           DateTime?
  supersededBy           String?
  
  // Relationships
  analytics              SalesReportAnalytics?
  
  @@index([airline, reportDate, status])
}
```

**Update SalesTicket model:**
```typescript
model SalesTicket {
  // ... existing fields ...
  
  // Additional analytics fields
  grossSalesAmount   Decimal? @db.Decimal(14, 2)
  netSalesAmount     Decimal? @db.Decimal(14, 2)
  commission         Decimal? @db.Decimal(14, 2)
  refundAmount       Decimal? @db.Decimal(14, 2)
  admAmount          Decimal? @db.Decimal(14, 2)
  bspAmount          Decimal? @db.Decimal(14, 2)
}
```

### Phase 1C: Indexes & Performance

**Create indexes for fast queries:**
```sql
-- For analytics dashboard
CREATE INDEX sales_report_analytics_airline_date ON sales_report_analytics(airline, reportDate);
CREATE INDEX staff_daily_performance_date_airline ON staff_daily_performance(date, airline);
CREATE INDEX staff_daily_performance_name_date ON staff_daily_performance(staffName, date);
CREATE INDEX airline_daily_metrics_date ON airline_daily_metrics(airline, date);

-- For duplicate detection
CREATE INDEX sales_report_hash ON sales_reports(fileHash);
CREATE INDEX sales_report_duplicate ON sales_reports(airline, reportDate, status);
```

### Phase 1D: Migration Strategy

**Safe migration process:**
1. Create migrations as separate scripts
2. Test on staging with production data snapshot
3. Verify backward compatibility (old queries still work)
4. Create rollback procedure
5. Document execution time
6. Deploy with monitoring

**Testing before deployment:**
- [ ] New tables created
- [ ] Relationships validated
- [ ] Indexes created successfully
- [ ] No data loss
- [ ] Old queries still return data
- [ ] New queries return correct results

**Acceptance Criteria:**
- [ ] All migrations run successfully
- [ ] Database integrity verified
- [ ] Performance benchmarks acceptable
- [ ] Rollback tested and documented

**Owner:** Database Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

---

## 🧠 PHASE 2: CORE SERVICES (Week 2, Days 1-5)

### Phase 2A: Airline Detection Service

**File:** `src/modules/sales-reporting/services/AirlineDetectionService.ts`

**Implementation:**
```typescript
interface DetectionResult {
  airline: AirlineRuleKey | null;
  confidence: number;           // 0-1
  method: "CONTENT" | "FORMAT" | "METADATA" | "VISION" | "UNKNOWN";
  reasoning: string[];          // Why this airline was detected
  alternativeMatches?: {
    airline: AirlineRuleKey;
    confidence: number;
  }[];
}

class AirlineDetectionService {
  // Priority 1: Airline name inside report
  async detectByContent(buffer: Buffer): Promise<DetectionResult>
  
  // Priority 2: Report format/template matching
  async detectByFormat(buffer: Buffer): Promise<DetectionResult>
  
  // Priority 3: Report-specific headers
  async detectByHeaders(buffer: Buffer): Promise<DetectionResult>
  
  // Priority 4: Other metadata (filename, etc)
  async detectByMetadata(filename: string, buffer: Buffer): Promise<DetectionResult>
  
  // Fallback: Vision model on screenshot
  async detectByVision(buffer: Buffer): Promise<DetectionResult>
  
  // Main entry point
  async detect(
    buffer: Buffer,
    filename?: string,
    userContext?: string // e.g., "I'm uploading my Air Peace report"
  ): Promise<DetectionResult>
}
```

**Confidence Tiers:**
- ✅ 90%+: Auto-continue without asking user
- ⚠️ 70-89%: Show prompt "I believe this is [AIRLINE] (85% confidence). Continue?"
- ❌ <70%: Don't guess, ask user to select manually

**Test Coverage:**
- [ ] Detects all 4 airlines in sample files
- [ ] Confidence scores are accurate
- [ ] Edge cases (empty file, wrong format)
- [ ] Vision fallback works
- [ ] Accuracy > 95% on real files

**Acceptance Criteria:**
- [ ] Unit tests passing (95%+ coverage)
- [ ] Tested on real airline report samples
- [ ] Confidence scoring validated
- [ ] Integration with ReportGenerator working

**Owner:** Backend Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 2B: Duplicate Detection Service

**File:** `src/modules/sales-reporting/services/DuplicateCheckService.ts`

**Implementation:**
```typescript
interface DuplicateMatch {
  existingReportId: string;
  matchScore: number;        // 0-1, how similar
  matchFactors: {
    airline: boolean;        // Exact match
    date: boolean;           // Exact match
    bspPeriod: boolean;       // If available
    salesAmount: number;      // 0-1, within tolerance
    ticketCount: boolean;     // Exact match
    fileHash: boolean;        // Exact hash match
  };
  existingReport: {
    date: string;
    airline: string;
    totals: {
      sales: number;
      tickets: number;
      voids: number;
    };
    status: string;
  };
}

class DuplicateCheckService {
  async checkDuplicate(
    airline: AirlineRuleKey,
    reportDate: string,
    totalSales: number,
    ticketCount: number,
    fileHash?: string,
    bspPeriod?: string
  ): Promise<DuplicateMatch | null>
}
```

**Matching Algorithm:**
- Airline: Must match exactly (100%)
- Date: Must match exactly (100%)
- BSP Period: Match if available (80%)
- Sales Amount: Within ±2% (70%)
- Ticket Count: Must match exactly (100%)
- File Hash: Match if available (100%)

**Duplicate Workflow:**
1. Check detected as duplicate
2. Show dialog: "This report already exists"
3. Display existing report summary
4. Show comparison (old vs new)
5. Three buttons:
   - "View Existing Report"
   - "Overwrite Existing Report"
   - "Cancel"
6. If overwrite: Create DuplicateHistory record, mark old as superseded

**Test Coverage:**
- [ ] Exact duplicates detected correctly
- [ ] False positives minimized
- [ ] Sales amount tolerance works
- [ ] Hash comparison works
- [ ] Overwrite workflow tested

**Acceptance Criteria:**
- [ ] Unit tests passing (95%+ coverage)
- [ ] False positive rate < 5%
- [ ] False negative rate < 2%
- [ ] Performance: detect duplicate in < 1s

**Owner:** Backend Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 2C: Analytics Service

**File:** `src/modules/sales-reporting/services/AnalyticsService.ts`

**Implementation:**
```typescript
class AnalyticsService {
  // Executive KPIs
  async getExecutiveSummary(
    dateRange: DateRange,
    airlineFilter?: AirlineKey[]
  ): Promise<ExecutiveKPIs>
  
  // By airline
  async getAirlinePerformance(
    dateRange: DateRange,
    sortBy?: "sales" | "tickets" | "growth"
  ): Promise<AirlineMetric[]>
  
  // By staff
  async getStaffPerformance(
    dateRange: DateRange,
    airlineFilter?: AirlineKey,
    sortBy?: "sales" | "tickets" | "commissions"
  ): Promise<StaffMetric[]>
  
  // Trends
  async getDailyTrends(
    dateRange: DateRange,
    airlineFilter?: AirlineKey
  ): Promise<TrendData[]>
  
  async getWeeklyTrends(dateRange: DateRange): Promise<TrendData[]>
  async getMonthlyTrends(dateRange: DateRange): Promise<TrendData[]>
  async getYearlyTrends(): Promise<TrendData[]>
  
  // Comparisons
  async compareWithPreviousPeriod(
    dateRange: DateRange
  ): Promise<ComparisonMetrics>
  
  // Growth calculations
  async calculateGrowth(
    dateRange: DateRange,
    compareTo?: DateRange
  ): Promise<GrowthMetrics>
}
```

**Query Optimization:**
- Use indexes for fast lookups
- Cache common queries (KPI summary, trends)
- Use denormalized tables (StaffDailyPerformance, AirlineDailyMetrics)
- Lazy-load detailed breakdowns

**Supported Date Ranges:**
- Today
- Yesterday
- Last 7 Days
- Last 30 Days
- This Month
- Last Month
- This Year
- Last Year
- Custom range
- Between two dates

**Test Coverage:**
- [ ] All query types return correct totals
- [ ] Date filtering works correctly
- [ ] Grouping (by airline, by staff) accurate
- [ ] Growth calculations correct
- [ ] Null/empty dataset handling
- [ ] Performance < 500ms on 1yr+ data

**Acceptance Criteria:**
- [ ] Unit tests passing (95%+ coverage)
- [ ] All query types tested with real data
- [ ] Performance benchmarks met
- [ ] Caching strategy implemented

**Owner:** Backend Lead  
**Duration:** 4 days  
**Status:** NOT STARTED

### Phase 2D: Update Report Generator

**File:** `src/modules/sales-reporting/reporting/ReportGenerator.ts`

**Changes:**
1. Add airline auto-detection when `airline` parameter is null
2. Show confidence-based prompts
3. Call DuplicateCheckService
4. Handle overwrite workflow
5. Store detection metadata
6. Create SalesReportAnalytics records
7. Update StaffDailyPerformance and AirlineDailyMetrics
8. Maintain backward compatibility with manual airline selection

**Key Changes:**
```typescript
export async function generateReport(
  airline: AirlineRuleKey | null,  // Can be null for auto-detect
  files: UploadedFile[],
  createdBy?: string
): Promise<GeneratedReportSummary> {
  // NEW: Auto-detect if airline not provided
  let detectedAirline = airline;
  let detectionResult: DetectionResult | null = null;
  
  if (!detectedAirline) {
    detectionResult = await AirlineDetectionService.detect(files[0].buffer, files[0].name);
    if (detectionResult.confidence < 0.7) {
      throw new Error("Could not confidently detect airline. Please select manually.");
    }
    detectedAirline = detectionResult.airline;
  }
  
  // NEW: Check for duplicates
  const duplicateCheck = await DuplicateCheckService.checkDuplicate(...);
  if (duplicateCheck) {
    // Return special response indicating duplicate
    return { ...existingReport, isDuplicate: true, existingReportId: duplicateCheck.existingReportId };
  }
  
  // Continue with existing logic...
  const result = applyRules(detectedAirline, allRows, resolve);
  
  // NEW: Store analytics
  await tx.salesReportAnalytics.create({
    data: {
      reportId: created.id,
      airline: detectedAirline,
      reportDate: reportDate,
      totalTicketsIssued: result.ticketCount,
      totalTicketsVoided: voidCount,
      // ... all other metrics ...
    }
  });
  
  // NEW: Update denormalized performance tables
  for (const ticket of ticketRows) {
    await tx.staffDailyPerformance.create({
      data: {
        date: reportDate,
        airline: detectedAirline,
        staffName: ticket.staffName,
        ticketsIssued: 1,
        salesAmount: ticket.amount,
        commission: calculateCommission(ticket.amount),
      }
    });
  }
}
```

**Test Coverage:**
- [ ] Auto-detect works with existing manual selection
- [ ] Duplicate detection called correctly
- [ ] Analytics records created
- [ ] Performance tables updated
- [ ] Backward compatibility maintained

**Acceptance Criteria:**
- [ ] All existing tests still pass
- [ ] New auto-detect tests passing
- [ ] Duplicate detection integrated
- [ ] Analytics records created for all reports

**Owner:** Backend Lead  
**Duration:** 2 days  
**Status:** NOT STARTED

**Phase 2 Summary:**
- **Services Created:** 3 (Detection, Duplicate, Analytics)
- **Core Logic:** Modular, reusable, testable
- **Performance:** Optimized for large datasets
- **Integration:** Ready for API routes

---

## 🔌 PHASE 3: API & CHATBOT (Week 3, Days 1-5)

### Phase 3A: Sales Report API Routes

**Create/Update endpoints:**

1. **POST /api/sales-reports/generate**
   - Updated to support auto-detection
   - Request: formData with optional `airline` field
   - Response: includes `detectionConfidence`, `isDuplicate`

2. **POST /api/sales-reports/detect-airline**
   - New endpoint for standalone detection
   - Request: multipart with file
   - Response: `{ airline, confidence, method, reasoning }`

3. **POST /api/sales-reports/check-duplicate**
   - New endpoint for duplicate checking
   - Request: `{ airline, reportDate, sales, tickets, fileHash }`
   - Response: `{ isDuplicate: true/false, existingReport, matchFactors }`

4. **POST /api/sales-reports/{id}/confirm**
   - Updated to handle overwrite workflow
   - Request: `{ verifiedBy, staffCorrections, overwriteExisting }`
   - Response: confirmation with analytics

5. **GET /api/sales-reports/history**
   - New endpoint for report list
   - Query params: `limit`, `offset`, `airline`, `dateFrom`, `dateTo`, `status`
   - Response: paginated list with summary

6. **GET /api/sales-reports/{id}**
   - New endpoint for report details
   - Response: full report with analytics, transactions, staff breakdown

### Phase 3B: Analytics API Routes

1. **GET /api/analytics/kpi**
   - Executive summary
   - Query: `dateFrom`, `dateTo`, `airlines`
   - Response: All KPI totals

2. **GET /api/analytics/airline**
   - Airline performance metrics
   - Query: `dateFrom`, `dateTo`, `sortBy`
   - Response: Ranked airlines with metrics

3. **GET /api/analytics/staff**
   - Staff performance metrics
   - Query: `dateFrom`, `dateTo`, `airline`, `sortBy`
   - Response: Staff rankings with metrics

4. **GET /api/analytics/trends**
   - Trend data for charts
   - Query: `dateFrom`, `dateTo`, `granularity` (daily|weekly|monthly)
   - Response: Time series data

5. **GET /api/analytics/comparison**
   - Compare with previous period
   - Query: `dateFrom`, `dateTo`
   - Response: Metrics + percentage changes

6. **GET /api/analytics/growth**
   - Growth calculations
   - Query: `dateFrom`, `dateTo`
   - Response: Growth % and absolute deltas

**Test Coverage:**
- [ ] All endpoints return 200 OK
- [ ] Request validation working
- [ ] Authentication/authorization enforced
- [ ] Error responses correct
- [ ] Response schemas match spec
- [ ] Performance < 500ms

**Acceptance Criteria:**
- [ ] All endpoints tested
- [ ] API documentation complete
- [ ] Authentication working
- [ ] Error handling correct

**Owner:** Backend Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 3C: Chatbot Intent System

**File:** `src/modules/travel-assistant/orchestration/SalesReportAssistant.ts`

**Intent Recognition:**

```typescript
type SalesReportIntent =
  | "UPLOAD_REPORT"
  | "SHOW_SALES"
  | "SHOW_PERFORMANCE"
  | "SHOW_BALANCE"
  | "STAFF_COMPARISON"
  | "AIRLINE_COMPARISON"
  | "TREND_ANALYSIS";

interface IntentExtractionResult {
  intent: SalesReportIntent;
  parameters: {
    dateFrom?: string;
    dateTo?: string;
    timeExpression?: string;  // "today", "this week", etc
    airline?: AirlineKey;
    staffName?: string;
    metric?: string;  // "sales", "tickets", "void", etc
  };
  confidence: number;
}

class SalesReportAssistant {
  async extractIntent(message: string): Promise<IntentExtractionResult>
  async handleUpload(file: File): Promise<UploadResponse>
  async handleQuery(message: string): Promise<QueryResponse>
  async getBalance(): Promise<BalanceResponse>
}
```

**Intent Examples:**

| User Input | Intent | Parameters |
|-----------|--------|------------|
| "Upload today's report" | UPLOAD_REPORT | {} |
| "Show today's sales" | SHOW_SALES | timeExpression: "today" |
| "Show this week's sales" | SHOW_SALES | timeExpression: "this week" |
| "Which airline sold the most today?" | AIRLINE_COMPARISON | timeExpression: "today", metric: "sales" |
| "How many tickets did John issue yesterday?" | SHOW_PERFORMANCE | staffName: "John", timeExpression: "yesterday", metric: "tickets" |
| "Show Air Peace sales between 1 July and 15 July" | SHOW_SALES | airline: "AIRPEACE", dateFrom: "01/07", dateTo: "15/07" |
| "What's my balance?" | SHOW_BALANCE | {} |
| "Balance update" | SHOW_BALANCE | {} |

**Time Expression Parsing:**
- "today" → today's date
- "yesterday" → yesterday's date
- "this week" → Monday-today
- "last week" → previous Monday-Sunday
- "this month" → 1st to today
- "last month" → previous month
- "between X and Y" → parse both dates

**Test Coverage:**
- [ ] All intent types recognized
- [ ] Parameter extraction accurate
- [ ] Time expression parsing works
- [ ] Context awareness (remember previous airline)
- [ ] Typo tolerance

**Acceptance Criteria:**
- [ ] Unit tests passing (90%+ coverage)
- [ ] Real conversation transcripts tested
- [ ] Accuracy > 95%

**Owner:** Backend Lead (NLU focus)  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 3D: Chatbot Upload Workflow

**File:** `src/components/layout/ChatBubble.tsx`

**Implementation:**

1. File Detection
   - Detect `.xls`/`.xlsx` files
   - Treat as sales report (not flight search)

2. Airline Detection
   - Call `/api/sales-reports/detect-airline`
   - Show confidence prompt if 70-89%
   - Ask to select if < 70%

3. Duplicate Check
   - Call `/api/sales-reports/check-duplicate`
   - Show duplicate dialog if match found
   - Handle "View", "Overwrite", "Cancel"

4. Report Generation
   - Call `/api/sales-reports/generate`
   - Show loading state
   - Display report summary on success

5. Confirmation
   - Show key metrics
   - "Save Report" button
   - Offer analytics query suggestions

**State Machine:**
```
User uploads file
  ↓
Detecting airline...
  ├─ 90%+ confidence: auto-proceed
  ├─ 70-89%: show confirmation prompt
  └─ <70%: show selection dropdown
  ↓
Checking for duplicates...
  ├─ Duplicate found: show dialog
  │  ├─ View Existing: open report
  │  ├─ Overwrite: proceed
  │  └─ Cancel: stop
  └─ No duplicate: proceed
  ↓
Generating report...
  ↓
Saving...
  ↓
✓ Report saved!
  Shows summary and suggestions

```

**Test Coverage:**
- [ ] File detection works
- [ ] Airline detection prompts correct
- [ ] Duplicate dialog appears when needed
- [ ] Report saves successfully
- [ ] Error handling (file too large, etc)

**Acceptance Criteria:**
- [ ] Manual testing workflow complete
- [ ] No interference with flight search
- [ ] Beautiful UI/UX
- [ ] Mobile responsive

**Owner:** Frontend Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 3E: Chatbot Query Handler

**File:** `src/components/layout/ChatBubble.tsx` (chatbot message loop)

**Implementation:**

1. Intent Recognition
   - Use SalesReportAssistant.extractIntent()
   - Show loading state
   
2. API Call Routing
   - UPLOAD_REPORT → file upload flow
   - SHOW_SALES → /api/analytics/kpi + /api/analytics/trends
   - SHOW_PERFORMANCE → /api/analytics/staff
   - SHOW_BALANCE → /api/airlines/balances (existing endpoint)
   - AIRLINE_COMPARISON → /api/analytics/airline
   - STAFF_COMPARISON → /api/analytics/staff
   - TREND_ANALYSIS → /api/analytics/trends

3. Response Formatting
   - Natural language summary
   - Key insights highlighted
   - Charts/tables where relevant
   - Actionable recommendations

4. Context Awareness
   - Remember previous airline selected
   - Remember previous date range
   - Offer follow-up queries

**Example Response Flow:**

User: "Show Air Peace sales this month"
Bot:
```
Air Peace Sales - July 2024
──────────────────────────

📊 Total Sales: ₦2,450,000
🎫 Tickets Issued: 85
🚫 Tickets Voided: 3
💰 Net Sales: ₦2,425,000

Top Staff This Month:
1. Florence Aina - ₦650,000
2. John Paul - ₦580,000
3. Mary Johnson - ₦520,000

📈 Trend vs June 2024: +12%

Would you like to see:
- Daily breakdown
- Staff performance ranking
- Comparison with other airlines
```

**Test Coverage:**
- [ ] Intent extraction accurate
- [ ] API calls correct
- [ ] Response formatting readable
- [ ] Context persistence works

**Acceptance Criteria:**
- [ ] 10+ sample queries tested
- [ ] Responses are natural and helpful
- [ ] No API errors
- [ ] Performance < 3s per query

**Owner:** Frontend + Backend  
**Duration:** 3 days  
**Status:** NOT STARTED

**Phase 3 Summary:**
- **API Endpoints:** 12 new endpoints
- **Chatbot Integration:** Full upload + query support
- **NLU:** Intent recognition working
- **User Experience:** Smooth, intuitive workflows

---

## 🎨 PHASE 4: FRONTEND DASHBOARD (Week 4, Days 1-5)

### Phase 4A: Sales Reports Page

**File:** `src/components/sections/SalesReportsSection.tsx`

**Layout:**
```
┌─────────────────────────────────────────┐
│ Sales Reports Dashboard                 │
├─────────────────────────────────────────┤
│ [Upload New Report]  [View Analytics]   │
├─────────────────────────────────────────┤
│ Quick Filters: Today | This Week | This Month | Custom
├─────────────────────────────────────────┤
│ Today's Reports (1 report)              │
│ ┌─────────────────────────────────────┐ │
│ │ Air Peace      24/07/2024    SAVED  │ │
│ │ Total: ₦245,000 | 8 tickets        │ │
│ │ [View Details] [Download] [Delete] │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ Recent Reports (7 days)                 │
│ (Table with pagination)                 │
└─────────────────────────────────────────┘
```

**Features:**
- Upload card (drag-drop)
- History table (sortable, filterable)
- Quick filters (Today, Week, Month, Custom)
- Status badges (PENDING, SAVED, SUPERSEDED)
- Actions menu (View, Download, Delete)
- Pagination (20 per page)
- Empty states
- Loading animations

**Components:**
- `SalesReportsSection` (parent)
- `ReportUploadCard` (upload widget)
- `ReportHistoryTable` (list)
- `DateRangeFilter` (date selector)
- `ReportDetailModal` (details)

**Test Coverage:**
- [ ] Upload works
- [ ] History loads
- [ ] Filters work
- [ ] Pagination works
- [ ] Responsive design

**Acceptance Criteria:**
- [ ] Mobile/tablet/desktop responsive
- [ ] Beautiful animations
- [ ] All features working
- [ ] No layout issues

**Owner:** Frontend Lead  
**Duration:** 3 days  
**Status:** NOT STARTED

### Phase 4B: Sidebar Navigation Update

**File:** `src/lib/constants.ts` + `src/app/page.tsx`

**Changes:**

1. Add to SIDEBAR_SECTIONS:
```typescript
{
  label: "Operations",
  items: [
    { id: "airlines", icon: "building-2", label: "Airlines" },
    { id: "balances", icon: "wallet", label: "Airline Deposits" },
    { id: "sales-reports", icon: "bar-chart-2", label: "Sales Reports" },  // NEW
    { id: "availableTkt", icon: "ticket", label: "Available TKT to Issue" },
    // ...
  ],
}
```

2. Update page.tsx switch statement:
```typescript
case "sales-reports":
  return <SalesReportsSection />;
```

3. Update SectionId type
4. Update Breadcrumb component

**Test Coverage:**
- [ ] Navigation renders
- [ ] Section selectable
- [ ] Permission checks work
- [ ] Breadcrumb updates

**Acceptance Criteria:**
- [ ] Navigation working
- [ ] New page accessible to Admin/Finance
- [ ] Not visible to other roles

**Owner:** Frontend Lead  
**Duration:** 1 day  
**Status:** NOT STARTED

### Phase 4C: Analytics Dashboard Component

**File:** `src/components/sections/AnalyticsDashboardSection.tsx`

**Layout:**
```
┌────────────────────────────────────────────────────┐
│ Sales Analytics Dashboard                          │
├────────────────────────────────────────────────────┤
│ Date Range: [Today ▼] | [Custom...]               │
├────────────────────────────────────────────────────┤
│ Executive KPIs (4 animated cards)                  │
│ ┌──────────┬──────────┬──────────┬──────────┐    │
│ │Total    │Tickets   │Total     │Net       │    │
│ │Sales    │Issued    │Voids     │Sales     │    │
│ │₦2.4M    │156       │₦45K      │₦2.35M    │    │
│ │↑ 12%    │↑ 8%      │↓ 3%      │↑ 15%     │    │
│ └──────────┴──────────┴──────────┴──────────┘    │
│                                                   │
│ Airline Performance (Bar Chart)                  │
│ ┌────────────────────────────────────────────┐  │
│ │ Sales by Airline                           │  │
│ │ Air Peace:  ████████████ ₦650K             │  │
│ │ Aero:       ███████ ₦420K                  │  │
│ │ Ibom:       █████ ₦320K                    │  │
│ │ Arik:       ████ ₦260K                     │  │
│ └────────────────────────────────────────────┘  │
│                                                   │
│ Daily Trend (Line Chart)                        │
│ ┌────────────────────────────────────────────┐  │
│ │     /‾‾‾\                                  │  │
│ │    /     \__                                │  │
│ │   /          \_                             │  │
│ │  /______________\__                         │  │
│ │  Mon Tue Wed Thu Fri                        │  │
│ └────────────────────────────────────────────┘  │
│                                                   │
│ Top Staff This Period (Table)                   │
│ ┌────────────────────────────────────────────┐  │
│ │ Rank │ Name            │ Sales     │Tickets│  │
│ │ 1    │ Florence Aina   │₦650,000   │ 28    │  │
│ │ 2    │ John Paul       │₦580,000   │ 25    │  │
│ │ 3    │ Mary Johnson    │₦520,000   │ 22    │  │
│ └────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**Features:**
- Date range picker (Today, This Week, This Month, Custom)
- 4 KPI cards with trend indicators
- Sales by airline chart (bar)
- Tickets by airline chart (pie)
- Daily trend chart (line)
- Weekly trend chart (line)
- Monthly trend chart (line)
- Staff performance table (top 10)
- Growth % badges
- Export to PDF/CSV
- Animated card entrance
- Smooth transitions

**Components:**
- `AnalyticsDashboardSection` (parent)
- `KPICard` (reusable KPI display)
- `AirlineChart` (Recharts wrapper)
- `TrendChart` (Recharts wrapper)
- `StaffTable` (data table)
- `DateRangeFilter` (picker)

**Libraries:**
- **Recharts** for charts
- **Framer Motion** for animations
- **date-fns** for date handling

**Test Coverage:**
- [ ] Dashboard loads data
- [ ] Charts render correctly
- [ ] Date filters work
- [ ] Export works
- [ ] Responsive design

**Acceptance Criteria:**
- [ ] All charts render
- [ ] Data accurate
- [ ] Performance < 2s load
- [ ] Mobile responsive
- [ ] Beautiful animations

**Owner:** Frontend Lead  
**Duration:** 4 days  
**Status:** NOT STARTED

### Phase 4D: Report Detail Modal

**File:** `src/components/sales-reports/ReportDetailModal.tsx`

**Features:**
- Report header (airline, date, status)
- KPI summary cards
- Full report text (copy-able)
- Staff breakdown table
- Transaction details (collapsible)
- Source files list
- Metadata (detection confidence, file hash)
- Action buttons (Download, Overwrite, Delete)

**Test Coverage:**
- [ ] Modal opens/closes
- [ ] Data displays correctly
- [ ] Copy button works
- [ ] Download works

**Acceptance Criteria:**
- [ ] Modal functional
- [ ] Information complete
- [ ] UX intuitive

**Owner:** Frontend Lead  
**Duration:** 2 days  
**Status:** NOT STARTED

### Phase 4E: Duplicate Detection Dialog

**File:** `src/components/sales-reports/DuplicateDialog.tsx`

**Features:**
- Message: "This report already exists"
- Existing report summary
- New vs existing comparison
- Three action buttons
- Warning message
- Detection confidence display

**Test Coverage:**
- [ ] Dialog shows on duplicate
- [ ] Buttons work
- [ ] Comparison displays

**Acceptance Criteria:**
- [ ] Dialog functional
- [ ] Clear messaging
- [ ] Prevents accidental overwrites

**Owner:** Frontend Lead  
**Duration:** 1 day  
**Status:** NOT STARTED

**Phase 4 Summary:**
- **Components:** 8 new React components
- **Design:** Modern, animated, responsive
- **Performance:** Optimized charts and lazy-loading
- **UX:** Intuitive workflows

---

## ✅ PHASE 5: TESTING (Week 5, Days 1-5)

### Phase 5A: Unit Tests

**Coverage Targets:** 95% for critical paths

**Test Files to Create:**
1. `__tests__/AirlineDetectionService.test.ts`
   - Content detection
   - Format detection
   - Confidence scoring
   - Edge cases

2. `__tests__/DuplicateCheckService.test.ts`
   - Exact matches
   - Fuzzy matches
   - False positives/negatives
   - Performance

3. `__tests__/AnalyticsService.test.ts`
   - All query types
   - Date filtering
   - Grouping accuracy
   - Null handling

4. `__tests__/SalesReportAssistant.test.ts`
   - Intent recognition
   - Parameter extraction
   - Time expression parsing

**Run Tests:**
```bash
npm run test -- --coverage
```

**Acceptance Criteria:**
- [ ] All unit tests passing
- [ ] Coverage > 95% for core logic
- [ ] No flaky tests

### Phase 5B: Integration Tests

**Test Scenarios:**

1. End-to-end upload workflow
   - Upload file → Auto-detect (90%+) → Check duplicate → Generate → Save
   
2. Duplicate detection workflow
   - Upload duplicate → Show dialog → Overwrite → Verify replaced

3. Chatbot upload workflow
   - Chat: Upload file → Detect → Confirm → Save → Summary

4. Chatbot query workflow
   - Chat: Query → Intent extraction → API call → Response

5. Analytics dashboard workflow
   - Load dashboard → Filter date → View charts → Export

6. Large file handling
   - Upload 50K row Excel → Process async → Return summary

**Test Data:**
- Real sample Excel files for each airline
- 1 year of production-like data
- Various file sizes (1K, 10K, 50K rows)

**Run Tests:**
```bash
npm run test:integration
```

**Acceptance Criteria:**
- [ ] All workflows tested
- [ ] No data loss
- [ ] Error handling correct
- [ ] Performance acceptable

### Phase 5C: Performance Tests

**Benchmarks:**

| Operation | Target | Test Data |
|-----------|--------|-----------|
| Parse 10K row Excel | < 5s | Real file |
| Parse 50K row Excel | < 30s | Real file |
| Auto-detect airline | < 2s | Any file |
| Check duplicate | < 1s | Full dataset |
| Load dashboard KPIs | < 500ms | 1yr data |
| Analytics query | < 500ms | 1yr data |
| Chatbot response | < 3s | API call + formatting |
| Dashboard render | < 2s | All charts |

**Test Script:**
```bash
npm run test:performance -- --verbose
```

**Acceptance Criteria:**
- [ ] All benchmarks met
- [ ] No memory leaks
- [ ] Database indexes working
- [ ] Caching effective

### Phase 5D: Regression Tests

**Verify backward compatibility:**
- [ ] Admin manual upload flow still works
- [ ] Existing reports still query correctly
- [ ] Old API endpoints unchanged
- [ ] Firebase auth unaffected
- [ ] ChatBubble flight search unaffected
- [ ] Permission checks working
- [ ] No data loss from migration

**Test Script:**
```bash
npm run test:regression
```

**Acceptance Criteria:**
- [ ] Zero breaking changes
- [ ] Old features work
- [ ] No unintended side effects

### Phase 5E: E2E Tests (Playwright)

**Test Flows:**

1. Admin user upload and save
2. Finance user view dashboard
3. User upload via chatbot
4. User query via chatbot
5. Duplicate detection and overwrite
6. Large file upload
7. Mobile responsive flows

**Test Script:**
```bash
npm run test:e2e
```

**Acceptance Criteria:**
- [ ] All flows complete successfully
- [ ] UI behaves as expected
- [ ] Error messages clear

### Phase 5F: UAT (User Acceptance Testing)

**Participants:**
- Admin users (2)
- Finance users (2)
- Managers (2)

**Scenarios:**
- Upload real sales report (anonymized data)
- View analytics dashboard
- Query chatbot
- Test on mobile
- Report bugs

**Feedback & Iteration:**
- Document issues found
- Prioritize fixes
- Re-test before production

**Acceptance Criteria:**
- [ ] UAT sign-off
- [ ] No critical issues
- [ ] Users comfortable with workflows

### Phase 5G: Load & Stress Tests

**Scenarios:**
- 100 concurrent dashboard loads
- 50 concurrent report uploads
- 1000 chatbot queries in 1 hour
- 1 week of continuous operation

**Monitoring:**
- Database connection pool
- API response times
- Memory usage
- Error rates

**Acceptance Criteria:**
- [ ] System handles load
- [ ] No degradation under stress
- [ ] Recovery is clean

**Phase 5 Summary:**
- **Test Coverage:** 95%+ critical paths
- **Integration:** End-to-end workflows validated
- **Performance:** All benchmarks met
- **UAT:** User sign-off obtained

---

## 📚 PHASE 6: DOCUMENTATION (Week 5, Days 4-5 + Week 6, Day 1)

### Phase 6A: API Documentation

**File:** `docs/API_SPECIFICATION.md`

**Content:**
- All endpoints with examples
- Request/response schemas
- Error codes and messages
- Rate limiting
- Authentication
- Date format conventions
- Pagination details

**Format:** OpenAPI 3.0 YAML (auto-generate from Swagger)

**Acceptance Criteria:**
- [ ] All endpoints documented
- [ ] Examples work
- [ ] Clear and complete

### Phase 6B: Chatbot User Guide

**Files:**
- `docs/CHATBOT_GUIDE.md` (user-facing)
- In-app help tooltips

**Content:**
- Upload workflow
- Query examples (with copy-paste)
- Supported date expressions
- Airline aliases
- Staff name search
- Limitations
- FAQ

**Acceptance Criteria:**
- [ ] Clear for non-technical users
- [ ] Examples accurate
- [ ] Easy to follow

### Phase 6C: Admin Runbook

**File:** `docs/ADMIN_RUNBOOK.md`

**Content:**
- Dashboard overview
- KPI explanations
- Handling duplicates
- Troubleshooting
- Database maintenance
- Performance monitoring
- Permissions
- Rollback procedures

**Acceptance Criteria:**
- [ ] Complete reference
- [ ] Easy to troubleshoot
- [ ] Ready for production

### Phase 6D: Developer Guide

**File:** `docs/DEVELOPER_GUIDE.md`

**Content:**
- Architecture overview
- Adding new airlines
- Extending analytics
- Modifying intent system
- Adding new charts
- Database schema changes
- Testing guidelines

**Acceptance Criteria:**
- [ ] Clear for future developers
- [ ] Examples provided
- [ ] Maintainable code documented

---

## 🚀 PHASE 7: DEPLOYMENT & LAUNCH (Week 6, Days 2-5)

### Phase 7A: Staging Validation

**Smoke Tests:**
- [ ] Database migration successful
- [ ] All tables/fields created
- [ ] API endpoints respond
- [ ] Chatbot file detection works
- [ ] Analytics dashboard loads
- [ ] Sidebar navigation shows new section
- [ ] Permissions enforced

**Performance Baseline:**
- [ ] Record baseline metrics
- [ ] Document any anomalies

### Phase 7B: User Acceptance Testing (Staging)

**Participants:** Admin & Finance users

**Activities:**
- [ ] Upload real anonymized sales reports
- [ ] Verify auto-detection accuracy
- [ ] Test duplicate detection
- [ ] Query analytics dashboard
- [ ] Try chatbot workflows
- [ ] Report any bugs/UX issues

**Sign-off:** Document user approval

### Phase 7C: Production Readiness Checklist

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Performance benchmarks met
- [ ] Database backup created
- [ ] Migration script tested
- [ ] Rollback plan documented
- [ ] Monitoring/alerting configured
- [ ] Feature flags ready
- [ ] Communication prepared
- [ ] Support docs ready

### Phase 7D: Production Database Migration

**Process:**
1. Announce maintenance window (1 hour)
2. Verify backup completed
3. Run migration on primary database
4. Verify all tables/fields created
5. Check indexes
6. Run validation queries
7. Monitor for errors
8. Document execution time
9. Keep rollback ready

**Success Criteria:**
- [ ] All new tables created
- [ ] No data loss
- [ ] All indexes created
- [ ] No errors in logs

### Phase 7E: Production Code Deployment

**Process:**
1. Merge to main branch (PR reviewed)
2. Trigger CI/CD pipeline
3. Monitor build logs
4. Verify containers start
5. Check application logs
6. Test critical flows manually
7. Monitor error rates
8. Monitor performance metrics

**Rollback Ready:** Have plan to revert if critical issues

### Phase 7F: Post-Deployment Monitoring (48 hours)

**Activities:**
- [ ] Watch error rates
- [ ] Monitor API response times
- [ ] Check database query performance
- [ ] Verify airline detection accuracy
- [ ] Track chatbot success rate
- [ ] Monitor cost/usage
- [ ] Be available for urgent issues
- [ ] Document any issues found

**Metrics to Watch:**
- Error rate: < 0.1%
- API p95 latency: < 500ms
- Chatbot success rate: > 95%
- Database query time: < 500ms
- Daily active users

**Sign-off:** After 48 hours with no critical issues

---

## 📊 Success Metrics

### Adoption
- **Target:** 80% of daily reports uploaded via chatbot within 30 days
- **Measurement:** Upload source tracking

### Efficiency
- **Target:** 50% reduction in manual report entry time
- **Measurement:** Before/after surveys

### Accuracy
- **Target:** < 2% false positive duplicate rate
- **Measurement:** Manual audit of duplicate detections

### Analytics Usage
- **Target:** 60% of Finance users viewing dashboards weekly
- **Measurement:** Page view analytics

### System Health
- **Target:** 99.5% uptime
- **Measurement:** Monitoring dashboard
- **Target:** < 0.1% error rate
- **Measurement:** Error tracking

---

## 🔄 Rollback Plan

**If critical issues occur before sign-off:**

1. **Rollback Database** (< 30 min)
   ```bash
   npm run migrate:revert
   ```

2. **Rollback Code** (< 5 min)
   - Revert to previous stable commit
   - Redeploy via CI/CD

3. **Verify System** (< 10 min)
   - Test old workflows
   - Monitor for errors
   - Notify users

4. **Post-Mortem**
   - Document what went wrong
   - Fix and re-test on staging
   - Plan for re-deployment

**Decision Criteria for Rollback:**
- More than 10 errors per minute
- Database corruption detected
- Complete feature failure
- Security issue discovered
- Data loss confirmed

---

## 🛠️ Technical Stack

### Backend
- **Runtime:** Node.js (existing)
- **Framework:** Next.js (existing)
- **Database:** PostgreSQL + Prisma
- **API:** REST endpoints
- **NLU:** Claude API (or Groq)
- **Libraries:**
  - `xlsx` - Excel parsing
  - `sharp` - Image processing
  - `crypto` - File hashing
  - `date-fns` - Date manipulation

### Frontend
- **Framework:** React + TypeScript
- **Styling:** Tailwind CSS (existing)
- **Animations:** Framer Motion (existing)
- **Charts:** Recharts
- **UI Components:** Radix UI
- **Icons:** Lucide React

### Testing
- **Unit Tests:** Jest
- **Integration Tests:** Jest + Supertest
- **E2E Tests:** Playwright
- **Performance:** Artillery

### DevOps
- **Deployment:** CI/CD (existing)
- **Monitoring:** Sentry, DataDog
- **Logging:** Cloudflare Logpush
- **Backup:** Cloud provider snapshots

---

## 📝 Handover Checklist

After implementation completes:

- [ ] All code merged to main
- [ ] All tests passing
- [ ] Documentation complete
- [ ] UAT sign-off obtained
- [ ] Monitoring configured
- [ ] Runbooks written
- [ ] Support team trained
- [ ] Analytics dashboard set up
- [ ] Performance baselines recorded
- [ ] Known issues documented

---

## 🎯 Next Steps

1. **Approve Specification Phase**
   - Lock in all design decisions
   - Get stakeholder sign-off

2. **Begin Phase 0 (Specification)**
   - Create detailed tech specs
   - Design finalized schemas
   - API contracts locked

3. **Begin Phase 1 (Database)**
   - Write migrations
   - Test on staging
   - Document rollback

4. **Begin Phase 2 (Services)**
   - Implement airline detection
   - Implement duplicate detection
   - Implement analytics service

... continue through phases 3-7

---

## 📞 Questions & Clarifications

Before implementation begins, confirm:

1. ✅ **Airline Detection Confidence Tiers**
   - Auto-continue at 90%+? YES
   - Show prompt at 70-89%? YES
   - Ask manual selection at <70%? YES

2. ✅ **Duplicate Detection Factors**
   - Airline: exact match
   - Date: exact match
   - BSP Period: if available
   - Sales: ±2% tolerance
   - Ticket Count: exact
   - File Hash: exact
   - Result: require explicit overwrite

3. ✅ **Analytics Scope**
   - Full scope (KPIs + trends + staff + comparisons) NOT minimum MVP

4. ✅ **Chatbot Natural Language**
   - YES, full natural language support

5. ✅ **Rollout Strategy**
   - Phase 1: Admin/Finance users
   - Phase 2: All authorized users

---

**Implementation approved and ready to begin.**

**Status:** READY FOR PHASE 0  
**Date:** July 25, 2026  
**Owner:** Development Team

---

## 📋 Document Index

- `SALES_REPORT_MODERNIZATION_INVESTIGATION.md` - Investigation findings
- `SALES_REPORT_INVESTIGATION_SUMMARY.md` - Executive summary
- `IMPLEMENTATION_MASTER_PLAN.md` - This document
- `SCHEMA_SPECIFICATION.md` - Database schema (to be created)
- `API_SPECIFICATION.md` - API endpoints (to be created)
- `SERVICE_ARCHITECTURE.md` - Service designs (to be created)
- `FRONTEND_STRUCTURE.md` - Component hierarchy (to be created)
- `CHATBOT_INTENTS.md` - Intent mappings (to be created)

---

**End of Implementation Master Plan**

*Last Updated: July 24, 2026*  
*Version: 1.0 - APPROVED*
