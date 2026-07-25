import { NextResponse } from "next/server";
import { getExecutiveSummary } from "@/modules/sales-reporting/services/AnalyticsService";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY&airlines=AERO,ARIK
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const airlinesParam = url.searchParams.get("airlines");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }

  let airlines: AirlineRuleKey[] | undefined;
  if (airlinesParam) {
    airlines = airlinesParam.split(",").map((a) => a.trim()) as AirlineRuleKey[];
    const invalid = airlines.filter((a) => !AIRLINE_RULE_KEYS.includes(a));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Invalid airline(s): ${invalid.join(", ")}` }, { status: 400 });
    }
  }

  try {
    const summary = await getExecutiveSummary(dateFrom, dateTo, airlines);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[analytics/kpi] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
