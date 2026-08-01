import { NextResponse } from "next/server";
import { parsePassportImage } from "@/modules/travel-assistant/passport/PassportParser";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";
import { loadSlots } from "@/modules/travel-assistant/ai/ConversationOrchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

function toDDMMYYYY(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// multipart/form-data: "file" (image), "sessionKey" (required), optional
// "displayName"/"isAuthenticated" — same field set as ChatIdentity, shared
// by both the web chat and the WhatsApp proxy.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required (field name: file)" }, { status: 400 });
  }

  const sessionKey = form.get("sessionKey");
  if (typeof sessionKey !== "string" || !sessionKey.trim()) {
    return NextResponse.json({ error: "sessionKey is required" }, { status: 400 });
  }

  const displayNameRaw = form.get("displayName");
  const displayName = typeof displayNameRaw === "string" && displayNameRaw.trim() ? displayNameRaw : null;
  const isAuthenticated = form.get("isAuthenticated") === "true";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parsePassportImage(buffer, file.type || "image/jpeg");

    if (!result.isPassport) {
      return NextResponse.json({ isPassport: false });
    }

    const session = await ChatMemoryRepository.getOrCreateSession(sessionKey, displayName, isAuthenticated);

    if (!result.readable) {
      const reply = "That passport photo isn't clear enough for me to read — could you upload a clearer picture?";
      await ChatMemoryRepository.appendMessage(session.id, "USER", "[passport image uploaded]");
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return NextResponse.json({ isPassport: true, readable: false, reply });
    }

    const slots = loadSlots(session);
    if (result.firstName?.trim()) slots.passengerFirstName = result.firstName.trim();
    if (result.lastName?.trim()) slots.passengerLastName = result.lastName.trim();
    if (result.dateOfBirth) slots.passengerDateOfBirth = result.dateOfBirth;
    await ChatMemoryRepository.updateSlots(session.id, slots);

    const reply = `Full Name:\n${result.fullName}\nDate of Birth:\n${toDDMMYYYY(result.dateOfBirth)}`;
    await ChatMemoryRepository.appendMessage(session.id, "USER", "[passport image uploaded]");
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return NextResponse.json({ isPassport: true, readable: true, reply });
  } catch (err) {
    console.error("[assistant/passport] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
