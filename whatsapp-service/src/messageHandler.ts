import { BOT_MENTION_TRIGGER } from "./config";
import { askAssistant } from "./assistantClient";
import { pollBookingJob } from "./bookingPoll";

export interface IncomingMessage {
  chatId: string; // group JID (ends @g.us) or individual JID (ends @s.whatsapp.net)
  isGroup: boolean;
  senderName: string | null;
  text: string;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
}

// Strips a leading/embedded "@tdisbot" (case-insensitive, whole-word so it
// doesn't also eat a longer name that happens to contain it) from the
// message text. Users typically type this as plain text rather than using
// WhatsApp's actual @-mention picker, so matching on the literal string is
// more reliable than relying on WhatsApp's structured mention metadata.
function stripTrigger(text: string): string {
  const pattern = new RegExp(`\\b${BOT_MENTION_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return text.replace(pattern, "").trim();
}

function mentionsBot(text: string): boolean {
  const pattern = new RegExp(`\\b${BOT_MENTION_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(text);
}

// Decides whether to respond at all, and if so, forwards the (trigger-
// stripped) message to the same assistant the browser chat uses, replies
// in the same WhatsApp chat, and — if a Book-on-Hold was started — kicks
// off polling for the eventual PNR/failure as a follow-up message.
//
// Groups stay silent unless @tdisbot is mentioned (avoids the bot
// responding to every unrelated message in a group it's just a member
// of); a direct 1:1 message is already addressed to the bot, so no
// trigger is required there.
export async function handleIncomingMessage(
  msg: IncomingMessage,
  sendMessage: (out: OutgoingMessage) => Promise<void>
): Promise<void> {
  if (msg.isGroup && !mentionsBot(msg.text)) return;

  const message = msg.isGroup ? stripTrigger(msg.text) : msg.text.trim();
  if (!message) return;

  const sessionKey = `whatsapp:${msg.chatId}`;
  const reply = async (text: string) => sendMessage({ chatId: msg.chatId, text });

  try {
    const result = await askAssistant(sessionKey, msg.senderName, message);
    await reply(result.reply);
    if (result.bookingJobId) {
      pollBookingJob(result.bookingJobId, (text) => reply(text));
    }
  } catch (err) {
    console.error(`[whatsapp] assistant call failed for chat ${msg.chatId}:`, err);
    const reason = err instanceof Error ? err.message : String(err);
    await reply(`I couldn't reach the assistant just now — mind trying again in a moment? (${reason})`);
  }
}
