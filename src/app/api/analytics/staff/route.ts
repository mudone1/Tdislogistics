import { NextResponse } from "next/server";
import { getStaffMetrics } from "@/modules/sales-reporting/services/AnalyticsService";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

const VALID_SORT = new Set(["sales", "tickets", "commission"]);

// GET ?dateFrom=DD/MM/YYYY&dateTo=DD/MM/YYYY&airline=AERO&sortBy=sales|tickets|commission
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const airline = url.searchParams.get("airline");
  const sortBy = url.searchParams.get("sortBy") ?? "sales";

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: '"dateFrom" and "dateTo" ("DD/MM/YYYY") are required' }, { status: 400 });
  }
  if (airline && !AIRLINE_RULE_KEYS.includes(airline as AirlineRuleKey)) {
    return NextResponse.json({ error: `"airline" must be one of ${AIRLINE_RULE_KEYS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_SORT.has(sortBy)) {
    return NextResponse.json({ error: '"sortBy" must be sales, tickets, or commission' }, { status: 400 });
  }

  try {
    const metrics = await getStaffMetrics(
      dateFrom,
      dateTo,
      airline ? (airline as AirlineRuleKey) : undefined,
      sortBy as "sales" | "tickets" | "commission"
    );
    return NextResponse.json({ metrics });
  } catch (err) {
    console.error("[analytics/staff] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
