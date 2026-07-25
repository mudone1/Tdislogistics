# Sales Report Modernization - Investigation & Analysis

**Date:** July 24, 2026  
**Status:** Investigation Complete - Ready for Architecture Review

---

## Executive Summary

The current Sales Report module is **functional but isolated**. It's buried in the Admin Dashboard, requires manual airline selection before upload, and has **no integration with the existing AI chatbot**. The underlying parsing and rule engine are robust and reusable, but the UX is dated and rigid.

**Key Finding:** The infrastructure to support Feature 1-6 already exists at the service layer. We don't need to rebuild—we need to surface it differently.

---

## 1. CURRENT SALES REPORT WORKFLOW

### Location
- **Path:** Admin Dashboard → Admin Section → Sales Reports Tab
- **File:** `src/components/sections/admin/SalesReportsTab.tsx`
- **Access:** Admin-only, behind `isAdminRole()` permission check

### Current UI/UX Workflow
```
1. Admin selects airline from dropdown (AERO, AIRPEACE, IBOM, ARIK)
2. Admin uploads Excel file (.xls/.xlsx)
3. System parses file → extracts rows → applies airline-specific rules
4. System generates "Daily Sales Report" text
5. Shows generated report for human review
6. Admin clicks "Save Report" or "Discard"
   - If Save: confirmation saves to database, marks as SAVED
   - If Discard: report stays in PENDING_VERIFICATION (discarded)
7. No publish to main dashboard
```

### Pain Points Observed
- ✗ Manual airline selection required (not intelligent)
- ✗ Workflow is rigid—must go through 6 steps in order
- ✗ No duplicate handling beyond basic "are you sure?"
- ✗ No integration with chatbot
- ✗ No analytics beyond text report
- ✗ No dashboard visibility of sales data
- ✗ Staff corrections must happen during verification—can't be taught later

---

## 2. HOW EXCEL FILES ARE UPLOADED & PROCESSED

### Upload Pipeline
```
POST /api/sales-reports/generate
  ├─ multipart/form-data
  ├─ "airline" field (must be one of: AERO, AIRPEACE, IBOM, ARIK)
  ├─ "files" field (one or more files)
  └─ "createdBy" field (optional, user identifier)
```

### File Type Detection
- **Excel:** `.xls` or `.xlsx` extension → parsed via XLSX library
- **Screenshot:** Image MIME types → extracted via Claude Vision API
- **Other:** Rejected upstream

### Processing Flow
1. **Parse Excel:**
   - Uses XLSX library to read sheet data
   - Identifies header row (fuzzy match on column names)
   - Extracts rows into normalized `RawTransactionRow[]` format
   - Warnings collected if header not found or columns ambiguous

2. **Parse Screenshots:**
   - All screenshots merged into one vision-extraction call
   - Vision model extracts transaction rows from image(s)
   - Results merged into same `RawTransactionRow[]` format

3. **Merge Rows:**
   - Excel rows + screenshot rows combined
   - Deduplicated by content hash (prevents double-counting)

---

## 3. AIRLINE DETECTION MECHANISM

### Current Status: MANUAL SELECTION REQUIRED
The system does **NOT** automatically detect airlines. Admin must select from dropdown.

### What COULD Support Auto-Detection
**Found in ChatBubble.tsx, lines 44-55:**
```typescript
const SALES_REPORT_AIRLINES = [
  { key: "AERO", label: "Aero", aliases: ["aero"] },
  { key: "AIRPEACE", label: "Airpeace", aliases: ["airpeace", "air peace"] },
  { key: "IBOM", label: "Ibom", aliases: ["ibom"] },
  { key: "ARIK", label: "Arik", aliases: ["arik"] },
];

function matchSalesReportAirline(text: string): { key: string; label: string } | null {
  const t = text.toLowerCase();
  const match = SALES_REPORT_AIRLINES.find((a) => a.aliases.some((alias) => t.includes(alias)));
  return match ? { key: match.key, label: match.label } : null;
}
```

This is **user intent matching** (for chat), not file content matching. For true auto-detection, we'd need:
- Vision model to analyze Excel screenshot/header
- Rule-engine inspection to see which rules "fit" the data best
- Confidence scoring on detection

**Recommendation:** Use combination of:
1. File content analysis (inspect first few rows for airline-specific patterns)
2. Filename analysis (e.g., "Aero_Daily_2024-07-24.xlsx")
3. User message context (if coming from chatbot: "Here's my Aero report")

