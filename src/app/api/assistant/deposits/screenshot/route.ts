import { NextResponse } from "next/server";
import { parsePaymentReceiptImage } from "@/modules/travel-assistant/deposits/PaymentReceiptParser";

export const runtime = "nodejs";
export const maxDuration = 60;

// Detection-only — no DB write here. whatsapp-service calls this the
// moment an image is posted in a group; if it looks like a payment
// receipt, the caller caches the extracted fields itself (in memory,
// keyed by the WhatsApp message ID) and waits for a "credited"/"not
// credited" reply before anything gets persisted (see the /tag route).
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
    const mimeType = file.type || "image/jpeg";
    const result = await parsePaymentReceiptImage(buffer, mimeType);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[assistant/deposits/screenshot] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
