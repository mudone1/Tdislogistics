# Phase 0: Technical Specification

**Phase:** 0 (Specification & Design)  
**Duration:** 2 days  
**Owner:** Architecture Lead  
**Status:** READY TO BEGIN

---

## 📋 Overview

This document locks down all technical decisions and contracts before any code is written. It serves as the single source of truth for Phases 1-7 implementation.

---

## 1️⃣ DATABASE SCHEMA SPECIFICATION

### New Tables

#### SalesReportAnalytics
**Purpose:** Store executive KPI summary for each report (for fast dashboard queries)

```prisma
model SalesReportAnalytics {
  id                    String      @id @default(cuid())
  reportId              String      @unique
  airline               AirlineKey
  reportDate            String      // "DD/MM/YYYY"
  reportingPeriod       String?     // e.g., "Jul 2024"
  reportingPeriodStart  String?     // Start date of period
  reportingPeriodEnd    String?     // End date of period
  
  // Executive KPIs - All required
  totalTicketsIssued    Int         // Count of PT transactions included
  totalTicketsVoided    Int         // Count of voided tickets
  totalVoidAmount       Decimal @db.Decimal(14, 2)
  totalCreditAmount     Decimal @db.Decimal(14, 2)
  totalDebitAmount      Decimal @db.Decimal(14, 2)
  grossSalesAmount      Decimal @db.Decimal(14, 2)  // Before deductions
  netSalesAmount        Decimal @db.Decimal(14, 2)  // After deductions
  totalCommission       Decimal @db.Decimal(14, 2)
  
  // Airline-specific metrics - Optional
  bspValues             Decimal? @db.Decimal(14, 2)
  refundValues          Decimal? @db.Decimal(14, 2)
  admValues             Decimal? @db.Decimal(14, 2)
  
  // Audit
  createdAt             DateTime    @default(now())
  
  report SalesReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  
  @@unique([reportId])
  @@index([airline, reportDate])
  @@index([airline, reportingPeriodStart, reportingPeriodEnd])
  @@map("sales_report_analytics")
}
```

**Rationale:**
- Denormalized for fast dashboard queries
- No need to aggregate SalesTicket rows on every query
- Pre-calculated values populated when report is saved
- Enables sub-500ms analytics response time

#### ReportDuplicateHistory
**Purpose:** Track report supersessions and maintain audit trail

```prisma
model ReportDuplicateHistory {
  id                    String      @id @default(cuid())
  originalReportId      String      // The report that was replaced
  supersededById        String?     // Which report replaced it (null if just discarded)
  airline               AirlineKey
  reportDate            String      // "DD/MM/YYYY"
  
  // Status tracking
  originalStatus        SalesReportStatus
  replacedAt            DateTime?   // When replacement happened
  replacedBy            String?     // User ID who approved replacement
  replacementReason     String?     // Why it was replaced (user comment)
  
  // Audit
  createdAt             DateTime    @default(now())
  
  @@index([airline, reportDate])
  @@index([originalReportId])
  @@index([supersededById])
  @@map("report_duplicate_history")
}
```

**Rationale:**
- Maintains full audit trail for compliance
- Supports "Show duplicate" workflow
- Enables analytics on replacement frequency
- Never deletes old reports (just marks as superseded)

#### StaffDailyPerformance
**Purpose:** Denormalized staff metrics for fast staff analytics queries

```prisma
model StaffDailyPerformance {
  id                    String      @id @default(cuid())
  date                  String      // "DD/MM/YYYY"
  airline               AirlineKey
  staffName             String      // Resolved display name (e.g., "FLORENCE")
  
  // Metrics
  ticketsIssued         Int
  salesAmount           Decimal @db.Decimal(14, 2)
  commission            Decimal @db.Decimal(14, 2)
  voidAmount            Decimal @db.Decimal(14, 2)
  creditAmount          Decimal @db.Decimal(14, 2)
  
  // Audit
  createdAt             DateTime    @default(now())
  
  @@unique([date, airline, staffName])
  @@index([airline, date])
  @@index([staffName, date])
  @@index([date])  // For "top staff today" queries
  @@map("staff_daily_performance")
}
```

**Rationale:**
- One row per (date, airline, staff) tuple
- Avoids grouping SalesTicket rows on every query
- Enables fast staff performance rankings
- Supports date range aggregation efficiently

#### AirlineDailyMetrics
**Purpose:** Airline totals for trend analysis

```prisma
model AirlineDailyMetrics {
  id                    String      @id @default(cuid())
  date                  String      // "DD/MM/YYYY"
  airline               AirlineKey
  
  // Totals
  totalSales            Decimal @db.Decimal(14, 2)
  totalTickets          Int
  totalVoids            Int
  totalVoidAmount       Decimal @db.Decimal(14, 2)
  netSales              Decimal @db.Decimal(14, 2)
  
  // Audit
  createdAt             DateTime    @default(now())
  
  @@unique([date, airline])
  @@index([airline, date])
  @@index([date])  // For dashboard "today" queries
  @@map("airline_daily_metrics")
}
```