---

## 4. CURRENT DAILY SALES REPORT GENERATION

### Core Engine: Rule-Based Classification
**Located:** `src/modules/sales-reporting/rules/`

Four airline-specific rule engines:
- `AeroRules.ts` - Aero airlines rule implementation
- `AirPeaceRules.ts` - Air Peace rule implementation
- `IbomRules.ts` - Ibom rule implementation
- `ArikRules.ts` - Arik rule implementation
- `RuleEngine.ts` - Generic rule orchestrator
- `shared.ts` - Shared classification logic

### Transaction Flow
1. **Raw Row** (from Excel or screenshot)
   ```typescript
   {
     rowIndex: number;
     user: string; // "TDISLOGIST-FLORENCE AINA"
     kind: "PT" | "PM" | "CL" | "RT" | "OTHER";
     drCr: "DEBIT" | "CREDIT" | null;
     paymentTypeLabel: string; // original label
     amount: number;
     mcoReference?: string;
     pnr?: string;
     date?: string; // "DD/MM/YYYY"
     raw: string; // verbatim row text
   }
   ```

2. **Classification** (Rule Engine)
   - Apply airline-specific rules to categorize transaction
   - Result: `TransactionStatus` (INCLUDED, IGNORED_PM, IGNORED_CREDIT, etc.)
   - Staff name resolved via alias lookup

3. **Report Text Generation** (ReportTextRenderer.ts)
   - Formats classified transactions into human-readable text
   - Shows per-staff subtotals
   - Shows SYSTEM (non-staff) transactions
   - Format: plain text, easy to copy-paste for management

### Example Output
```
═══════════════════════════════════════════
DAILY SALES REPORT - AERO
Report Date: 24/07/2024

SALES BREAKDOWN BY STAFF:
─────────────────────────

FLORENCE AINA
  Ticket Sales:  ₦245,000.00
  Transactions:  3
  Void Tickets:  1
  Void Amount:   ₦15,000.00

SYSTEM (Non-Staff Sales)
  Deposit:       ₦50,000.00
  Commission:    ₦5,000.00
  Balance:       ₦295,000.00

GRAND TOTAL:    ₦295,000.00
─────────────────────────
═══════════════════════════════════════════
```

---

## 5. SERVICES & INFRASTRUCTURE INVOLVED

### Backend Services

#### ReportGenerator (`src/modules/sales-reporting/reporting/ReportGenerator.ts`)
- **Main Entry:** `generateReport(airline, files, createdBy)`
- **Output:** `GeneratedReportSummary` (includes reportId, reportText, confidence score)
- **Side Effects:** Creates SalesReport + related records in Prisma

#### RuleEngine (`src/modules/sales-reporting/rules/RuleEngine.ts`)
- **Core Logic:** Classifies transactions per airline
- **Output:** `RuleEngineResult` with classified transactions + staff totals
- **Stateless:** Can be called multiple times without side effects

#### StaffAliasRepository (`src/modules/sales-reporting/staff/StaffAliasRepository.ts`)
- **Purpose:** Map raw user codes to display names
- **Usage:** Seeded on first report generation, learns new mappings from confirmations
- **Learnable:** Staff corrections during verification are persisted to DB

#### ConfidenceScorer (`src/modules/sales-reporting/reporting/ConfidenceScorer.ts`)
- **Purpose:** Calculates confidence % for entire report
- **Factors:** Unknown staff, parsing warnings, transaction status distribution
- **Threshold:** < 90% triggers "Needs Review" flag

### Database Models

#### SalesReport (Core)
```prisma
model SalesReport {
  id              String            @id @default(cuid())
  airline         AirlineKey        // which airline this report is for
  reportDate      String            // "DD/MM/YYYY" as it appeared in file
  grandTotal      Decimal           // sum of all included transactions
  confidence      Float             // 0-1, used to flag for review
  reportText      String            // exact rendered text (never regenerated)
  sourceFiles     Json              // array of { name, url, kind: "EXCEL" | "SCREENSHOT" }
  rulesVersion    String            // "v1", for backward compatibility
  createdBy       String?           // user who uploaded
  verifiedBy      String?           // user who confirmed save
  status          SalesReportStatus // PENDING_VERIFICATION or SAVED
  createdAt       DateTime
  verifiedAt      DateTime?

  staffSales      StaffSales[]      // per-staff totals
  transactions    SalesTransaction[] // all parsed rows (included & ignored)
  tickets         SalesTicket[]     // denormalized PT rows (for analytics)
}
```

