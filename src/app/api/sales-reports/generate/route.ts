import { NextResponse } from "next/server";
import { generateReport, processMonthlyUpload, isMonthlyUpload, parseFiles } from "@/modules/sales-reporting/reporting/ReportGenerator";
import { detectAirline, type DetectionMethod } from "@/modules/sales-reporting/services/AirlineDetectionService";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

// Vision extraction of a screenshot can take a while on the larger Llama-4
// model; give it well past the default before Vercel kills the function.
export const maxDuration = 120;

// multipart/form-data: "files" entries + an OPTIONAL "airline" field.
// Accepts Excel (.xls/.xlsx — the reliable path) and image screenshots
// (.png/.jpg/etc — extracted via a vision model). Multiple screenshots of
// one report are merged into a single report before rule processing.
//
// When "airline" is omitted, AirlineDetectionService runs against the
// first uploaded file. A confident detection (>=70%) proceeds
// automatically; anything less returns 422 with the detection result
// instead of guessing — the caller should show a confirm/select prompt and
// retry with an explicit "airline".
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const airlineField = form.get("airline");
  if (airlineField != null && (typeof airlineField !== "string" || !AIRLINE_RULE_KEYS.includes(airlineField as AirlineRuleKey))) {
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
  const importedBy = form.get("importedBy");

  try {
    const files = await Promise.all(
      fileEntries.map(async (f) => ({
        name: f.name,
        buffer: Buffer.from(await f.arrayBuffer()),
        mimeType: f.type || undefined,
      }))
    );

    let airline = airlineField as AirlineRuleKey | null;
    let detection: { method: DetectionMethod; confidence: number; reasoning: string[] } | undefined;

    if (!airline) {
      const primary = files[0];
      const result = await detectAirline(primary.buffer, primary.name, primary.mimeType);
      if (!result.airline || result.requiresUserSelection) {
        return NextResponse.json({ detection: result, needsAirlineSelection: true }, { status: 422 });
      }
      airline = result.airline;
      detection = { method: result.method, confidence: result.confidence, reasoning: result.reasoning };
    }

    const options = {
      createdBy: typeof createdBy === "string" ? createdBy : undefined,
      importedBy: typeof importedBy === "string" ? importedBy : undefined,
      detection,
    };

    // Parse once up front so a monthly-vs-daily decision doesn't force a
    // second (and for screenshots, re-run-the-expensive-vision-call) parse
    // of the same files.
    const preParsed = await parseFiles(files);

    if (isMonthlyUpload(preParsed.rows)) {
      const summary = await processMonthlyUpload(airline, files, options, preParsed);
      return NextResponse.json({ ...summary, isMonthly: true });
    }

    const summary = await generateReport(airline, files, options, preParsed);
    return NextResponse.json({ ...summary, isMonthly: false });
  } catch (err) {
    console.error("[sales-reports/generate] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
