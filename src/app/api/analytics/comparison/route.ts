import { NextResponse } from "next/server";
import { compareWithPreviousPeriod } from "@/modules/sales-reporting/services/AnalyticsService";

export const runtime = "nodejs";

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }

  try {
    const comparison = await compareWithPreviousPeriod(dateFrom, dateTo);
    return NextResponse.json(comparison);
  } catch (err) {
    console.error("[analytics/comparison] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
