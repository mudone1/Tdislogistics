import { Prisma } from "@prisma/client";
import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { AirlineRuleKey } from "../core/types";

export interface ExecutiveKPIs {
  period: { from: string; to: string };
  totalTicketsIssued: number;
  totalTicketsVoided: number;
  totalVoidAmount: number;
  totalCreditAmount: number;
  totalDebitAmount: number;
  grossSalesAmount: number;
  netSalesAmount: number;
  totalCommission: number;
  reportCount: number;
}

export interface AirlineMetric {
  rank: number;
  airline: AirlineRuleKey;
  sales: number;
  tickets: number;
  voids: number;
  netSales: number;
}

export interface StaffMetric {
  rank: number;
  staffName: string;
  sales: number;
  tickets: number;
  commission: number;
  voidAmount: number;
}

export interface TrendPoint {
  label: string; // "25/07/2026" (daily), "Week of 21/07/2026" (weekly), "Jul 2026" (monthly)
  sales: number;
  tickets: number;
  netSales: number;
}

export interface ComparisonMetrics {
  current: ExecutiveKPIs;
  previous: ExecutiveKPIs;
  growth: {
    salesGrowthPct: number;
    ticketsGrowthPct: number;
    netSalesGrowthPct: number;
  };
}

// Every date column in the analytics tables is stored as "DD/MM/YYYY" text
// (matching SalesReport.reportDate's format, per the parsing layer) rather
// than a real DATE column — so a plain Prisma `gte`/`lte` string comparison
// would sort lexicographically, not chronologically, and silently return
// the wrong rows. All range queries here go through raw SQL with
// TO_DATE(col, 'DD/MM/YYYY') instead of Prisma's query builder for that
// reason. Table/column names below are from a fixed internal set (never
// user input), so string-built SQL fragments for them carry no injection
// risk; only actual values are bound as parameters.
function parseDbDate(d: string): Date {
  const [day, month, year] = d.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toNum(v: unknown): number {
  return v == null ? 0 : Number(v);
}

interface ExecutiveSummaryRow {
  totalTicketsIssued: number | bigint | null;
  totalTicketsVoided: number | bigint | null;
  totalVoidAmount: Prisma.Decimal | string | null;
  totalCreditAmount: Prisma.Decimal | string | null;
  totalDebitAmount: Prisma.Decimal | string | null;
  grossSalesAmount: Prisma.Decimal | string | null;
  netSalesAmount: Prisma.Decimal | string | null;
  totalCommission: Prisma.Decimal | string | null;
  reportCount: number | bigint;
}

async function fetchExecutiveSummary(
  dateFrom: string,
  dateTo: string,
  airlines?: AirlineRuleKey[]
): Promise<Omit<ExecutiveKPIs, "period">> {
  const rows = await prisma.$queryRaw<ExecutiveSummaryRow[]>`
    SELECT
      COALESCE(SUM("totalTicketsIssued"), 0) AS "totalTicketsIssued",
      COALESCE(SUM("totalTicketsVoided"), 0) AS "totalTicketsVoided",
      COALESCE(SUM("totalVoidAmount"), 0) AS "totalVoidAmount",
      COALESCE(SUM("totalCreditAmount"), 0) AS "totalCreditAmount",
      COALESCE(SUM("totalDebitAmount"), 0) AS "totalDebitAmount",
      COALESCE(SUM("grossSalesAmount"), 0) AS "grossSalesAmount",
      COALESCE(SUM("netSalesAmount"), 0) AS "netSalesAmount",
      COALESCE(SUM("totalCommission"), 0) AS "totalCommission",
      COUNT(*) AS "reportCount"
    FROM sales_report_analytics
    WHERE TO_DATE("reportDate", 'DD/MM/YYYY') BETWEEN ${parseDbDate(dateFrom)} AND ${parseDbDate(dateTo)}
      AND (${airlines == null || airlines.length === 0} OR "airline"::text = ANY(${airlines ?? []}))
  `;

  const row = rows[0];
  return {
    totalTicketsIssued: toNum(row?.totalTicketsIssued),
    totalTicketsVoided: toNum(row?.totalTicketsVoided),
    totalVoidAmount: toNum(row?.totalVoidAmount),
    totalCreditAmount: toNum(row?.totalCreditAmount),
    totalDebitAmount: toNum(row?.totalDebitAmount),
    grossSalesAmount: toNum(row?.grossSalesAmount),
    netSalesAmount: toNum(row?.netSalesAmount),
    totalCommission: toNum(row?.totalCommission),
    reportCount: toNum(row?.reportCount),
  };
}

export async function getExecutiveSummary(
  dateFrom: string,
  dateTo: string,
  airlines?: AirlineRuleKey[]
): Promise<ExecutiveKPIs> {
  const summary = await fetchExecutiveSummary(dateFrom, dateTo, airlines);
  return { period: { from: dateFrom, to: dateTo }, ...summary };
}

interface AirlineMetricRow {
  airline: string;
  sales: Prisma.Decimal | string | null;
  tickets: number | bigint | null;
  voids: number | bigint | null;
  netSales: Prisma.Decimal | string | null;
}

export async function getAirlineMetrics(
  dateFrom: string,
  dateTo: string,
  sortBy: "sales" | "tickets" | "netSales" = "sales"
): Promise<AirlineMetric[]> {
  const rows = await prisma.$queryRaw<AirlineMetricRow[]>`
    SELECT
      "airline",
      COALESCE(SUM("totalSales"), 0) AS "sales",
      COALESCE(SUM("totalTickets"), 0) AS "tickets",
      COALESCE(SUM("totalVoids"), 0) AS "voids",
      COALESCE(SUM("netSales"), 0) AS "netSales"
    FROM airline_daily_metrics
    WHERE TO_DATE("date", 'DD/MM/YYYY') BETWEEN ${parseDbDate(dateFrom)} AND ${parseDbDate(dateTo)}
    GROUP BY "airline"
  `;

  const metrics = rows.map((r) => ({
    airline: r.airline as AirlineRuleKey,
    sales: toNum(r.sales),
    tickets: toNum(r.tickets),
    voids: toNum(r.voids),
    netSales: toNum(r.netSales),
  }));

  metrics.sort((a, b) => b[sortBy] - a[sortBy]);
  return metrics.map((m, idx) => ({ rank: idx + 1, ...m }));
}

interface StaffMetricRow {
  staffName: string;
  sales: Prisma.Decimal | string | null;
  tickets: number | bigint | null;
  commission: Prisma.Decimal | string | null;
  voidAmount: Prisma.Decimal | string | null;
}

export async function getStaffMetrics(
  dateFrom: string,
  dateTo: string,
  airline?: AirlineRuleKey,
  sortBy: "sales" | "tickets" | "commission" = "sales"
): Promise<StaffMetric[]> {
  const rows = await prisma.$queryRaw<StaffMetricRow[]>`
    SELECT
      "staffName",
      COALESCE(SUM("salesAmount"), 0) AS "sales",
      COALESCE(SUM("ticketsIssued"), 0) AS "tickets",
      COALESCE(SUM("commission"), 0) AS "commission",
      COALESCE(SUM("voidAmount"), 0) AS "voidAmount"
    FROM staff_daily_performance
    WHERE TO_DATE("date", 'DD/MM/YYYY') BETWEEN ${parseDbDate(dateFrom)} AND ${parseDbDate(dateTo)}
      AND (${airline == null} OR "airline"::text = ${airline ?? ""})
    GROUP BY "staffName"
  `;

  const metrics = rows.map((r) => ({
    staffName: r.staffName,
    sales: toNum(r.sales),
    tickets: toNum(r.tickets),
    commission: toNum(r.commission),
    voidAmount: toNum(r.voidAmount),
  }));

  metrics.sort((a, b) => (sortBy === "sales" ? b.sales - a.sales : sortBy === "tickets" ? b.tickets - a.tickets : b.commission - a.commission));
  return metrics.map((m, idx) => ({ rank: idx + 1, ...m }));
}

interface TrendRow {
  bucket: Date;
  sales: Prisma.Decimal | string | null;
  tickets: number | bigint | null;
  netSales: Prisma.Decimal | string | null;
}

function formatTrendLabel(bucket: Date, granularity: "daily" | "weekly" | "monthly"): string {
  const day = String(bucket.getUTCDate()).padStart(2, "0");
  const month = String(bucket.getUTCMonth() + 1).padStart(2, "0");
  const year = bucket.getUTCFullYear();

  if (granularity === "daily") return `${day}/${month}/${year}`;
  if (granularity === "weekly") return `Week of ${day}/${month}/${year}`;
  const monthName = bucket.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${monthName} ${year}`;
}

export async function getTrendData(
  dateFrom: string,
  dateTo: string,
  granularity: "daily" | "weekly" | "monthly" = "daily"
): Promise<TrendPoint[]> {
  const truncUnit = granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";

  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      DATE_TRUNC(${truncUnit}, TO_DATE("date", 'DD/MM/YYYY')) AS "bucket",
      COALESCE(SUM("totalSales"), 0) AS "sales",
      COALESCE(SUM("totalTickets"), 0) AS "tickets",
      COALESCE(SUM("netSales"), 0) AS "netSales"
    FROM airline_daily_metrics
    WHERE TO_DATE("date", 'DD/MM/YYYY') BETWEEN ${parseDbDate(dateFrom)} AND ${parseDbDate(dateTo)}
    GROUP BY "bucket"
    ORDER BY "bucket" ASC
  `;

  return rows.map((r) => ({
    label: formatTrendLabel(new Date(r.bucket), granularity),
    sales: toNum(r.sales),
    tickets: toNum(r.tickets),
    netSales: toNum(r.netSales),
  }));
}

function growthPct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10; // one decimal place
}

// Previous period is the immediately preceding span of equal length (e.g.
// asking for "this week" (7 days) compares against the 7 days before that),
// not a fixed calendar unit — keeps the comparison meaningful regardless of
// what range the caller picked.
export async function compareWithPreviousPeriod(dateFrom: string, dateTo: string): Promise<ComparisonMetrics> {
  const from = parseDbDate(dateFrom);
  const to = parseDbDate(dateTo);
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);

  const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

  const [current, previous] = await Promise.all([
    getExecutiveSummary(dateFrom, dateTo),
    getExecutiveSummary(fmt(prevFrom), fmt(prevTo)),
  ]);

  return {
    current,
    previous,
    growth: {
      salesGrowthPct: growthPct(current.grossSalesAmount, previous.grossSalesAmount),
      ticketsGrowthPct: growthPct(current.totalTicketsIssued, previous.totalTicketsIssued),
      netSalesGrowthPct: growthPct(current.netSalesAmount, previous.netSalesAmount),
    },
  };
}
