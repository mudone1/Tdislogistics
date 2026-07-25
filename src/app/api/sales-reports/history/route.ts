import { NextResponse } from "next/server";
import { prisma } from "@/modules/airline-connectors/storage/prismaClient";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";
import type { SalesReportStatus } from "@prisma/client";

export const runtime = "nodejs";

function parseDDMMYYYY(s: string): number {
  const [day, month, year] = s.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
}

// GET ?limit=&offset=&airline=&dateFrom=&dateTo=&status= — paginated report
// list for the dashboard. airline/status filter at the DB level (typed
// enum columns); dateFrom/dateTo filter in application code after fetch,
// since reportDate is stored as "DD/MM/YYYY" text (see AnalyticsService's
// TO_DATE note) and report volume at this business's scale (dozens/month)
// makes an in-memory filter simpler than raw SQL for a list endpoint.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const airline = url.searchParams.get("airline");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const status = url.searchParams.get("status");

  if (airline && !AIRLINE_RULE_KEYS.includes(airline as AirlineRuleKey)) {
    return NextResponse.json({ error: `"airline" must be one of ${AIRLINE_RULE_KEYS.join(", ")}` }, { status: 400 });
  }
  if (status && status !== "PENDING_VERIFICATION" && status !== "SAVED") {
    return NextResponse.json({ error: '"status" must be PENDING_VERIFICATION or SAVED' }, { status: 400 });
  }

  try {
    const reports = await prisma.salesReport.findMany({
      where: {
        airline: airline ? (airline as AirlineRuleKey) : undefined,
        status: status ? (status as SalesReportStatus) : undefined,
      },
      include: { analytics: true },
      orderBy: { createdAt: "desc" },
    });

    const fromTime = dateFrom ? parseDDMMYYYY(dateFrom) : null;
    const toTime = dateTo ? parseDDMMYYYY(dateTo) : null;
    const filtered = reports.filter((r) => {
      const t = parseDDMMYYYY(r.reportDate);
      if (fromTime != null && t < fromTime) return false;
      if (toTime != null && t > toTime) return false;
      return true;
    });

    const page = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      total: filtered.length,
      limit,
      offset,
      reports: page.map((r) => ({
        id: r.id,
        airline: r.airline,
        reportDate: r.reportDate,
        grandTotal: Number(r.grandTotal),
        confidence: r.confidence,
        status: r.status,
        createdAt: r.createdAt,
        verifiedAt: r.verifiedAt,
        isDuplicateSuperseded: r.supersededById != null,
        totalTicketsIssued: r.analytics?.totalTicketsIssued ?? null,
      })),
    });
  } catch (err) {
    console.error("[sales-reports/history] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
