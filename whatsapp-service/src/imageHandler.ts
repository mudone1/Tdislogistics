import { sendPassportImage } from "./assistantClient";
import type { MessageSender } from "./messageHandler";

export interface IncomingImage {
  chatId: string; // group JID (ends @g.us) or individual JID (ends @s.whatsapp.net)
  senderName: string | null;
  buffer: Buffer;
  mimeType: string;
}

// Unlike text messages, an image gets no mention gate in groups — an ID
// photo needs no command on either surface, per spec. Accepts any official
// photo ID (passport, National ID, driver's license, voter's card, ...),
// not just passports. A non-ID image (payment receipt, random photo, etc.)
// gets no reply at all — silent, not "that doesn't look like an ID", so a
// group chat full of payment screenshots doesn't get commented on by the
// bot every time.
export async function handleIncomingImage(msg: IncomingImage, sender: MessageSender): Promise<void> {
  const sessionKey = `whatsapp:${msg.chatId}`;

  try {
    const result = await sendPassportImage(sessionKey, msg.senderName, msg.buffer, msg.mimeType);
    if (result.isIdDocument && result.reply) {
      await sender.sendText(msg.chatId, result.reply);
    }
  } catch (err) {
    console.error(`[whatsapp] passport extraction failed for chat ${msg.chatId}:`, err);
    const reason = err instanceof Error ? err.message : String(err);
    await sender.sendText(msg.chatId, `I couldn't read that photo just now — mind trying again in a moment? (${reason})`);
  }
}
