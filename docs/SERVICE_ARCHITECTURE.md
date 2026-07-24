# Service Architecture Specification

**Version:** 1.0  
**Status:** FINAL  
**Last Updated:** July 25, 2026

---

## Overview

Complete design of core services for Sales Report Modernization. Each service is modular, reusable, and testable.

---

## 1. AirlineDetectionService

**File:** `src/modules/sales-reporting/services/AirlineDetectionService.ts`

**Responsibility:** Intelligently detect which airline a report belongs to.

### Public Interface

```typescript
interface DetectionResult {
  airline: AirlineRuleKey | null;
  confidence: number;                    // 0-1
  method: "CONTENT" | "FORMAT" | "METADATA" | "VISION" | "UNKNOWN";
  reasoning: string[];                   // Why this decision was made
  requiresConfirmation?: boolean;        // true if 70-89% (show prompt)
  requiresUserSelection?: boolean;       // true if <70% (ask user)
  alternativeMatches?: {
    airline: AirlineRuleKey;
    confidence: number;
  }[];
}

class AirlineDetectionService {
  /**
   * Main entry point - detects airline from multiple sources
   */
  static async detect(
    buffer: Buffer,
    filename?: string,
    userHint?: string
  ): Promise<DetectionResult>
}
```

### Detection Strategy

**Priority 1: Content Analysis (Highest Priority)**
- Parse first 20 rows of Excel
- Look for airline name keywords
- Case-insensitive matching
- Examples: "Air Peace", "Aero", "Ibom", "Arik"
- **Confidence:** 90-95% if exact match

```typescript
private static detectByContent(buffer: Buffer): DetectionResult {
  const matrix = parseExcel(buffer);
  const text = matrix.slice(0, 20).flat().map(String).join(' ').toLowerCase();
  
  const keywords = {
    AIRPEACE: ['air peace', 'airpeace', 'peace'],
    AERO: ['aero', 'aeronlg'],
    IBOM: ['ibom', 'ibom air'],
    ARIK: ['arik', 'arik air']
  };
  
  for (const [airline, patterns] of Object.entries(keywords)) {
    if (patterns.some(p => text.includes(p))) {
      return {
        airline: airline as AirlineRuleKey,
        confidence: 0.93,
        method: 'CONTENT',
        reasoning: [`Airline name "${airline}" found in report content`]
      };
    }
  }
  
  return null; // Try next method
}
```

**Priority 2: Format Detection**
- Analyze header row patterns
- Each airline has distinctive columns
- Example: Aero has specific header layout
- **Confidence:** 80-85% if format matches

```typescript
private static detectByFormat(buffer: Buffer): DetectionResult {
  const headers = extractHeaders(buffer);
  const headerStr = headers.map(h => h.toLowerCase()).join('|');
  
  // Format patterns for each airline
  const patterns = {
    AIRPEACE: /payment date|payment type|debit|credit/i,
    AERO: /revenue date|tran type|debit|credit|balance/i,
    IBOM: /payment date|pt|pm|debit|credit/i,
    ARIK: /date|type|debit|credit|user/i
  };
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [airline, pattern] of Object.entries(patterns)) {
    const matches = (headerStr.match(pattern) || []).length;
    if (matches > bestScore) {
      bestMatch = airline;
      bestScore = matches;
    }
  }
  
  if (bestMatch && bestScore >= 3) {
    return {
      airline: bestMatch as AirlineRuleKey,
      confidence: 0.82,
      method: 'FORMAT',
      reasoning: [`Report headers match ${bestMatch} format pattern`]
    };
  }
  
  return null;
}
```

**Priority 3: Metadata Detection**
- Parse filename for airline keywords
- Examples: "Aero_Daily_2024-07-24.xlsx"
- **Confidence:** 70-75% if match found

```typescript
private static detectByMetadata(filename: string): DetectionResult {
  const name = filename.toLowerCase();
  
  const keywords = {
    AIRPEACE: ['airpeace', 'air_peace', 'peace'],
    AERO: ['aero'],
    IBOM: ['ibom'],
    ARIK: ['arik']
  };
  
  for (const [airline, patterns] of Object.entries(keywords)) {
    if (patterns.some(p => name.includes(p))) {
      return {
        airline: airline as AirlineRuleKey,
        confidence: 0.72,
        method: 'METADATA',
        reasoning: [`Airline name "${airline}" found in filename`]
      };
    }
  }
  
  return null;
}
```

**Priority 4: Vision Fallback**
- Use Claude Vision API as last resort
- Analyze Excel screenshot
- Ask model: "What airline is this report for?"
- **Confidence:** Varies (50-85%)