**Rationale:**
- One row per (date, airline) tuple
- Pre-calculated daily totals for trend charts
- Enables sub-500ms trend queries
- Supports weekly/monthly aggregation

### Modified Tables

#### SalesReport
**Add fields:**
```prisma
model SalesReport {
  // ... existing fields ...
  
  // Airline detection
  airlineDetectedBy      String?     // Method: "MANUAL" | "CONTENT" | "FORMAT" | "METADATA" | "VISION"
  detectionConfidence    Float?      // 0-1 confidence score
  detectionReasoning     String[]    // Array of reasons (e.g., "Airline name found in header")
  
  // File tracking
  fileHash               String?     // SHA-256 of uploaded file (for exact duplicate detection)
  originalFilename       String?     // Original uploaded filename
  fileSize               Int?        // Bytes
  importedAt             DateTime?   // Timestamp when imported
  importedBy             String?     // User ID
  
  // Supersession tracking
  supersededById         String?     // If overwritten, which report replaced this
  supersededAt           DateTime?   // When it was superseded
  supersededBy           String?     // User ID who approved supersession
  
  // Relationship
  analytics              SalesReportAnalytics?
  duplicateHistory       ReportDuplicateHistory?
  
  @@index([airline, reportDate, status])
  @@index([fileHash])  // For duplicate detection
  @@index([importedAt])  // For recent reports query
  @@index([supersededById])  // For tracking replacements
}
```

**Rationale:**
- Track detection method for future improvement
- Store confidence for UI (show badge if <90%)
- File hash enables exact duplicate prevention
- Supersession tracking maintains audit trail

#### SalesTicket
**Add fields:**
```prisma
model SalesTicket {
  // ... existing fields ...
  
  // Enhanced metrics (for analytics)
  grossSalesAmount      Decimal? @db.Decimal(14, 2)  // Before deductions
  netSalesAmount        Decimal? @db.Decimal(14, 2)  // After deductions
  commission            Decimal? @db.Decimal(14, 2)
  refundAmount          Decimal? @db.Decimal(14, 2)
  admAmount             Decimal? @db.Decimal(14, 2)
  bspAmount             Decimal? @db.Decimal(14, 2)
}
```

**Rationale:**
- Store all analytics dimensions from the start
- Supports future queries without data reconstruction
- Denormalized for performance

### Indexes

**For performance (all required):**

```sql
-- SalesReportAnalytics indexes
CREATE INDEX idx_sales_report_analytics_airline_date 
  ON sales_report_analytics(airline, reportDate);
CREATE INDEX idx_sales_report_analytics_period 
  ON sales_report_analytics(airline, reportingPeriodStart, reportingPeriodEnd);

-- StaffDailyPerformance indexes
CREATE INDEX idx_staff_daily_perf_airline_date 
  ON staff_daily_performance(airline, date);
CREATE INDEX idx_staff_daily_perf_name_date 
  ON staff_daily_performance(staffName, date);
CREATE INDEX idx_staff_daily_perf_date 
  ON staff_daily_performance(date);

-- AirlineDailyMetrics indexes
CREATE INDEX idx_airline_daily_metrics_date 
  ON airline_daily_metrics(airline, date);
CREATE INDEX idx_airline_daily_metrics_date_only 
  ON airline_daily_metrics(date);

-- SalesReport indexes (existing + new)
CREATE INDEX idx_sales_report_hash 
  ON sales_reports(fileHash);
CREATE INDEX idx_sales_report_imported_at 
  ON sales_reports(importedAt);
```

### Migration Strategy

**Safe process:**

1. **Create new tables** (PostgreSQL supports concurrent access)
2. **Add columns** to existing tables (null-safe with defaults)
3. **Create indexes** (can be done concurrently)
4. **Backfill data** (populate analytics tables from existing reports)
5. **Test on staging** (verify no data loss)
6. **Deploy to production** (during maintenance window)
7. **Validate integrity** (run checks)
8. **Document rollback** (keep backfill script for undo)

**Backwards Compatibility:** 
- Old queries still work (old tables unchanged)
- Old APIs still respond (no endpoint changes)
- New fields default to null (safe for existing code)

---

## 2️⃣ API SPECIFICATION

### Sales Report Endpoints

#### POST /api/sales-reports/generate
**Purpose:** Generate report from Excel file(s)

**Request:**
```typescript
interface GenerateReportRequest {
  airline?: AirlineRuleKey;  // Optional - will auto-detect if not provided
  files: File[];              // One or more .xls/.xlsx or images
  createdBy?: string;         // User ID (optional)
}
```

