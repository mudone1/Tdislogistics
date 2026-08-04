import { NextResponse } from "next/server";
import { parseUnknownDocumentImage } from "@/modules/travel-assistant/passport/DocumentParser";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";
import { loadSlots } from "@/modules/travel-assistant/ai/ConversationOrchestrator";
import { toSurnameCase, toTitleCase } from "@/modules/travel-assistant/nameFormat";

export const runtime = "nodejs";
export const maxDuration = 60;

// Combined ID-card + airline-ticket image endpoint — used by whatsapp-service
// for any incoming image where a ticket check is in play (see
// DocumentParser.ts). The web ChatBubble keeps using /api/assistant/passport
// unchanged (ID-only, untouched by this feature per explicit product
// direction), so this route's contract is free to differ.
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
  // Caller-controlled: skip the (extra, costly) ticket vision call entirely
  // when the ticket feature's own gating rules (see whatsapp-service's
  // imageHandler.ts) say it shouldn't run for this image at all.
  const checkTicket = form.get("checkTicket") === "true";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseUnknownDocumentImage(buffer, mimeTypeOf(file), { checkTicket });

    const session = await ChatMemoryRepository.getOrCreateSession(sessionKey, displayName, isAuthenticated);

    if (result.kind === "NONE") {
      return NextResponse.json({ kind: "NONE" });
    }

    if (result.kind === "ID") {
      const { id } = result;
      if (!id.readable) {
        const reply = "That ID photo isn't clear enough for me to read the name — could you upload a clearer picture?";
        await ChatMemoryRepository.appendMessage(session.id, "USER", "[ID image uploaded]");
        await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
        return NextResponse.json({ kind: "ID", readable: false, reply });
      }

      const formattedFirstName = id.firstName?.trim() ? toTitleCase(id.firstName) : null;
      const formattedLastName = id.lastName?.trim() ? toSurnameCase(id.lastName) : null;

      const slots = loadSlots(session);
      if (formattedFirstName) slots.passengerFirstName = formattedFirstName;
      if (formattedLastName) slots.passengerLastName = formattedLastName;
      if (id.dateOfBirth) slots.passengerDateOfBirth = id.dateOfBirth;
      await ChatMemoryRepository.updateSlots(session.id, slots);

      const reply =
        formattedFirstName && formattedLastName
          ? `${formattedLastName} ${formattedFirstName}`
          : id.fullName ?? "";
      await ChatMemoryRepository.appendMessage(session.id, "USER", "[ID image uploaded]");
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return NextResponse.json({ kind: "ID", readable: true, reply });
    }

    // result.kind === "TICKET"
    const { ticket } = result;
    if (!ticket.readable) {
      const reply = "I can see that's a ticket, but the name or PNR isn't clear enough to read — could you send a clearer screenshot?";
      await ChatMemoryRepository.appendMessage(session.id, "USER", "[ticket image uploaded]");
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return NextResponse.json({ kind: "TICKET", readable: false, reply });
    }

    // One "Passenger Name:" line per passenger on the booking (a single PNR
    // routinely covers several travelling together — see the screenshot
    // that prompted this), then the shared PNR once at the end.
    const reply = [...ticket.passengerNames.map((name) => `Passenger Name: ${name}`), `PNR: ${ticket.pnr}`].join("\n");
    await ChatMemoryRepository.appendMessage(session.id, "USER", "[ticket image uploaded]");
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return NextResponse.json({ kind: "TICKET", readable: true, reply, passengerNames: ticket.passengerNames, pnr: ticket.pnr });
  } catch (err) {
    console.error("[assistant/document] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function mimeTypeOf(file: File): string {
  return file.type || "image/jpeg";
}
