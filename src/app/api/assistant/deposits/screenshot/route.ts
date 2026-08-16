import { NextResponse } from "next/server";
import { parsePaymentReceiptImage } from "@/modules/travel-assistant/deposits/PaymentReceiptParser";

export const runtime = "nodejs";
export const maxDuration = 60;

// Detection-only — no DB write here, and no messaging decision either.
// whatsapp-service calls this the moment an image is posted in a group,
// caches the extracted fields itself (in memory, keyed by the WhatsApp
// message ID), and stays completely silent until a "credited"/"not
// credited" reply arrives (see the /tag route, which is where every
// downstream decision — airline matching, Paystack detection, what if
// anything gets said in the group — actually happens).
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