**Response (200 OK):**
```typescript
interface GeneratedReportSummary {
  reportId: string;
  airline: AirlineRuleKey;
  reportDate: string;         // "DD/MM/YYYY"
  reportText: string;         // Full rendered report
  grandTotal: number;
  confidence: number;         // 0-1
  needsReview: boolean;       // true if confidence < 0.9
  confidenceReasons: string[];
  staffTotals: { staffName: string; amount: number; transactionCount: number }[];
  ticketCount: number;
  transactionsIncludedCount: number;
  transactionsIgnoredCount: number;
  unknownStaff: string[];
  warnings: string[];
  
  // NEW: Detection metadata
  airlineDetectedBy?: string;      // "MANUAL" | "CONTENT" | "FORMAT" | "METADATA"
  detectionConfidence?: number;    // 0-1 if auto-detected
  
  // NEW: Duplicate detection
  isDuplicate?: boolean;
  existingReportId?: string;
  existingReport?: {
    date: string;
    airline: string;
    totals: { sales: number; tickets: number };
  };
}
```

**Response (409 Conflict) - Duplicate Detected:**
- Return `isDuplicate: true` with existing report details
- User can choose to proceed or cancel
- Do NOT auto-overwrite

#### POST /api/sales-reports/detect-airline
**Purpose:** Standalone airline detection (for chatbot)

**Request:**
```typescript
interface DetectAirlineRequest {
  file: File;
  userHint?: string;  // e.g., "I'm uploading my Air Peace report"
}
```

**Response (200 OK):**
```typescript
interface DetectAirlineResult {
  airline: AirlineRuleKey | null;
  confidence: number;           // 0-1
  method: "CONTENT" | "FORMAT" | "METADATA" | "VISION" | "UNKNOWN";
  reasoning: string[];
  requiresConfirmation: boolean; // true if 70-89%
  requiresUserSelection: boolean; // true if <70%
  alternativeMatches?: {
    airline: AirlineRuleKey;
    confidence: number;
  }[];
}
```

#### POST /api/sales-reports/check-duplicate
**Purpose:** Check if report already exists

**Request:**
```typescript
interface CheckDuplicateRequest {
  airline: AirlineRuleKey;
  reportDate: string;           // "DD/MM/YYYY"
  totalSales: number;
  ticketCount: number;
  fileHash?: string;            // SHA-256 hex
  bspPeriod?: string;
}
```

**Response (200 OK):**
```typescript
interface CheckDuplicateResult {
  isDuplicate: boolean;
  matchScore?: number;          // 0-1 if duplicate found
  existingReport?: {
    id: string;
    date: string;
    airline: string;
    totals: {
      sales: number;
      tickets: number;
      voids: number;
    };
    savedAt: string;
  };
  matchFactors?: {
    airline: boolean;
    date: boolean;
    bspPeriod?: boolean;
    salesAmount: number;        // 0-1 similarity
    ticketCount: boolean;
    fileHash?: boolean;
  };
}
```

#### POST /api/sales-reports/{id}/confirm
**Purpose:** Save report (after user verification)

**Request:**
```typescript
interface ConfirmReportRequest {
  verifiedBy?: string;
  staffCorrections?: Record<string, string>;  // rawCode -> corrected name
  overwriteExisting?: boolean;  // If duplicate detected
}
```

**Response (200 OK):**
```typescript
interface ConfirmReportResponse {
  reportId: string;
  status: "SAVED";
  airline: AirlineRuleKey;
  reportDate: string;
  grandTotal: number;
  verifiedAt: string;           // ISO timestamp
  
  // If overwrite happened
  replacedReportId?: string;
  replacedAt?: string;
}
```

#### GET /api/sales-reports/history
**Purpose:** Get paginated list of reports

**Query Parameters:**
```typescript
interface HistoryQuery {
  limit?: number;               // 20 (default), max 100
  offset?: number;              // 0 (default)
  airline?: AirlineRuleKey;     // Filter
  status?: "PENDING_VERIFICATION" | "SAVED" | "SUPERSEDED";
  dateFrom?: string;            // "DD/MM/YYYY"
  dateTo?: string;              // "DD/MM/YYYY"
  sortBy?: "date" | "airline" | "status";  // default: "date"
  sortOrder?: "asc" | "desc";   // default: "desc"
}
```

**Response (200 OK):**
```typescript
interface HistoryResponse {
  total: number;
  offset: number;
  limit: number;
  reports: {
    id: string;
    airline: AirlineRuleKey;
    reportDate: string;
    grandTotal: number;
    status: SalesReportStatus;
    ticketCount: number;
    staffCount: number;
    createdAt: string;
    verifiedAt?: string;
    detectionConfidence?: number;
  }[];
}
```

#### GET /api/sales-reports/{id}
**Purpose:** Get full report details

**Response (200 OK):**
```typescript
interface ReportDetailResponse {
  id: string;
  airline: AirlineRuleKey;
  reportDate: string;
  status: SalesReportStatus;
  
  // Summary
  reportText: string;
  grandTotal: number;
  confidence: number;
  
  // Detection metadata
  airlineDetectedBy?: string;
  detectionConfidence?: number;
  detectionReasoning?: string[];
  
  // File metadata
  originalFilename?: string;
  fileHash?: string;
  fileSize?: number;
  
  // Audit
  createdAt: string;
  createdBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  
  // Staff breakdown
  staffSales: {
    staffName: string;
    amount: number;
    transactionCount: number;
  }[];
  
  // Transaction details
  transactions: {
    id: string;
    staffName: string;
    amount: number;
    paymentType: string;
    status: string;
    date?: string;
  }[];
  
  // If superseded
  supersededBy?: {
    reportId: string;
    date: string;
    airline: string;
  };
}
```

