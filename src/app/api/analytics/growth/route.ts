import { NextResponse } from "next/server";
import { compareWithPreviousPeriod } from "@/modules/sales-reporting/services/AnalyticsService";

export const runtime = "nodejs";

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY
// Same underlying period-over-period comparison as /analytics/comparison,
// reshaped to lead with growth% and absolute deltas per metric rather than
// two full KPI blocks — a lighter response for a "how much did we grow"
// widget that doesn't need the full current/previous breakdown.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }

  try {
    const { current, previous, growth } = await compareWithPreviousPeriod(dateFrom, dateTo);
    return NextResponse.json({
      period: current.period,
      previousPeriod: previous.period,
      sales: { current: current.grossSalesAmount, previous: previous.grossSalesAmount, delta: current.grossSalesAmount - previous.grossSalesAmount, growthPct: growth.salesGrowthPct },
      tickets: { current: current.totalTicketsIssued, previous: previous.totalTicketsIssued, delta: current.totalTicketsIssued - previous.totalTicketsIssued, growthPct: growth.ticketsGrowthPct },
      netSales: { current: current.netSalesAmount, previous: previous.netSalesAmount, delta: current.netSalesAmount - previous.netSalesAmount, growthPct: growth.netSalesGrowthPct },
    });
  } catch (err) {
    console.error("[analytics/growth] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