```typescript
private static async detectByVision(buffer: Buffer): Promise<DetectionResult> {
  const base64 = buffer.toString('base64');
  
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: base64 }
        },
        {
          type: 'text',
          text: 'Which airline is this sales report for? Answer with just the airline name: Air Peace, Aero, Ibom, or Arik.'
        }
      ]
    }]
  });
  
  const text = response.content[0].type === 'text' 
    ? response.content[0].text.toLowerCase() 
    : '';
  
  const airlineMap = {
    'air peace': 'AIRPEACE',
    'aero': 'AERO',
    'ibom': 'IBOM',
    'arik': 'ARIK'
  };
  
  for (const [keyword, airline] of Object.entries(airlineMap)) {
    if (text.includes(keyword)) {
      return {
        airline: airline as AirlineRuleKey,
        confidence: 0.78,
        method: 'VISION',
        reasoning: [`Vision model identified airline as "${airline}"`]
      };
    }
  }
  
  return null;
}
```

### Main Detection Logic

```typescript
static async detect(
  buffer: Buffer,
  filename?: string,
  userHint?: string
): Promise<DetectionResult> {
  const results = [];
  
  // Try each method in priority order
  const contentResult = this.detectByContent(buffer);
  if (contentResult?.confidence >= 0.70) {
    results.push(contentResult);
  }
  
  if (results.length === 0) {
    const formatResult = this.detectByFormat(buffer);
    if (formatResult?.confidence >= 0.70) {
      results.push(formatResult);
    }
  }
  
  if (results.length === 0 && filename) {
    const metadataResult = this.detectByMetadata(filename);
    if (metadataResult?.confidence >= 0.70) {
      results.push(metadataResult);
    }
  }
  
  if (results.length === 0) {
    const visionResult = await this.detectByVision(buffer);
    if (visionResult?.confidence >= 0.70) {
      results.push(visionResult);
    }
  }
  
  if (results.length === 0) {
    return {
      airline: null,
      confidence: 0,
      method: 'UNKNOWN',
      reasoning: ['Could not detect airline from any source'],
      requiresUserSelection: true
    };
  }
  
  // Take best result
  const best = results.sort((a, b) => b.confidence - a.confidence)[0];
  
  return {
    ...best,
    requiresConfirmation: best.confidence < 0.90 && best.confidence >= 0.70,
    requiresUserSelection: best.confidence < 0.70,
    alternativeMatches: results.slice(1).slice(0, 2)  // Top 2 alternatives
  };
}
```

### Confidence Tiers

| Confidence | Action | UX |
|-----------|--------|-----|
| ≥ 90% | Auto-proceed | No prompt |
| 70-89% | Show prompt | "I believe this is {airline} (85% confidence). Continue?" |
| < 70% | Ask user | "Which airline? [Dropdown]" |

---

## 2. DuplicateCheckService

**File:** `src/modules/sales-reporting/services/DuplicateCheckService.ts`

**Responsibility:** Detect duplicate reports and prevent double-counting.

### Public Interface

```typescript
interface DuplicateMatch {
  matchScore: number;                   // 0-1
  existingReport: {
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
  matchFactors: {
    airline: boolean;                   // Must match
    date: boolean;                      // Must match
    bspPeriod?: boolean;                // If available
    salesAmount: number;                // 0-1 similarity
    ticketCount: boolean;               // Must match
    fileHash?: boolean;                 // If available
  };
}

class DuplicateCheckService {
  /**
   * Check if a report already exists
   */
  static async checkDuplicate(
    airline: AirlineRuleKey,
    reportDate: string,                 // "DD/MM/YYYY"
    totalSales: number,
    ticketCount: number,
    fileHash?: string,
    bspPeriod?: string
  ): Promise<DuplicateMatch | null>
}
```

### Matching Algorithm

