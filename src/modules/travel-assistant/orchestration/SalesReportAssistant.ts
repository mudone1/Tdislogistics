import { groqJsonCompletion, type GroqMessage } from "../ai/groqClient";
import { AirlineAIService } from "../../airline-connectors/services/AirlineAIService";
import * as AnalyticsService from "../../sales-reporting/services/AnalyticsService";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "../../sales-reporting/core/types";
import type { AirlineKey } from "../../airline-connectors/core/types";

export type SalesReportIntent =
  | "SHOW_SALES_SUMMARY"
  | "SHOW_AIRLINE_PERFORMANCE"
  | "SHOW_STAFF_PERFORMANCE"
  | "SHOW_TRENDS"
  | "SHOW_COMPARISON"
  | "SHOW_BALANCE"
  | "UNKNOWN";

export interface SalesReportIntentParameters {
  timeExpression: string | null; // "today" | "yesterday" | "this week" | "last week" | "this month" | "last month" | "this year" | null
  dateFrom: string | null; // "DD/MM/YYYY" — only set when the user gave an explicit date/range
  dateTo: string | null;
  airline: AirlineRuleKey | null;
  staffName: string | null;
  metric: "sales" | "tickets" | "voids" | "commission" | null;
}

export interface SalesReportIntentResult {
  intent: SalesReportIntent;
  parameters: SalesReportIntentParameters;
  confidence: number;
}

export interface SessionContext {
  lastAirline?: AirlineRuleKey | null;
}

export interface SalesReportQueryResponse {
  reply: string;
  intent: SalesReportIntent;
  data?: unknown;
}

const INTENT_SYSTEM_PROMPT = `You classify a staff member's question about sales reports/analytics for a Nigerian airline ticketing agency (TDIS). Airlines covered: AIRPEACE, AERO, IBOM, ARIK, UNITED, RANO, ENUGU, XEJET.

Return ONLY JSON of the form:
{
  "intent": "SHOW_SALES_SUMMARY" | "SHOW_AIRLINE_PERFORMANCE" | "SHOW_STAFF_PERFORMANCE" | "SHOW_TRENDS" | "SHOW_COMPARISON" | "SHOW_BALANCE" | "UNKNOWN",
  "parameters": {
    "timeExpression": "today" | "yesterday" | "this week" | "last week" | "this month" | "last month" | "this year" | null,
    "dateFrom": "DD/MM/YYYY" | null,
    "dateTo": "DD/MM/YYYY" | null,
    "airline": "AIRPEACE" | "AERO" | "IBOM" | "ARIK" | "UNITED" | "RANO" | "ENUGU" | "XEJET" | null,
    "staffName": "name mentioned, verbatim" | null,
    "metric": "sales" | "tickets" | "voids" | "commission" | null
  },
  "confidence": 0-1
}

Intent guide:
- SHOW_SALES_SUMMARY: overall totals/KPIs ("how much did we make today", "total sales this week")
- SHOW_AIRLINE_PERFORMANCE: ranking/comparing airlines against each other ("which airline sold the most", "compare AERO and ARIK")
- SHOW_STAFF_PERFORMANCE: a specific staff member's numbers, or ranking staff ("how much did Florence sell", "top staff this month")
- SHOW_TRENDS: change over time / a breakdown by day/week/month ("show me the trend for July", "daily sales this month")
- SHOW_COMPARISON: this period vs the immediately preceding one ("how does this week compare to last week", "are we growing")
- SHOW_BALANCE: airline wallet/account balance, NOT sales figures ("what's Aero's balance", "show all balances")
- UNKNOWN: anything not about sales reports/analytics at all (flight search, booking, greetings, etc.)

Only fill "dateFrom"/"dateTo" when the user gave an explicit date or range. Prefer "timeExpression" for relative phrases like "today"/"this week" — the caller resolves those to actual dates.`;