### Analytics Endpoints

#### GET /api/analytics/kpi
**Purpose:** Get executive KPI summary

**Query Parameters:**
```typescript
interface KPIQuery {
  dateFrom?: string;            // "DD/MM/YYYY", default: today
  dateTo?: string;              // "DD/MM/YYYY", default: today
  airlines?: AirlineRuleKey[];  // Filter, default: all
  timeUnit?: "day" | "week" | "month"; // For comparison
}
```

**Response (200 OK):**
```typescript
interface KPIResponse {
  period: {
    from: string;
    to: string;
  };
  totals: {
    totalSales: number;
    totalRevenue: number;
    totalTickets: number;
    totalVoids: number;
    totalVoidAmount: number;
    totalCreditAmount: number;
    totalDebitAmount: number;
    netSales: number;
  };
  breakdown: {
    byAirline: Record<AirlineRuleKey, typeof totals>;
    byStaff: Record<string, typeof totals>;
  };
  comparison?: {
    previousPeriod: typeof totals;
    growth: {
      sales: number;           // percent
      tickets: number;         // percent
      revenue: number;         // percent
    };
  };
}
```

#### GET /api/analytics/airline
**Purpose:** Airline performance metrics

**Query Parameters:**
```typescript
interface AirlineQuery {
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "sales" | "tickets" | "growth";
  sortOrder?: "asc" | "desc";
}
```

**Response (200 OK):**
```typescript
interface AirlineAnalyticsResponse {
  period: { from: string; to: string };
  airlines: {
    airline: AirlineRuleKey;
    rank: number;
    sales: number;
    revenue: number;
    tickets: number;
    voids: number;
    netSales: number;
    growth: number;             // percent vs previous period
    staffCount: number;
    topStaff: {
      name: string;
      sales: number;
      tickets: number;
    }[];
  }[];
}
```

#### GET /api/analytics/staff
**Purpose:** Staff performance metrics

**Query Parameters:**
```typescript
interface StaffQuery {
  dateFrom?: string;
  dateTo?: string;
  airline?: AirlineRuleKey;     // Optional filter
  sortBy?: "sales" | "tickets" | "growth";
  sortOrder?: "asc" | "desc";
}
```

**Response (200 OK):**
```typescript
interface StaffAnalyticsResponse {
  period: { from: string; to: string };
  staff: {
    name: string;
    rank: number;
    airline: AirlineRuleKey;
    sales: number;
    commission: number;
    tickets: number;
    voids: number;
    voidAmount: number;
    growth: number;
    dailyBreakdown?: {
      date: string;
      sales: number;
      tickets: number;
    }[];
  }[];
}
```

#### GET /api/analytics/trends
**Purpose:** Trend data for charts

**Query Parameters:**
```typescript
interface TrendsQuery {
  dateFrom?: string;
  dateTo?: string;
  granularity?: "daily" | "weekly" | "monthly";
  metric?: "sales" | "tickets" | "revenue" | "voids";
  airline?: AirlineRuleKey;
  compareWithPrevious?: boolean;
}
```

**Response (200 OK):**
```typescript
interface TrendsResponse {
  period: { from: string; to: string };
  granularity: string;
  data: {
    date: string;           // "DD/MM/YYYY" for daily, "WXX/2024" for weekly
    sales: number;
    tickets: number;
    revenue: number;
    voids: number;
    netSales: number;
    previousPeriod?: {
      sales: number;
      tickets: number;
      // ...
    };
  }[];
}
```

#### GET /api/analytics/comparison
**Purpose:** Compare current period with previous

**Query Parameters:**
```typescript
interface ComparisonQuery {
  dateFrom?: string;
  dateTo?: string;
  airlines?: AirlineRuleKey[];
}
```

**Response (200 OK):**
```typescript
interface ComparisonResponse {
  currentPeriod: {
    from: string;
    to: string;
    metrics: KPI;
  };
  previousPeriod: {
    from: string;
    to: string;
    metrics: KPI;
  };
  changes: {
    sales: number;          // percent
    tickets: number;        // percent
    revenue: number;        // percent
    voids: number;          // percent
  };
}
```

#### GET /api/analytics/growth
**Purpose:** Growth calculations

**Query Parameters:**
```typescript
interface GrowthQuery {
  dateFrom?: string;
  dateTo?: string;
  airlines?: AirlineRuleKey[];
  compareTo?: "previousMonth" | "previousYear" | "custom"; // with dateFrom2, dateTo2
}
```

**Response (200 OK):**
```typescript
interface GrowthResponse {
  period: { from: string; to: string };
  comparisonPeriod: { from: string; to: string };
  growth: {
    sales: { absolute: number; percent: number };
    tickets: { absolute: number; percent: number };
    revenue: { absolute: number; percent: number };
    voids: { absolute: number; percent: number };
  };
  byAirline: Record<AirlineRuleKey, typeof growth>;
  byStaff: Record<string, typeof growth>;
}
```