#### StaffSales (Summary)
```prisma
model StaffSales {
  id               String  // per-staff subtotal for one report
  reportId         String  // links to SalesReport
  staffName        String  // resolved display name (e.g., "FLORENCE")
  amount           Decimal // total for this staff
  transactionCount Int     // how many transactions
}
```

#### SalesTransaction (Audit)
```prisma
model SalesTransaction {
  id           String  // every parsed row, included or not
  reportId     String
  staffName    String  // resolved name
  amount       Decimal
  paymentType  String  // "PT", "PM", "CL", "RT"
  mcoReference String?
  pnr          String?
  user         String  // raw code before alias
  rawRecord    String  // verbatim source line
  status       String  // "INCLUDED", "IGNORED_PM", etc.
}
```

#### SalesTicket (Analytics)
```prisma
model SalesTicket {
  id               String
  reportId         String
  airline          AirlineKey
  date             String        // "DD/MM/YYYY"
  staff            String
  pnr              String?
  mcoReference     String?
  ticketValue      Decimal
  paymentType      String
  status           String
  included         Boolean       // was this counted in the report?
  reasonIfExcluded String?
  createdAt        DateTime

  // @@index on airline + date (for date range queries)
  // @@index on staff (for staff performance)
}
```

---

## 6. API ENDPOINTS

### Generate Report
```
POST /api/sales-reports/generate
Content-Type: multipart/form-data

Fields:
  - airline: string (AERO | AIRPEACE | IBOM | ARIK)
  - files: File[] (one or more .xls/.xlsx or images)
  - createdBy?: string

Response:
  {
    reportId: string;
    airline: string;
    reportDate: string; // "DD/MM/YYYY"
    reportText: string; // full report
    grandTotal: number;
    confidence: number; // 0-1
    needsReview: boolean; // true if < 90%
    confidenceReasons: string[];
    staffTotals: { staffName, amount, transactionCount }[];
    ticketCount: number;
    transactionsIncludedCount: number;
    transactionsIgnoredCount: number;
    unknownStaff: string[]; // staff codes not yet learned
    warnings: string[];
  }
```

### Confirm Report (Save)
```
POST /api/sales-reports/{id}/confirm
Content-Type: application/json

Body:
  {
    verifiedBy?: string; // user who confirmed
    staffCorrections?: Record<string, string>; // rawCode -> displayName
  }

Response: Same as GeneratedReportSummary + confirmation timestamp
```

### Discard Report
```
POST /api/sales-reports/{id}/discard
Response: { success: true }
```

---

## 7. EXISTING AI/CHATBOT INTEGRATION

### ChatBubble Component (`src/components/layout/ChatBubble.tsx`)

**Current Capabilities:**
- Flight search queries (primary purpose)
- Book-on-hold automation with Playwright
- Sales report file upload detection (lines 57-62)

**Sales Report Support (Partially Implemented):**
```typescript
function detectAttachmentKind(file: File): "excel" | "image" | "other" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "excel";
  if (file.type.startsWith("image/")) return "image";
  return "other";
}
```

**State Management for Reports:**
```typescript
const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
const [generatingReport, setGeneratingReport] = useState<boolean>(false);
const [reportBusy, setReportBusy] = useState<Record<number, "saving" | "discarding">>({}); 

// Message type includes:
interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  salesReport?: { reportId: string; status: "pending" | "saved" | "discarded" };
  // ... other fields
}
```

**Limitation:** The chatbot can detect Excel file attachments, but there's **no logic to call the `/api/sales-reports/generate` endpoint**. This is a gap to fill.

### Notification System (`src/lib/notifications`)
- ChatSession model tracks conversations
- AppNotification model stores alerts
- Already has infrastructure for `BOOKING_CREATED`, `QUOTE_GENERATED`, etc.
- Can easily extend for `SALES_REPORT_SAVED`, `SALES_REPORT_UPLOADED`, etc.

---

## 8. HOW REPORTS ARE STORED & QUERIED

