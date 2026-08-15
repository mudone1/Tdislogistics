import { sendDocumentImage } from "./assistantClient";
import { setLastImage } from "./lastImageCache";
import { handleDepositScreenshot } from "./depositTracking";
import type { MessageSender } from "./messageHandler";

// Matches a whole message/caption that IS the command — not just contains
// it somewhere — so an unrelated sentence that happens to include the word
// "extract" doesn't accidentally trigger this. "X" is intentionally
// single-letter and exact-match only, per spec's own examples. The `i` flag
// already makes this case-insensitive (X/x both match) — the trailing
// punctuation strip below handles the real-world miss: a phone keyboard's
// auto-capitalize+auto-punctuate can turn a standalone "X" into "X." since
// it looks like a sentence, which a bare `$` anchor would reject.
const EXTRACT_COMMAND_PATTERN = /^(extract|x|use this name)$/i;

export function isExtractCommand(text: string): boolean {
  return EXTRACT_COMMAND_PATTERN.test(text.trim().replace(/[.!?]+$/, ""));
}

export interface IncomingImage {
  chatId: string; // group JID (ends @g.us) or individual JID (ends @s.whatsapp.net)
  isGroup: boolean;
  senderName: string | null;
  buffer: Buffer;
  mimeType: string;
  // true when this image itself is "commanded" — a caption of
  // Extract/X/"use this name" attached directly to the image. Combined with
  // isGroup below to decide whether the (extra) ticket vision call runs.
  hasExplicitCommand: boolean;
  // This image's own WhatsApp message ID — needed by deposit-tracking to
  // key the pending-screenshot cache, so a later "credited" reply-to can
  // be matched back to this exact image (see depositTracking.ts).
  messageId: string | null;
}

// Unlike text messages, an image gets no mention gate in groups — an ID
// photo needs no command on either surface, per spec. Accepts any official
// photo ID (passport, National ID, driver's license, voter's card, ...),
// not just passports. Ticket screenshots (see TicketParser.ts) are gated
// differently: auto-detected in a private chat, but only checked in a
// group when this image (or a follow-up message referencing it — see
// whatsapp.ts) carries an explicit Extract/X/"use this name" command,
// so the bot doesn't comment on every ticket screenshot shared in a group.
// A non-ID, non-ticket image gets no reply at all — silent, not "that
// doesn't look like an ID", so a group chat full of unrelated photos
// doesn't get commented on by the bot every time.
export async function handleIncomingImage(msg: IncomingImage, sender: MessageSender): Promise<void> {
  const sessionKey = `whatsapp:${msg.chatId}`;
  setLastImage(msg.chatId, msg.buffer, msg.mimeType);

  const checkTicket = !msg.isGroup || msg.hasExplicitCommand;

  // Deposit-tracking's own vision check, independent of the ID/ticket
  // check below — runs for any GROUP image (private chats never track
  // deposits; this is inherently a team workflow) with a real message ID
  // to key its pending-cache entry against. Deliberately not awaited
  // alongside the ID/ticket call below via Promise.all: a payment-receipt
  // match and an ID/ticket match are mutually exclusive by the vision
  // prompts' own design (see PaymentReceiptParser.ts), so there's no
  // real race to coordinate, and keeping this as its own try/catch means
  // a failure here can never suppress the ID/ticket reply or vice versa.
  if (msg.isGroup && msg.messageId) {
    handleDepositScreenshot(msg.chatId, msg.messageId, msg.buffer, msg.mimeType)
      .then((reply) => {
        if (reply) return sender.sendText(msg.chatId, reply);
      })
      .catch((err) => console.error(`[whatsapp] deposit screenshot check failed for chat ${msg.chatId}:`, err));
  }

  try {
    const result = await sendDocumentImage(sessionKey, msg.senderName, msg.buffer, msg.mimeType, checkTicket);
    if (result.kind !== "NONE" && result.reply) {
      await sender.sendText(msg.chatId, result.reply);
    }
  } catch (err) {
    console.error(`[whatsapp] document extraction failed for chat ${msg.chatId}:`, err);
    const reason = err instanceof Error ? err.message : String(err);
    await sender.sendText(msg.chatId, `I couldn't read that photo just now — mind trying again in a moment? (${reason})`);
  }
}