### Error Responses

**All endpoints return consistent errors:**

```typescript
interface ErrorResponse {
  error: string;
  code: string;                 // e.g., "DUPLICATE_DETECTED", "INVALID_AIRLINE"
  details?: Record<string, any>;
  timestamp: string;            // ISO
}
```

**Common Error Codes:**
- `400 BAD_REQUEST` - Invalid parameters
- `401 UNAUTHORIZED` - Not authenticated
- `403 FORBIDDEN` - Don't have permission (non-Admin/Finance)
- `404 NOT_FOUND` - Report doesn't exist
- `409 CONFLICT` - Duplicate detected (return existing report)
- `413 PAYLOAD_TOO_LARGE` - File exceeds limit (50MB)
- `422 VALIDATION_ERROR` - Invalid data
- `500 INTERNAL_ERROR` - Server error

---

## 3️⃣ CHATBOT INTENT SYSTEM

### Intent Types

```typescript
type SalesReportIntent =
  | "UPLOAD_REPORT"              // "Upload my report"
  | "SHOW_SALES_SUMMARY"         // "Show sales"
  | "SHOW_SALES_DETAILED"        // "Detailed sales breakdown"
  | "SHOW_STAFF_PERFORMANCE"     // "How did John perform?"
  | "SHOW_AIRLINE_COMPARISON"    // "Which airline is best?"
  | "SHOW_BALANCE"               // "What's my balance?"
  | "SHOW_TRENDS"                // "Show trends"
  | "CONFIRM_DUPLICATE"          // "Overwrite the old report"
  | "CANCEL_UPLOAD";             // "Cancel/Never mind"
```

### Parameter Extraction

```typescript
interface IntentParameters {
  timeExpression?: string;       // "today", "yesterday", "this week", "last month", "between X and Y"
  timeFrom?: string;             // "DD/MM/YYYY" (parsed from timeExpression)
  timeTo?: string;               // "DD/MM/YYYY"
  airline?: AirlineRuleKey;      // Airline if mentioned
  staffName?: string;            // Person's name if mentioned
  metric?: string;               // "sales", "tickets", "revenue", "voids", "commission"
  period?: "daily" | "weekly" | "monthly";  // Granularity if mentioned
}
```

### Example Mappings

| User Input | Intent | Parameters |
|-----------|--------|------------|
| "Upload my report" | UPLOAD_REPORT | {} |
| "Show today's sales" | SHOW_SALES_SUMMARY | { timeExpression: "today" } |
| "Show Air Peace sales from 1 July to 15 July" | SHOW_SALES_DETAILED | { airline: "AIRPEACE", timeFrom: "01/07/2024", timeTo: "15/07/2024" } |
| "Which airline sold the most today?" | SHOW_AIRLINE_COMPARISON | { timeExpression: "today", metric: "sales" } |
| "How many tickets did John issue yesterday?" | SHOW_STAFF_PERFORMANCE | { staffName: "John", timeExpression: "yesterday", metric: "tickets" } |
| "Show me total void amount this month" | SHOW_SALES_SUMMARY | { timeExpression: "this month", metric: "voids" } |
| "What's my balance?" | SHOW_BALANCE | {} |
| "Balance update" | SHOW_BALANCE | {} |
| "Show trends" | SHOW_TRENDS | {} |
| "Yes, overwrite it" | CONFIRM_DUPLICATE | {} |

### Time Expression Parsing

**Supported Formats:**
- Relative: "today", "yesterday", "this week", "last week", "this month", "last month", "this year", "last year"
- Explicit dates: "01/07/2024", "July 1st", "1 July"
- Ranges: "between 1 July and 15 July", "from today to next week"
- Shortcuts: "d7" (last 7 days), "d30" (last 30 days), "m" (this month), "y" (this year)

**Parsing Algorithm:**
1. Extract date expressions using regex
2. Resolve relative dates using today's date
3. Return both `timeFrom` and `timeTo` as "DD/MM/YYYY"

### Context Awareness

**Persistent Context (per chat session):**
- Last mentioned airline → use in next query if not specified
- Last used date range → use in next query if not specified
- Last metric → use in next query if not specified

**Example:**
```
User: "Show Air Peace sales this week"
Bot: "Air Peace sales this week: ₦2.4M in 85 tickets"

User: "How many tickets?"
Bot: (remembers Air Peace + this week) "Air Peace tickets this week: 85"

User: "Show Aero"
Bot: (now switch to Aero) "Aero sales this week: ₦1.8M in 62 tickets"
```

### Response Templates

**Sales Summary:**
```
📊 {Airline} Sales - {Period}
━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Sales: ₦{amount}
Tickets Issued: {count}
Tickets Voided: {count}
Void Amount: ₦{amount}
Net Sales: ₦{amount}

📈 Trend: {growth}% vs {previous period}
```

**Staff Performance:**
```
👤 {Name} Performance - {Period}
━━━━━━━━━━━━━━━━━━━━━━━

Rank: {rank} of {total}
Sales: ₦{amount}
Commission: ₦{amount}
Tickets Issued: {count}
Tickets Voided: {count}

🏆 Top performer: {name} with ₦{amount}
```

