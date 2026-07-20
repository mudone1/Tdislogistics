import { NextResponse } from "next/server";
import { confirmReport } from "@/modules/sales-reporting/reporting/ReportGenerator";

export const runtime = "nodejs";

interface ConfirmPayload {
  verifiedBy?: string;
  staffCorrections?: Record<string, string>; // rawCode -> corrected display name
}

// "Reply Save" from the spec's verification step — nothing is queryable
// toward weekly/monthly rollups (see SalesReport.status) until this runs.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = (await req.json().catch(() => ({}))) as ConfirmPayload;

  try {
    const summary = await confirmReport(id, payload.verifiedBy || "unknown", payload.staffCorrections);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[sales-reports/confirm] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
