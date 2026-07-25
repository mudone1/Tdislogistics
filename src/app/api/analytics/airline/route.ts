import { NextResponse } from "next/server";
import { getAirlineMetrics } from "@/modules/sales-reporting/services/AnalyticsService";

export const runtime = "nodejs";

const VALID_SORT = new Set(["sales", "tickets", "netSales"]);

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY&sortBy=sales|tickets|netSales
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const sortBy = url.searchParams.get("sortBy") ?? "sales";

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }
  if (!VALID_SORT.has(sortBy)) {
    return NextResponse.json({ error: '"sortBy" must be sales, tickets, or netSales' }, { status: 400 });
  }

  try {
    const metrics = await getAirlineMetrics(dateFrom, dateTo, sortBy as "sales" | "tickets" | "netSales");
    return NextResponse.json({ metrics });
  } catch (err) {
    console.error("[analytics/airline] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