**Balance Update:**
```
💰 Airline Balances
━━━━━━━━━━━━━━━━━━

Air Peace:    ₦{amount}
Aero:         ₦{amount}
Ibom:         ₦{amount}
Arik:         ₦{amount}

Last Updated: {timestamp}
```

---

## 4️⃣ SERVICE ARCHITECTURE

### AirlineDetectionService

**File:** `src/modules/sales-reporting/services/AirlineDetectionService.ts`

**Public Methods:**

```typescript
class AirlineDetectionService {
  // Main entry point
  static async detect(
    buffer: Buffer,
    filename?: string,
    userHint?: string
  ): Promise<DetectionResult>
  
  // Helper methods (used internally)
  private static detectByContent(buffer: Buffer): DetectionResult
  private static detectByFormat(buffer: Buffer): DetectionResult
  private static detectByHeaders(buffer: Buffer): DetectionResult
  private static detectByMetadata(filename: string): DetectionResult
  private static async detectByVision(buffer: Buffer): Promise<DetectionResult>
  
  // Utility
  private static scoreConfidence(signals: string[]): number
  private static rankResults(results: DetectionResult[]): DetectionResult
}
```

**Detection Priority (evaluated in order):**

1. **Content Analysis** (highest priority)
   - Parse first 10 rows of Excel
   - Look for airline name keywords (case-insensitive)
   - Examples: "Air Peace", "Aero", "Ibom Air", "Arik"
   - Confidence: 90-95% if exact match found

2. **Format Detection**
   - Check header row patterns specific to airlines
   - Aero headers: "Payment Date", "PT", "Balance"
   - Air Peace headers: similar pattern
   - Confidence: 80-85% if format matches

3. **Metadata Detection**
   - Parse filename for airline keywords
   - Examples: "Aero_Daily_2024-07-24.xlsx"
   - Confidence: 70-75% if filename match

4. **Vision Fallback** (if <70% from above)
   - Use Claude Vision to analyze Excel screenshot
   - Ask model: "What airline is this report for?"
   - Confidence: varies based on model response

5. **Unknown** (if all fail)
   - Return null airline + low confidence
   - Require manual selection

**Result:**
```typescript
interface DetectionResult {
  airline: AirlineRuleKey | null;
  confidence: number;           // 0-1
  method: "CONTENT" | "FORMAT" | "METADATA" | "VISION" | "UNKNOWN";
  reasoning: string[];          // Debug info
  requiresConfirmation?: boolean; // true if 70-89%
  requiresUserSelection?: boolean; // true if <70%
  alternativeMatches?: {
    airline: AirlineRuleKey;
    confidence: number;
  }[];
}
```

### DuplicateCheckService

**File:** `src/modules/sales-reporting/services/DuplicateCheckService.ts`

**Public Method:**

```typescript
class DuplicateCheckService {
  static async checkDuplicate(
    airline: AirlineRuleKey,
    reportDate: string,        // "DD/MM/YYYY"
    totalSales: number,
    ticketCount: number,
    fileHash?: string,
    bspPeriod?: string
  ): Promise<DuplicateMatch | null>
}
```

**Matching Algorithm:**

1. **Query for existing SAVED reports:**
   - WHERE airline = {airline}
   - AND reportDate = {reportDate}
   - AND status = 'SAVED'

2. **Calculate match score (0-1) based on:**
   - Airline: Must match (100%)
   - Date: Must match (100%)
   - File Hash: If provided, exact match (100%)
   - Sales Amount: Within ±2% (70%)
   - Ticket Count: Must match (100%)
   - BSP Period: If available, match (80%)

3. **Return result:**
   - If any exact duplicate found (hash OR all factors match): return match with score > 0.95
   - If significant similarity (most factors match): return match with score 0.80-0.95
   - If no similarity: return null

**Result:**
```typescript
interface DuplicateMatch {
  matchScore: number;           // 0-1
  existingReport: {
    id: string;
    date: string;
    airline: string;
    totals: { sales: number; tickets: number; voids: number };
    savedAt: string;
  };
  matchFactors: {
    airline: boolean;
    date: boolean;
    bspPeriod?: boolean;
    salesAmount: number;        // 0-1 similarity
    ticketCount: boolean;
    fileHash?: boolean;
  };
}
```

### AnalyticsService

**File:** `src/modules/sales-reporting/services/AnalyticsService.ts`

**Core Query Methods:**