### Storage
- **Primary:** PostgreSQL (Prisma ORM)
- **Tables:** SalesReport, StaffSales, SalesTransaction, SalesTicket
- **Audit:** Full transaction history preserved (never deleted)
- **Status:** PENDING_VERIFICATION (temporary) → SAVED (final, queryable)

### Current Querying

**In SalesReportsTab.tsx:**
- Display pending report for review
- Only SAVED reports are "real"

**No Dashboard Analytics Yet:**
- No weekly/monthly rollup queries
- No staff performance dashboards
- No date-range filtering

### Indexing Strategy (From Schema)
```prisma
@@index([airline, reportDate])      // Fast lookups by airline + date
@@index([staff])                    // Staff performance queries
@@index([airline, date])            // Analytics by date range
```

---

## 9. DUPLICATE REPORT HANDLING

### Current Implementation
**NONE.** The system allows duplicates.

**Current Behavior:**
- Same airline + same date = creates two separate reports
- Both are stored independently
- Both consume database space
- Dashboard would sum/double-count both

### Recommended Approach
1. Check if `(airline, reportDate)` tuple already exists in SAVED reports
2. If exists:
   - Display: "This report already exists from {verifiedAt}. Overwrite?"
   - If Yes: Mark old as "SUPERSEDED", create new
   - If No: Discard new
3. If not exists: Proceed to save

### IMPORTANT DESIGN DECISION
Should `reportDate` be checked as:
- Exact match (e.g., "24/07/2024" === "24/07/2024")?
- Date range (e.g., any report within 24 hours)?
- Airline-specific (e.g., check only against other Aero reports)?

**Current thinking:** Exact match on (airline, reportDate) is simplest, aligns with how reports are indexed.

---

