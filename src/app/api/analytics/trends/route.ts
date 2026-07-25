import { NextResponse } from "next/server";
import { getTrendData } from "@/modules/sales-reporting/services/AnalyticsService";

export const runtime = "nodejs";

const VALID_GRANULARITY = new Set(["daily", "weekly", "monthly"]);

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY&granularity=daily|weekly|monthly
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const granularity = url.searchParams.get("granularity") ?? "daily";

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }
  if (!VALID_GRANULARITY.has(granularity)) {
    return NextResponse.json({ error: '"granularity" must be daily, weekly, or monthly' }, { status: 400 });
  }

  try {
    const points = await getTrendData(dateFrom, dateTo, granularity as "daily" | "weekly" | "monthly");
    return NextResponse.json({ points });
  } catch (err) {
    console.error("[analytics/trends] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