```typescript
static async checkDuplicate(
  airline: AirlineRuleKey,
  reportDate: string,
  totalSales: number,
  ticketCount: number,
  fileHash?: string,
  bspPeriod?: string
): Promise<DuplicateMatch | null> {
  // Query for existing SAVED reports on same date/airline
  const existing = await prisma.salesReport.findFirst({
    where: {
      airline,
      reportDate,
      status: 'SAVED'
    },
    include: {
      analytics: true
    }
  });
  
  if (!existing) {
    return null;  // No duplicate found
  }
  
  // Calculate match factors
  const matchFactors = {
    airline: existing.airline === airline,         // 100%
    date: existing.reportDate === reportDate,      // 100%
    bspPeriod: bspPeriod ? (existing.bspPeriod === bspPeriod) : undefined,
    salesAmount: this.calculateSimilarity(
      totalSales,
      Number(existing.analytics?.grossSalesAmount || existing.grandTotal),
      0.02  // ±2% tolerance
    ),
    ticketCount: existing.analytics?.totalTicketsIssued === ticketCount,
    fileHash: fileHash && existing.fileHash === fileHash
  };
  
  // Calculate composite score
  const score = this.calculateMatchScore(matchFactors);
  
  if (score < 0.80) {
    return null;  // Not similar enough
  }
  
  return {
    matchScore: score,
    existingReport: {
      id: existing.id,
      date: existing.reportDate,
      airline: existing.airline,
      totals: {
        sales: Number(existing.grandTotal),
        tickets: existing.analytics?.totalTicketsIssued || 0,
        voids: existing.analytics?.totalTicketsVoided || 0
      },
      savedAt: existing.verifiedAt?.toISOString() || existing.createdAt.toISOString()
    },
    matchFactors
  };
}

private static calculateSimilarity(
  val1: number,
  val2: number,
  tolerance: number  // 0.02 = ±2%
): number {
  const diff = Math.abs(val1 - val2);
  const avg = (Math.abs(val1) + Math.abs(val2)) / 2;
  const percentDiff = diff / avg;
  
  if (percentDiff <= tolerance) {
    return 1.0;  // Exact match within tolerance
  }
  
  if (percentDiff <= tolerance * 3) {
    return 0.8;  // Similar
  }
  
  return Math.max(0, 1 - percentDiff);  // Score decreases with difference
}

private static calculateMatchScore(factors: MatchFactors): number {
  let score = 0;
  let weights = 0;
  
  // Each factor weighted
  if (factors.airline) { score += 1.0 * 0.25; weights += 0.25; }  // 25% weight
  if (factors.date) { score += 1.0 * 0.25; weights += 0.25; }     // 25% weight
  score += factors.salesAmount * 0.30; weights += 0.30;           // 30% weight
  if (factors.ticketCount) { score += 1.0 * 0.15; weights += 0.15; }  // 15% weight
  if (factors.fileHash) { score += 1.0 * 0.05; weights += 0.05; }  // 5% weight
  
  return weights > 0 ? score / weights : 0;
}
```

### Matching Criteria

**Must Match (100%):**
- Airline (exact)
- Report Date (exact)

**Should Match:**
- Sales Amount (within ±2%)
- Ticket Count (exact)

**Optional:**
- BSP Period (if available)
- File Hash (for byte-for-byte identical)

**Result:**
- Score ≥ 0.95: Definite duplicate → Show dialog
- Score 0.80-0.95: Likely duplicate → Show dialog
- Score < 0.80: Not a duplicate → Proceed

---

## 3. AnalyticsService

**File:** `src/modules/sales-reporting/services/AnalyticsService.ts`

**Responsibility:** Query analytics data for dashboards and chatbot.

### Public Interface

```typescript
class AnalyticsService {
  // Executive KPIs
  static async getExecutiveSummary(
    dateFrom: string,
    dateTo: string,
    airlines?: AirlineRuleKey[]
  ): Promise<ExecutiveKPIs>
  
  // Airline performance
  static async getAirlineMetrics(
    dateFrom: string,
    dateTo: string,
    sortBy?: "sales" | "tickets" | "growth"
  ): Promise<AirlineMetric[]>
  
  // Staff performance
  static async getStaffMetrics(
    dateFrom: string,
    dateTo: string,
    airline?: AirlineRuleKey,
    sortBy?: "sales" | "tickets" | "commission"
  ): Promise<StaffMetric[]>
  
  // Trend data
  static async getTrendData(
    dateFrom: string,
    dateTo: string,
    granularity: "daily" | "weekly" | "monthly"
  ): Promise<TrendPoint[]>
  
  // Comparisons
  static async compareWithPreviousPeriod(
    dateFrom: string,
    dateTo: string
  ): Promise<ComparisonMetrics>
}
```

### Executive Summary Query