export async function extractIntent(message: string, sessionContext?: SessionContext): Promise<SalesReportIntentResult> {
  const messages: GroqMessage[] = [
    { role: "system", content: INTENT_SYSTEM_PROMPT },
    { role: "user", content: message },
  ];

  const raw = await groqJsonCompletion(messages);
  const parsed = JSON.parse(raw) as Partial<SalesReportIntentResult> & { parameters?: Partial<SalesReportIntentParameters> };

  const rawAirline = parsed.parameters?.airline;
  const parameters: SalesReportIntentParameters = {
    timeExpression: parsed.parameters?.timeExpression ?? null,
    dateFrom: parsed.parameters?.dateFrom ?? null,
    dateTo: parsed.parameters?.dateTo ?? null,
    airline: rawAirline && AIRLINE_RULE_KEYS.includes(rawAirline as AirlineRuleKey) ? (rawAirline as AirlineRuleKey) : null,
    staffName: parsed.parameters?.staffName ?? null,
    metric: parsed.parameters?.metric ?? null,
  };

  // Fall back to the last airline discussed in this session if the current
  // message doesn't name one — mirrors ConversationOrchestrator's own
  // session-continuity pattern for the flight-search side.
  if (!parameters.airline && sessionContext?.lastAirline) {
    parameters.airline = sessionContext.lastAirline;
  }

  return {
    intent: (parsed.intent as SalesReportIntent) ?? "UNKNOWN",
    parameters,
    confidence: parsed.confidence ?? 0.5,
  };
}

function fmt(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // Monday-start week
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - diff);
  return start;
}

function resolveTimeExpression(expr: string | null): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (expr) {
    case "yesterday": {
      const y = new Date(today);
      y.setUTCDate(y.getUTCDate() - 1);
      return { dateFrom: fmt(y), dateTo: fmt(y) };
    }
    case "this week": {
      const start = startOfWeekUTC(today);
      return { dateFrom: fmt(start), dateTo: fmt(today) };
    }
    case "last week": {
      const thisWeekStart = startOfWeekUTC(today);
      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - 1);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 6);
      return { dateFrom: fmt(lastWeekStart), dateTo: fmt(lastWeekEnd) };
    }
    case "this month": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { dateFrom: fmt(start), dateTo: fmt(today) };
    }
    case "last month": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { dateFrom: fmt(start), dateTo: fmt(end) };
    }
    case "this year": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      return { dateFrom: fmt(start), dateTo: fmt(today) };
    }
    case "today":
    default:
      return { dateFrom: fmt(today), dateTo: fmt(today) };
  }
}

