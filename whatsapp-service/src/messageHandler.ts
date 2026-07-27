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

// Strips a leading/embedded "@tdisbot" (case-insensitive, trailing word
// boundary so it doesn't also eat a longer word that happens to start with
// it, e.g. "@tdisbotter") from the message text. Users typically type this
// as plain text rather than using WhatsApp's actual @-mention picker, so
// matching on the literal string is more reliable than relying on
// WhatsApp's structured mention metadata.
//
// No LEADING \b before the trigger — "@" is a non-word character, so a
// word-boundary assertion immediately before it can never match at the
// start of a message or right after a space (there's no \w/\W transition
// there), which is exactly how everyone actually types it. An earlier
// version had \b on both sides and silently matched nothing as a result.
function buildTriggerPattern(): RegExp {
  return new RegExp(`${BOT_MENTION_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

function stripTrigger(text: string): string {
  return text.replace(buildTriggerPattern(), "").trim();
}

function mentionsBot(text: string): boolean {
  return buildTriggerPattern().test(text);
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