```typescript
static async getExecutiveSummary(
  dateFrom: string,
  dateTo: string,
  airlines?: AirlineRuleKey[]
): Promise<ExecutiveKPIs> {
  // Fast query using pre-calculated analytics
  const analytics = await prisma.salesReportAnalytics.aggregate({
    where: {
      airline: airlines ? { in: airlines } : undefined,
      reportDate: {
        gte: convertToDbDate(dateFrom),
        lte: convertToDbDate(dateTo)
      }
    },
    _sum: {
      totalTicketsIssued: true,
      totalTicketsVoided: true,
      totalVoidAmount: true,
      totalCreditAmount: true,
      totalDebitAmount: true,
      grossSalesAmount: true,
      netSalesAmount: true,
      totalCommission: true
    },
    _count: true
  });
  
  return {
    period: { from: dateFrom, to: dateTo },
    metrics: {
      totalSales: analytics._sum.grossSalesAmount || 0,
      totalTickets: analytics._sum.totalTicketsIssued || 0,
      totalVoids: analytics._sum.totalTicketsVoided || 0,
      totalVoidAmount: analytics._sum.totalVoidAmount || 0,
      totalCreditAmount: analytics._sum.totalCreditAmount || 0,
      totalDebitAmount: analytics._sum.totalDebitAmount || 0,
      netSales: analytics._sum.netSalesAmount || 0,
      totalCommission: analytics._sum.totalCommission || 0
    },
    reportCount: analytics._count
  };
}
```

### Airline Metrics Query

```typescript
static async getAirlineMetrics(
  dateFrom: string,
  dateTo: string,
  sortBy = "sales"
): Promise<AirlineMetric[]> {
  // Group by airline using pre-calculated daily metrics
  const metrics = await prisma.airlineDailyMetrics.groupBy({
    by: ['airline'],
    where: {
      date: {
        gte: convertToDbDate(dateFrom),
        lte: convertToDbDate(dateTo)
      }
    },
    _sum: {
      totalSales: true,
      totalTickets: true,
      totalVoids: true,
      netSales: true
    },
    orderBy: (() => {
      switch (sortBy) {
        case "sales": return { _sum: { totalSales: 'desc' } };
        case "tickets": return { _sum: { totalTickets: 'desc' } };
        default: return { _sum: { totalSales: 'desc' } };
      }
    })()
  });
  
  return metrics.map((m, idx) => ({
    rank: idx + 1,
    airline: m.airline,
    sales: m._sum.totalSales || 0,
    tickets: m._sum.totalTickets || 0,
    voids: m._sum.totalVoids || 0,
    netSales: m._sum.netSales || 0
  }));
}
```

### Trend Data Query

```typescript
static async getTrendData(
  dateFrom: string,
  dateTo: string,
  granularity: "daily" | "weekly" | "monthly"
): Promise<TrendPoint[]> {
  const data = await prisma.airlineDailyMetrics.findMany({
    where: {
      date: {
        gte: convertToDbDate(dateFrom),
        lte: convertToDbDate(dateTo)
      }
    },
    select: {
      date: true,
      totalSales: true,
      totalTickets: true,
      netSales: true
    },
    orderBy: { date: 'asc' }
  });
  
  if (granularity === 'daily') {
    return data.map(d => ({
      date: d.date,
      sales: d.totalSales,
      tickets: d.totalTickets,
      netSales: d.netSales
    }));
  }
  
  // Weekly/monthly aggregation
  const grouped = this.groupByPeriod(data, granularity);
  
  return grouped.map((group, idx) => ({
    date: group.periodLabel,
    sales: group.totalSales,
    tickets: group.totalTickets,
    netSales: group.netSales
  }));
}
```

---

## 4. SalesReportAssistant

**File:** `src/modules/travel-assistant/orchestration/SalesReportAssistant.ts`

**Responsibility:** Handle chatbot sales report interactions (upload, queries).

### Public Interface

```typescript
interface IntentResult {
  intent: SalesReportIntent;
  parameters: IntentParameters;
  confidence: number;
}

class SalesReportAssistant {
  /**
   * Extract intent from user message
   */
  static async extractIntent(
    message: string,
    sessionContext?: SessionContext
  ): Promise<IntentResult>
  
  /**
   * Handle file upload in chatbot context
   */
  static async handleFileUpload(
    file: File,
    sessionContext?: SessionContext
  ): Promise<UploadResponse>
  
  /**
   * Handle query in chatbot context
   */
  static async handleQuery(
    message: string,
    sessionContext?: SessionContext
  ): Promise<QueryResponse>
}
```

### Intent Extraction

```typescript
static async extractIntent(
  message: string,
  sessionContext?: SessionContext
): Promise<IntentResult> {
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 500,
    system: `You are a sales report assistant. Extract the user's intent from their message.

