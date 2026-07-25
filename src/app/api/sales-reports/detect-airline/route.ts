import { NextResponse } from "next/server";
import { detectAirline } from "@/modules/sales-reporting/services/AirlineDetectionService";

export const runtime = "nodejs";
export const maxDuration = 120; // vision fallback can be slow, same budget as /generate

// multipart/form-data: a single "file" entry. Standalone detection for the
// chatbot upload flow — called before /generate so the UI can show a
// confirm/select prompt without creating a report first.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required (field name: file)" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await detectAirline(buffer, file.name, file.type || undefined);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sales-reports/detect-airline] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
