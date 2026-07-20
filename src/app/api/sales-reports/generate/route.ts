import { NextResponse } from "next/server";
import { generateReport } from "@/modules/sales-reporting/reporting/ReportGenerator";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

// multipart/form-data: "airline" field + one or more "files" entries
// (.xls/.xlsx). Screenshot upload isn't implemented yet — Excel-only for
// now, per the agreed MVP scope (Excel is also the more reliable input).
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const airline = form.get("airline");
  if (typeof airline !== "string" || !AIRLINE_RULE_KEYS.includes(airline as AirlineRuleKey)) {
    return NextResponse.json(
      { error: `"airline" must be one of ${AIRLINE_RULE_KEYS.join(", ")}` },
      { status: 400 }
    );
  }

  const fileEntries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: "At least one Excel file is required (field name: files)" }, { status: 400 });
  }

  const createdBy = form.get("createdBy");

  try {
    const files = await Promise.all(
      fileEntries.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))
    );
    const summary = await generateReport(
      airline as AirlineRuleKey,
      files,
      typeof createdBy === "string" ? createdBy : undefined
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[sales-reports/generate] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