function resolveDateRange(params: SalesReportIntentParameters): { dateFrom: string; dateTo: string } {
  if (params.dateFrom && params.dateTo) return { dateFrom: params.dateFrom, dateTo: params.dateTo };
  return resolveTimeExpression(params.timeExpression);
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString()}`;
}

function periodLabel(dateFrom: string, dateTo: string): string {
  return dateFrom === dateTo ? dateFrom : `${dateFrom} - ${dateTo}`;
}

function rangeSpansMonths(dateFrom: string, dateTo: string): boolean {
  const [, fm, fy] = dateFrom.split("/").map(Number);
  const [, tm, ty] = dateTo.split("/").map(Number);
  const months = (ty - fy) * 12 + (tm - fm);
  return months >= 2;
}

function growthArrow(pct: number): string {
  return pct > 0 ? "↑+" : pct < 0 ? "↓" : "→";
}

// Understands + answers a sales-report question end-to-end: classify
// intent, resolve a relative time expression ("this week") to a concrete
// date range, query the matching AnalyticsService method, and format a
// plain-text reply. Each call is a one-shot classification (no
// multi-turn slot-filling like the flight-search assistant) — sessionContext
// only carries the last airline discussed forward, matching how much
// continuity a "what about last week" follow-up actually needs.
export async function handleQuery(message: string, sessionContext?: SessionContext): Promise<SalesReportQueryResponse> {
  const extraction = await extractIntent(message, sessionContext);
  const { dateFrom, dateTo } = resolveDateRange(extraction.parameters);
  const airline = extraction.parameters.airline ?? undefined;
  const period = periodLabel(dateFrom, dateTo);

  switch (extraction.intent) {
    case "SHOW_SALES_SUMMARY": {
      const kpi = await AnalyticsService.getExecutiveSummary(dateFrom, dateTo, airline ? [airline] : undefined);
      if (kpi.reportCount === 0) {
        return { reply: `No saved reports for ${period}${airline ? ` (${airline})` : ""}.`, intent: extraction.intent, data: kpi };
      }
      const reply = [
        `Sales summary — ${period}${airline ? ` (${airline})` : ""}`,
        `Gross sales: ${naira(kpi.grossSalesAmount)}`,
        `Net sales: ${naira(kpi.netSalesAmount)}`,
        `Tickets issued: ${kpi.totalTicketsIssued} (voided: ${kpi.totalTicketsVoided}, ${naira(kpi.totalVoidAmount)})`,
        `Reports: ${kpi.reportCount}`,
      ].join("\n");
      return { reply, intent: extraction.intent, data: kpi };
    }

    case "SHOW_AIRLINE_PERFORMANCE": {
      const metrics = await AnalyticsService.getAirlineMetrics(dateFrom, dateTo);
      if (metrics.length === 0) {
        return { reply: `No airline data for ${period}.`, intent: extraction.intent, data: metrics };
      }
      const reply = [
        `Airline performance — ${period}`,
        ...metrics.map((m) => `${m.rank}. ${m.airline}: ${naira(m.sales)} (${m.tickets} tickets, ${m.voids} voided)`),
      ].join("\n");
      return { reply, intent: extraction.intent, data: metrics };
    }

    case "SHOW_STAFF_PERFORMANCE": {
      const metrics = await AnalyticsService.getStaffMetrics(dateFrom, dateTo, airline);
      const staffName = extraction.parameters.staffName;
      const filtered = staffName ? metrics.filter((m) => m.staffName.toLowerCase().includes(staffName.toLowerCase())) : metrics;
      if (filtered.length === 0) {
        return {
          reply: `No staff data for ${period}${airline ? ` (${airline})` : ""}${staffName ? ` matching "${staffName}"` : ""}.`,
          intent: extraction.intent,
          data: filtered,
        };
      }
      const reply = [
        `Staff performance — ${period}${airline ? ` (${airline})` : ""}`,
        ...filtered.map((m) => `${m.rank}. ${m.staffName}: ${naira(m.sales)} (${m.tickets} tickets)`),
      ].join("\n");
      return { reply, intent: extraction.intent, data: filtered };
    }

    case "SHOW_TRENDS": {
      const granularity = dateFrom === dateTo ? "daily" : rangeSpansMonths(dateFrom, dateTo) ? "monthly" : "weekly";
      const points = await AnalyticsService.getTrendData(dateFrom, dateTo, granularity);
      if (points.length === 0) {
        return { reply: `No trend data for ${period}.`, intent: extraction.intent, data: points };
      }
      const reply = [`Sales trend — ${period}`, ...points.map((p) => `${p.label}: ${naira(p.sales)} (${p.tickets} tickets)`)].join("\n");
      return { reply, intent: extraction.intent, data: points };
    }

    case "SHOW_COMPARISON": {
      const comparison = await AnalyticsService.compareWithPreviousPeriod(dateFrom, dateTo);
      const previousPeriod = periodLabel(comparison.previous.period.from, comparison.previous.period.to);
      const reply = [
        `Comparison — ${period} vs ${previousPeriod}`,
        `Sales: ${naira(comparison.current.grossSalesAmount)} vs ${naira(comparison.previous.grossSalesAmount)} (${growthArrow(comparison.growth.salesGrowthPct)}${Math.abs(comparison.growth.salesGrowthPct)}%)`,
        `Tickets: ${comparison.current.totalTicketsIssued} vs ${comparison.previous.totalTicketsIssued} (${growthArrow(comparison.growth.ticketsGrowthPct)}${Math.abs(comparison.growth.ticketsGrowthPct)}%)`,
      ].join("\n");
      return { reply, intent: extraction.intent, data: comparison };
    }

    case "SHOW_BALANCE": {
      const balanceResponse = airline
        ? await AirlineAIService.getAirlineBalance(airline as AirlineKey)
        : await AirlineAIService.getAllAirlineBalances();
      return { reply: balanceResponse.message, intent: extraction.intent, data: balanceResponse.data };
    }

    default:
      return {
        reply: "I can help with sales totals, airline/staff performance, trends, comparisons, or balances — could you rephrase your question?",
        intent: "UNKNOWN",
      };
  }
}