## 10. CURRENT ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  ChatBubble      │  │  Admin Dashboard │                │
│  │  (Flight Search) │  │  (Sales Reports) │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                          │
│           └──────────┬───────────┘                          │
│                      │                                      │
└──────────────────────┼──────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  API Routes     │
              │  /api/sales-    │
              │   reports/*     │
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐
    │ Generate│   │ Confirm │   │ Discard │
    │ Report  │   │ Report  │   │ Report  │
    └────┬────┘   └────┬────┘   └────┬────┘
         │             │             │
         └─────────────┼─────────────┘
                       │
              ┌────────▼────────┐
              │  ReportGenerator│
              │  RuleEngine     │
              │  Parsers        │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   Prisma ORM    │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  PostgreSQL DB  │
              │  (SalesReport,  │
              │   SalesTicket)  │
              └─────────────────┘
```

---

## ROOT CAUSE ANALYSIS

### Problem 1: Rigid Workflow
**Root Cause:** UI is tightly coupled to admin-only, manual process  
**Impact:** No non-admin access, no chatbot integration, no self-service

### Problem 2: No Auto-Detection
**Root Cause:** Originally designed for trusted admin use (manual selection safe)  
**Impact:** Chatbot can't proceed without asking "which airline?"

### Problem 3: No Duplicate Handling
**Root Cause:** Not originally needed (low volume, ad-hoc usage)  
**Impact:** Analytics can be inflated, hard to audit

### Problem 4: No Analytics Visibility
**Root Cause:** Text-based report only, no denormalized data for dashboards  
**Impact:** SalesTicket table is created but never queried

---

## PROPOSED SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐ ┌─────────────┐│
│  │  ChatBubble      │  │  Sales Reports   │ │  Analytics  ││
│  │  (AI Assistant)  │  │  Dashboard       │ │  Dashboard  ││
│  │  - Upload        │  │  (New Page)      │ │  (New Page) ││
│  │  - Auto-airline  │  │  - History       │ │  - Charts   ││
│  │  - Queries       │  │  - Dupes         │ │  - Trends   ││
│  └────────┬─────────┘  └────────┬─────────┘ └──────┬──────┘│
│           │                      │                  │        │
│           └──────────┬───────────┴──────────────────┘        │
│                      │                                       │
└──────────────────────┼───────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  API Routes     │
              │  /api/sales-    │
              │   reports/*     │
              │  /api/analytics │
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Generate │  │ Confirm  │  │ Discard  │
    │ Report   │  │ Report   │  │ Report   │
    │ + Detect │  │ + Handle │  │          │
    │ Airline  │  │ Dupes    │  │          │
    └────┬─────┘  └────┬─────┘  └────┬─────┘
         │             │             │
         └─────────────┼─────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
    ┌─────────────┐       ┌──────────────────┐
    │ Report      │       │ Analytics Service│
    │ Generator   │       │ (New)            │
    │ + Auto-     │       │ - Date queries   │
    │  Detect     │       │ - Staff totals   │
    │ RuleEngine  │       │ - Trends         │
    │ Parsers     │       │ - Comparisons    │
    └────┬────────┘       └────────┬─────────┘
         │                         │
         └────────────┬────────────┘
                      │
            ┌─────────▼─────────┐
            │   Prisma ORM      │
            └─────────┬─────────┘
                      │
            ┌─────────▼─────────┐
            │  PostgreSQL DB    │
            │  (Enhanced)       │
            │  - SalesReport    │
            │  - SalesTicket    │
            │  - Analytics      │
            └───────────────────┘
```

---

## PROPOSED DATABASE CHANGES

### Additions

#### 1. SalesReportAnalytics (NEW)
```prisma
model SalesReportAnalytics {
  id                String   @id @default(cuid())
  reportId          String   @unique
  airline           AirlineKey
  reportDate        String
  
  // Totals
  totalTicketsIssued     Int
  totalTicketsVoided     Int
  totalVoidAmount        Decimal
  totalCreditAmount      Decimal
  totalDebitAmount       Decimal
  totalSalesAmount       Decimal
  totalCommission        Decimal
  netSales               Decimal
  
  // Airline-specific
  bspValues         Decimal?
  refundValues      Decimal?
  admValues         Decimal?
  
  // Metadata
  reportingPeriod   String?  // e.g., "2024-07-24"
  reportingPeriodStart String?
  reportingPeriodEnd   String?
  
  createdAt         DateTime @default(now())
  
  report SalesReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  
  @@index([airline, reportDate])
  @@map("sales_report_analytics")
}
```

#### 2. ReportDuplicateHistory (NEW)
```prisma
model ReportDuplicateHistory {
  id              String   @id @default(cuid())
  originalReportId String  // the "current" report
  supersededById   String? // if this one was replaced, which report replaced it
  airline         AirlineKey
  reportDate      String
  
  originalStatus  SalesReportStatus
  replacedAt      DateTime?
  replacedBy      String? // user who approved replacement
  
  createdAt       DateTime @default(now())
  
  @@index([airline, reportDate])
  @@map("report_duplicate_history")
}
```

### Modifications to Existing Models

#### SalesReport
Add fields to support new workflow:
```prisma
model SalesReport {
  // ... existing fields ...
  
  // New fields
  supersededById      String?      // if overwritten, which report replaced this
  supersededAt        DateTime?    // when it was overwritten
  supersededBy        String?      // who overwritten by
  airlineDetectedBy   String?      // "CHATBOT" | "MANUAL" | "AUTO_DETECT"
  detectionConfidence Float?       // 0-1, how sure was airline detection
  
  // Relationship
  analytics           SalesReportAnalytics?
}
```

---

## PROPOSED FILES TO MODIFY/CREATE

### New Files (24 total)

#### Frontend Components (8)
1. `src/components/sections/SalesReportsSection.tsx` - Main dashboard
2. `src/components/sections/AnalyticsDashboardSection.tsx` - Analytics dashboard
3. `src/components/sales-reports/ReportUploadCard.tsx` - Upload UI
4. `src/components/sales-reports/ReportHistoryTable.tsx` - History list
5. `src/components/sales-reports/DuplicateDialog.tsx` - Duplicate handling
6. `src/components/sales-reports/AnalyticsCharts.tsx` - Chart components
7. `src/components/sales-reports/DateRangeFilter.tsx` - Filter component
8. `src/components/sales-reports/StaffPerformanceCard.tsx` - Staff metrics

#### Backend Services (6)
1. `src/modules/sales-reporting/services/AirlineDetectionService.ts` - Auto-detect airline
2. `src/modules/sales-reporting/services/DuplicateCheckService.ts` - Handle dupes
3. `src/modules/sales-reporting/services/AnalyticsService.ts` - Query analytics
4. `src/modules/sales-reporting/services/ChatbotReportService.ts` - Chatbot integration
5. `src/modules/travel-assistant/orchestration/SalesReportAssistant.ts` - Chat logic
6. `src/modules/sales-reporting/storage/SalesReportRepository.ts` - Data access

#### API Routes (6)
1. `src/app/api/sales-reports/detect-airline/route.ts` - Auto-detection endpoint
2. `src/app/api/sales-reports/check-duplicate/route.ts` - Duplicate check
3. `src/app/api/sales-reports/history/route.ts` - Report history
4. `src/app/api/analytics/sales/route.ts` - Analytics queries
5. `src/app/api/analytics/staff/route.ts` - Staff performance
6. `src/app/api/analytics/trends/route.ts` - Trend analysis

#### Database (2)
1. `prisma/migrations/[timestamp]_add_sales_analytics.sql` - Analytics tables
2. `prisma/migrations/[timestamp]_add_report_tracking.sql` - Tracking fields

#### Types (1)
1. `src/modules/sales-reporting/types/analytics.ts` - New type definitions

#### Tests (1)
1. `src/modules/sales-reporting/__tests__/AirlineDetection.test.ts` - Unit tests

### Modified Files (8)

#### Frontend
1. `src/app/page.tsx` - Add "Sales Reports" to sidebar
2. `src/lib/constants.ts` - Add new section to SIDEBAR_SECTIONS
3. `src/components/layout/Sidebar.tsx` - No changes (supports dynamic sections)
4. `src/components/layout/ChatBubble.tsx` - Add sales report handling

#### Backend
5. `src/modules/sales-reporting/reporting/ReportGenerator.ts` - Add airline detection
6. `src/app/api/sales-reports/generate/route.ts` - Add duplicate check
7. `src/app/api/sales-reports/[id]/confirm/route.ts` - Add analytics creation
8. `prisma/schema.prisma` - Add new models & fields

---

## IMPLEMENTATION PHASES

### Phase 0: Database & Infrastructure (Week 1)
- [ ] Add new Prisma models
- [ ] Create migrations
- [ ] Deploy to staging

### Phase 1: Airline Auto-Detection (Week 1)
- [ ] Implement `AirlineDetectionService`
- [ ] Add detection endpoint
- [ ] Update ReportGenerator to use detection
- [ ] Chatbot integration ready

### Phase 2: Duplicate Handling (Week 1)
- [ ] Implement `DuplicateCheckService`
- [ ] Add check endpoint
- [ ] Update confirm flow to handle overwrites
- [ ] Track superseded reports

### Phase 3: Dedicated Dashboard (Week 2)
- [ ] Create SalesReportsSection component
- [ ] Add to sidebar + navigation
- [ ] Report history table
- [ ] Duplicate management UI
- [ ] Manual upload fallback

### Phase 4: Analytics Service (Week 2)
- [ ] Implement `AnalyticsService`
- [ ] Create analytics API endpoints
- [ ] Staff performance queries
- [ ] Date range queries
- [ ] Trend calculations

### Phase 5: Analytics Dashboard (Week 2)
- [ ] Create AnalyticsDashboardSection
- [ ] Chart components (Recharts)
- [ ] Date range filter
- [ ] Animated cards
- [ ] Performance metrics

### Phase 6: Chatbot Integration (Week 3)
- [ ] Enhance ChatBubble to handle file uploads
- [ ] Integrate airline detection
- [ ] Add "save" / "overwrite" confirmation flow
- [ ] Natural language query support
- [ ] Balance update query
- [ ] Weekly/monthly report generation

### Phase 7: Polish & Testing (Week 3)
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] Documentation
- [ ] Deployment checklist

---

## RISKS & MITIGATION

### Risk 1: Airline Detection Accuracy
**Risk:** Auto-detect fails, wrong airline selected  
**Impact:** Report saved under wrong airline  
**Mitigation:**
- Implement confidence scoring
- Show detection result to user before proceeding
- Allow override option
- Flag low-confidence (< 80%) for review

### Risk 2: Duplicate Report Inflation
**Risk:** System gets spammed with duplicate daily reports  
**Impact:** Analytics inflated, audit trail unclear  
**Mitigation:**
- Implement exact (airline, date) deduplication
- Force explicit "overwrite" confirmation
- Track supersession history
- Alert on unusual spike

### Risk 3: Chatbot Confusion
**Risk:** User uploads sales report to chatbot expecting flight search  
**Impact:** User frustrated, report not processed  
**Mitigation:**
- Clear message when Excel detected ("Looks like a sales report…")
- Airline confirmation step
- Ability to "cancel" and go back to flight search

### Risk 4: Analytics Performance
**Risk:** Large date ranges (1+ year) slow down queries  
**Impact:** Dashboard hangs on load  
**Mitigation:**
- Proper indexing on (airline, date)
- Materialized views for common ranges
- Pagination on history table
- Pre-calculated weekly/monthly summaries

### Risk 5: Data Loss on Migration
**Risk:** Old PENDING_VERIFICATION reports lost during schema migration  
**Impact:** Audit trail broken  
**Mitigation:**
- Pre-migration backup
- Test migration on staging with production data
- Archive old PENDING_VERIFICATION reports to JSON
- Verify row count before/after

---

## TEST STRATEGY

### Unit Tests
- [ ] AirlineDetectionService (happy path + edge cases)
- [ ] DuplicateCheckService (exact match + edge cases)
- [ ] AnalyticsService queries (date ranges, staff totals)
- [ ] StaffAliasRepository learnings

### Integration Tests
- [ ] End-to-end: Upload → Detect → Confirm → Analytics
- [ ] Duplicate detection and overwrite flow
- [ ] Chatbot message handling for sales reports
- [ ] Staff correction persistence

### E2E Tests (Playwright)
- [ ] Admin uploads Excel → sees report → saves
- [ ] Chatbot user uploads Excel → airline detected → saved
- [ ] Duplicate report → overwrite dialog → saved
- [ ] Analytics dashboard loads → filters work
- [ ] Natural language queries ("Show me this week's sales")

### Performance Tests
- [ ] Load test with 1 year of daily reports (365+ records)
- [ ] Analytics query on large date range (< 500ms)
- [ ] Chatbot upload handling (< 2s response)
- [ ] Dashboard chart rendering (< 1s)

### Staging Validation
- [ ] Production data anonymization + load
- [ ] Migration dry-run on production snapshot
- [ ] Chatbot queried with real flight + report requests
- [ ] Admin user tests new workflows

---

## DEPLOYMENT CHECKLIST

- [ ] Database migration verified
- [ ] Prisma client regenerated
- [ ] Environment variables configured
- [ ] Chatbot endpoints tested
- [ ] Analytics queries validated
- [ ] Old admin flow still works (backward compat)
- [ ] Rollback plan tested
- [ ] Monitoring/alerting set up
- [ ] Runbook documentation written

---

## BACKWARD COMPATIBILITY

### What Stays the Same
- `/api/sales-reports/generate` endpoint signature
- ReportGenerator core logic
- Rule engines for all airlines
- SalesReport + StaffSales + SalesTransaction models
- Admin manual upload flow (can still access)

### What Changes
- New optional fields on SalesReport (detection, supersededById, etc.)
- New endpoints (not breaking old ones)
- Sidebar navigation (adds new section)
- ChatBubble component (new feature, not breaking)

### Rollback Strategy
1. Revert Prisma migrations
2. Remove new API routes (old routes still work)
3. Remove new sidebar section
4. Redeploy previous version
5. No data loss (old tables preserved)

---

## RECOMMENDATION FOR APPROVAL

✅ **Go ahead with Phase 1-7 implementation.**

**Rationale:**
1. Infrastructure already exists—we're not rebuilding, just surfacing differently
2. Chatbot already has file-upload detection (lines 57-62 in ChatBubble.tsx)
3. Database schema is ready (SalesTicket denormalized for analytics)
4. Minimal breaking changes
5. High impact on UX (hidden admin feature → visible to all users)
6. Revenue impact: better reporting = better decision-making

**Timeline:** 3 weeks (one sprint)  
**Risk Level:** Medium (deduplication logic, airline detection)  
**Effort:** ~120 developer hours

---

## NEXT STEPS

**Awaiting your approval on:**

1. ✓ Is the proposed architecture sound?
2. ✓ Should airline detection be required, or user-confirmable?
3. ✓ Duplicate policy: exact match (airline+date) or fuzzy (within 24h)?
4. ✓ Analytics: which metrics are MVP vs. nice-to-have?
5. ✓ Chatbot: natural language support (GPT-powered) or structured queries?

Once approved, we'll proceed with detailed implementation plans for each phase.

---

**Investigation Completed By:** Claude  
**Date:** July 24, 2026  
**Confidence:** High (codebase fully analyzed)