Return JSON:
{
  "intent": "UPLOAD_REPORT" | "SHOW_SALES_SUMMARY" | "SHOW_STAFF_PERFORMANCE" | "SHOW_BALANCE" | "SHOW_TRENDS" | "CONFIRM_DUPLICATE" | "CANCEL_UPLOAD",
  "parameters": {
    "timeExpression": "today" | "yesterday" | "this week" | "last week" | "this month" | "last month" | null,
    "airline": "AIRPEACE" | "AERO" | "IBOM" | "ARIK" | null,
    "staffName": "person name" | null,
    "metric": "sales" | "tickets" | "revenue" | "voids" | "commission" | null
  },
  "confidence": 0.95
}`,
    messages: [{
      role: 'user',
      content: message
    }]
  });
  
  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  
  const result = JSON.parse(content.text);
  
  // Override with session context if available
  if (!result.parameters.airline && sessionContext?.lastAirline) {
    result.parameters.airline = sessionContext.lastAirline;
  }
  
  return result;
}
```

### Response Formatting

```typescript
static formatResponse(
  intent: SalesReportIntent,
  data: any,
  context?: SessionContext
): string {
  switch (intent) {
    case 'SHOW_SALES_SUMMARY':
      return `
📊 Sales Summary - ${data.period.to}
━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 Total Sales: ₦${data.totals.sales.toLocaleString()}
🎫 Tickets Issued: ${data.totals.tickets}
🚫 Tickets Voided: ${data.totals.voids}
❌ Void Amount: ₦${data.totals.voidAmount.toLocaleString()}
📈 Net Sales: ₦${data.totals.netSales.toLocaleString()}

${data.comparison ? `📊 Trend vs ${data.comparison.period}: ${data.comparison.growth > 0 ? '📈 +' : '📉 '}${Math.abs(data.comparison.growth)}%` : ''}
      `.trim();
    
    case 'SHOW_BALANCE':
      return `
💰 Airline Balances
━━━━━━━━━━━━━━━━━

${data.balances.map(b => `${b.airline}: ₦${b.balance.toLocaleString()}`).join('\n')}

Last Updated: ${data.lastUpdated}
      `.trim();
    
    default:
      return JSON.stringify(data, null, 2);
  }
}
```

---

## Service Integration

### How Services Work Together

```
User uploads report
  ↓
ReportGenerator calls:
  1. AirlineDetectionService.detect()        → Determine airline + confidence
  2. DuplicateCheckService.checkDuplicate()  → Check if exists
  3. Store report + create SalesReportAnalytics
  4. Update StaffDailyPerformance + AirlineDailyMetrics
  ↓
Dashboard queries:
  AnalyticsService.getExecutiveSummary()     → Pre-calculated KPIs
  AnalyticsService.getAirlineMetrics()       → Pre-aggregated totals
  AnalyticsService.getTrendData()            → Pre-calculated trends
  ↓
Chatbot processes:
  1. SalesReportAssistant.extractIntent()    → Understand user's request
  2. Call appropriate AnalyticsService method → Get data
  3. Format response naturally               → Return to user
```

### Performance Strategy

1. **Denormalization:** Pre-calculate metrics in analytics tables
2. **Caching:** Cache common queries (5-minute TTL)
3. **Indexing:** Indexes on all query columns
4. **Lazy-loading:** Only fetch detailed data when requested
5. **Async:** Process large files asynchronously

---

## Error Handling

Each service has consistent error handling:

```typescript
try {
  // Service logic
} catch (error) {
  logger.error('ServiceName', error);
  
  if (error instanceof ValidationError) {
    throw new BadRequestError(error.message);
  }
  
  if (error instanceof NotFoundError) {
    throw new NotFoundError('Resource not found');
  }
  
  throw new InternalServerError('Service failed');
}
```

---

## Testing Strategy

Each service has 95%+ test coverage:

```typescript
describe('AirlineDetectionService', () => {
  it('detects airline from content', () => { /* ... */ });
  it('detects airline from format', () => { /* ... */ });
  it('handles confidence tiers correctly', () => { /* ... */ });
  it('requires confirmation at 70-89%', () => { /* ... */ });
  it('requires user selection below 70%', () => { /* ... */ });
});

describe('DuplicateCheckService', () => {
  it('detects exact duplicates', () => { /* ... */ });
  it('calculates similarity correctly', () => { /* ... */ });
  it('handles missing fields gracefully', () => { /* ... */ });
});

describe('AnalyticsService', () => {
  it('returns correct KPI totals', () => { /* ... */ });
  it('filters by date range correctly', () => { /* ... */ });
  it('performs under 500ms', () => { /* ... */ });
});
```

---

**Status:** READY FOR IMPLEMENTATION

**Next Step:** Phase 1 - Database Migration

---

*End of Service Architecture*
