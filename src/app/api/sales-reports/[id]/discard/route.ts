import { NextResponse } from "next/server";
import { discardReport } from "@/modules/sales-reporting/reporting/ReportGenerator";

export const runtime = "nodejs";

// Lets the user reject a generated-but-unverified report (wrong file,
// wrong airline picked, etc.) instead of it sitting around forever in
// PENDING_VERIFICATION.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await discardReport(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sales-reports/discard] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
