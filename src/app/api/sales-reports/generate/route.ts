import { NextResponse } from "next/server";
import { generateReport } from "@/modules/sales-reporting/reporting/ReportGenerator";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

// Vision extraction of a screenshot can take a while on the larger Llama-4
// model; give it well past the default before Vercel kills the function.
export const maxDuration = 120;

// multipart/form-data: "airline" field + one or more "files" entries.
// Accepts Excel (.xls/.xlsx — the reliable path) and image screenshots
// (.png/.jpg/etc — extracted via a vision model). Multiple screenshots of
// one report are merged into a single report before rule processing.
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
    return NextResponse.json({ error: "At least one file is required (field name: files)" }, { status: 400 });
  }

  const createdBy = form.get("createdBy");

  try {
    const files = await Promise.all(
      fileEntries.map(async (f) => ({
        name: f.name,
        buffer: Buffer.from(await f.arrayBuffer()),
        mimeType: f.type || undefined,
      }))
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