```typescript
class AnalyticsService {
  // Executive KPIs
  static async getExecutiveSummary(
    dateFrom: string,
    dateTo: string,
    airlines?: AirlineRuleKey[]
  ): Promise<ExecutiveKPIs>
  
  // Airline breakdowns
  static async getAirlineMetrics(
    dateFrom: string,
    dateTo: string,
    sortBy?: "sales" | "tickets" | "growth"
  ): Promise<AirlineMetric[]>
  
  // Staff breakdowns
  static async getStaffMetrics(
    dateFrom: string,
    dateTo: string,
    airline?: AirlineRuleKey,
    sortBy?: "sales" | "tickets" | "commission"
  ): Promise<StaffMetric[]>
  
  // Trends
  static async getTrendData(
    dateFrom: string,
    dateTo: string,
    granularity: "daily" | "weekly" | "monthly",
    airline?: AirlineRuleKey
  ): Promise<TrendPoint[]>
  
  // Comparisons
  static async compareWithPreviousPeriod(
    dateFrom: string,
    dateTo: string,
    airlines?: AirlineRuleKey[]
  ): Promise<ComparisonMetrics>
  
  // Growth
  static async calculateGrowth(
    dateFrom: string,
    dateTo: string,
    compareToFrom?: string,
    compareToDirect?: string
  ): Promise<GrowthMetrics>
}
```

**Optimization Strategy:**
- Use denormalized tables (AirlineDailyMetrics, StaffDailyPerformance, SalesReportAnalytics)
- Cache common queries (5-minute TTL)
- Lazy-load detailed breakdowns
- Use indexes for fast filtering

### SalesReportAssistant

**File:** `src/modules/travel-assistant/orchestration/SalesReportAssistant.ts`

**Public Methods:**

```typescript
class SalesReportAssistant {
  // Extract intent from user message
  static async extractIntent(message: string): Promise<IntentExtractionResult>
  
  // Handle file upload
  static async handleFileUpload(
    file: File,
    sessionContext?: SessionContext
  ): Promise<UploadHandlerResult>
  
  // Handle query
  static async handleQuery(
    message: string,
    sessionContext?: SessionContext
  ): Promise<QueryHandlerResult>
  
  // Get response template
  private static formatResponse(
    intent: SalesReportIntent,
    data: any
  ): string
}
```

**Intent Extraction:**
- Use Claude API (or Groq if available) to parse natural language
- Extract parameters (airline, date range, staff name, metric)
- Return structured result

**Session Context:**
```typescript
interface SessionContext {
  lastAirline?: AirlineRuleKey;
  lastDateFrom?: string;
  lastDateTo?: string;
  lastMetric?: string;
  uploadedReportId?: string;  // If just uploaded
}
```

---

## 5️⃣ FRONTEND COMPONENT STRUCTURE

### Component Hierarchy

```
src/components/
├── sections/
│   ├── SalesReportsSection.tsx          (Main page)
│   └── AnalyticsDashboardSection.tsx    (Analytics page)
├── sales-reports/
│   ├── ReportUploadCard.tsx             (Upload widget)
│   ├── ReportHistoryTable.tsx           (List of reports)
│   ├── ReportDetailModal.tsx            (Details drawer)
│   ├── DuplicateDialog.tsx              (Duplicate workflow)
│   ├── DateRangeFilter.tsx              (Date picker)
│   ├── AnalyticsCharts.tsx              (Chart components)
│   └── StaffPerformanceCard.tsx         (Staff widget)
└── layout/
    └── ChatBubble.tsx                    (Updated for sales reports)
```

### Component Specs

#### SalesReportsSection
- Main container for sales reports page
- Tabs: "Reports", "Analytics"
- Upload form + history table
- Quick filters
- Responsive layout

#### ReportUploadCard
- Drag-drop zone for Excel files
- File preview
- Auto-detect display (showing confidence)
- Submit button

#### ReportHistoryTable
- Paginated table (20 per page)
- Columns: Airline, Date, Status, Totals, Actions
- Sorting (by date, airline, status)
- Filtering (by airline, date range, status)
- Row actions (View, Download, Delete)

#### ReportDetailModal
- Full report display
- Readable typography
- Copy button for report text
- Download PDF/CSV
- Staff breakdown table
- Transaction drill-down

#### DuplicateDialog
- Modal dialog
- Message: "This report already exists"
- Existing report summary
- Comparison table (old vs new)
- Three buttons: View, Overwrite, Cancel

#### AnalyticsDashboardSection
- 4 KPI cards (animated entrance)
- Sales by airline chart (bar)
- Tickets by airline chart (pie)
- Daily trend chart (line)
- Weekly trend chart (line)
- Staff performance table
- Export buttons (PDF, CSV)
- Date range selector

#### DateRangeFilter
- Preset buttons: Today, This Week, This Month, Custom
- Custom date picker (dual dates for range)
- Apply/Clear buttons

### Styling Approach

**Design System:**
- Tailwind CSS utility classes
- Framer Motion for animations
- Custom CSS variables for theming
- Dark mode support (existing)

**Component Patterns:**
- Functional components + React hooks
- Composition over inheritance
- Custom hooks for logic (useAnalytics, useReportHistory, etc.)
- Props validation (TypeScript)

**Responsive Breakpoints:**
- Mobile: < 640px (single column, stack components)
- Tablet: 640px - 1024px (2 column, adjusted spacing)
- Desktop: > 1024px (3+ column, full layout)

---

## 6️⃣ STATE MANAGEMENT

### Global State (Zustand store)

```typescript
interface SalesReportStore {
  // Uploads in progress
  uploadingReports: Map<string, UploadProgress>;
  setUploadProgress(id: string, progress: UploadProgress): void;
  removeUploadProgress(id: string): void;
  
  // Analytics cache
  cachedAnalytics: Map<string, AnalyticsData>;
  setAnalyticsCache(key: string, data: AnalyticsData): void;
  
  // Selected filters
  selectedDateRange: DateRange;
  setDateRange(from: string, to: string): void;
  selectedAirlines: AirlineRuleKey[];
  setSelectedAirlines(airlines: AirlineRuleKey[]): void;
  
  // UI state
  showDuplicateDialog: boolean;
  duplicateData: DuplicateMatch | null;
  setDuplicate(data: DuplicateMatch | null): void;
}
```

### Local Component State

- Individual form inputs (React.useState)
- Modal open/close (React.useState)
- Loading states (React.useState)
- Error messages (React.useState)

---

## 7️⃣ ERROR HANDLING STRATEGY

### HTTP Errors

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Bad request | Show user-friendly error, highlight invalid field |
| 401 | Unauthorized | Redirect to login |
| 403 | Forbidden | Show "Access denied" message |
| 409 | Conflict (duplicate) | Show duplicate dialog |
| 413 | File too large | Show error "File exceeds 50MB limit" |
| 422 | Validation error | Show validation errors next to fields |
| 500 | Server error | Show "Server error, please try again" + retry button |

### File Upload Errors

- File size > 50MB: Show error immediately
- Wrong file type: Reject at file input level
- Parse error: Show warning "Could not parse file: {detail}"
- Empty file: Show error "File is empty"

### Detection Errors

- Confidence < 70%: Ask user to select airline manually
- Vision API fails: Fall back to user selection
- Timeout (>10s): Show "Detection taking too long, please select"

### Network Errors

- Timeout: Show "Request timed out, please try again"
- Connection lost: Retry with exponential backoff (3 attempts)
- Server down: Show "Service temporarily unavailable"

---

## 8️⃣ PERFORMANCE TARGETS

### API Response Times

- Generate report: < 10s (for <10K rows)
- Auto-detect airline: < 2s
- Check duplicate: < 1s
- Analytics queries: < 500ms
- Chatbot response: < 3s

### Frontend Performance

- Initial page load: < 2s
- Analytics dashboard render: < 2s
- History table scroll: smooth (60fps)
- Chart animations: smooth (60fps)

### Database Performance

- Report generation: < 10s write
- Analytics query: < 500ms read
- Duplicate check: < 1s read
- Staff ranking query: < 500ms read

---

## 9️⃣ Security Considerations

### Authentication & Authorization

- All endpoints require authentication (Firebase)
- Admin or Finance role required
- Validate role on every API call
- No cross-user data access

### File Upload Security

- Validate file type (only .xls/.xlsx or images)
- Limit file size (50MB max)
- Scan for malicious content (optional: virus scan)
- Store files with restricted access
- Clean up old uploaded files (30-day retention)

### Data Privacy

- No PII in logs
- Sensitive data not in error messages
- SQL injection prevention (use parameterized queries)
- CSRF protection (existing framework)

### API Security

- Rate limiting: 100 requests/minute per user
- Input validation on all parameters
- Output encoding for JSON responses
- No sensitive data in URLs (use POST for sensitive)

---

## 🔟 TESTING STRATEGY

### Unit Tests

**Coverage Target:** 95% for core services

**Test Files:**
- `AirlineDetectionService.test.ts`
- `DuplicateCheckService.test.ts`
- `AnalyticsService.test.ts`
- `SalesReportAssistant.test.ts`

### Integration Tests

**Coverage Target:** 80% for workflows

**Test Scenarios:**
- Upload → Detect → Save
- Upload → Duplicate → Overwrite → Verify
- Chatbot upload workflow
- Chatbot query workflow
- Analytics dashboard load

### E2E Tests

**Coverage Target:** All critical user workflows

**Test Scenarios (Playwright):**
- Admin uploads Excel
- Chatbot user uploads and queries
- Duplicate detection and overwrite
- Large file handling (50K rows)
- Dashboard navigation and filtering

### Performance Tests

**Benchmarks:**
- Parse 10K rows: < 5s
- Dashboard load: < 2s
- Analytics query: < 500ms
- Chatbot response: < 3s

---

## Completion Checklist

**Phase 0 Deliverables:**

- [x] Database schema finalized
- [x] API contracts locked down
- [x] Service architecture designed
- [x] Component hierarchy documented
- [x] Intent system documented
- [x] Error handling strategy defined
- [x] Testing approach defined
- [x] Performance targets set
- [x] Security guidelines documented

**Acceptance Criteria:**
- [x] No ambiguity in requirements
- [x] All team members understand design
- [x] API contracts finalized
- [x] Database scalable for 10yr+ data
- [x] No breaking changes to existing code

---

**End of Phase 0 Technical Specification**

*Ready for Phase 1: Database Setup*

*Next Phase Start Date: July 26, 2026*
