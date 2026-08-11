import { BOT_MENTION_TRIGGER } from "./config";
import { askAssistant } from "./assistantClient";
import { pollBookingJob } from "./bookingPoll";
import { pollBalanceUpdate } from "./balanceUpdatePoll";
import { keepTypingAlive } from "./typingIndicator";

export interface IncomingMessage {
  chatId: string; // group JID (ends @g.us) or individual JID (ends @s.whatsapp.net)
  isGroup: boolean;
  senderName: string | null;
  text: string;
}

// Split into text/image rather than one "send whatever" call so a
// Book-on-Hold confirmation screenshot (see bookingPoll.ts) can be sent as
// a real WhatsApp image message with the PNR as its caption, matching
// ChatBubble's BookingResultCard rather than just describing it in text.
export interface MessageSender {
  sendText: (chatId: string, text: string) => Promise<void>;
  sendImage: (chatId: string, buffer: Buffer, caption?: string) => Promise<void>;
  setTyping: (chatId: string) => Promise<void>;
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

export function mentionsBot(text: string): boolean {
  return buildTriggerPattern().test(text);
}

// Cheap, deterministic pre-check for "this looks like a booking request" —
// mirrors the same booking-verb + passenger-detail co-occurrence rule
// systemPrompt.ts's BOOK_ON_HOLD classifier uses server-side, but runs here
// client-side so a "Copy" acknowledgement can go out THE INSTANT the
// message arrives, before the real (LLM-backed) assistant call — which can
// take many seconds — even starts. Never blocks anything: a false positive
// just means an extra "Copy" ahead of what turns out to be a flight search.
const BOOKING_VERB_PATTERN = /\b(book|hold|reserve)\b/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// \s (not just literal space) in the middle class used to also match a
// newline, letting this cross a line break on a multi-line booking message
// — kept in sync with ConversationOrchestrator.ts's findPhoneInText fix
// (2026-08-11) even though this copy only gates the early "Copy" ack, not
// real routing.
const PHONE_PATTERN = /\+?[\d][\d -]{8,17}\d/;

// Mirrors ConversationOrchestrator.ts's server-side deterministic gate —
// a message with BOTH an email AND a phone number is an unambiguous
// booking even with no trigger verb at all, same as that copy. Kept in
// sync so the early "Copy" ack fires for the same messages the real
// routing decision treats as a booking (confirmed live: a verb-less
// booking message like "ValueJet / Johnson Anya / Abv los tomorrow /
// 21:15 / <phone> / <email>" got no ack here even though the server
// correctly booked it).
function looksLikeBookingRequest(text: string): boolean {
  const hasEmail = EMAIL_PATTERN.test(text);
  const hasPhone = PHONE_PATTERN.test(text);
  return (BOOKING_VERB_PATTERN.test(text) && (hasEmail || hasPhone)) || (hasEmail && hasPhone);
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
export async function handleIncomingMessage(msg: IncomingMessage, sender: MessageSender): Promise<void> {
  if (msg.isGroup && !mentionsBot(msg.text)) return;

  const message = msg.isGroup ? stripTrigger(msg.text) : msg.text.trim();
  if (!message) return;

  const sessionKey = `whatsapp:${msg.chatId}`;
  const reply = async (text: string) => sender.sendText(msg.chatId, text);

  // Immediate acknowledgement — sent right away, before any real processing,
  // so a booking request never sits in silence waiting on the assistant
  // call. The typing indicator below then covers the rest of the wait.
  if (looksLikeBookingRequest(message)) {
    await reply("Copy").catch((err) => console.error(`[whatsapp] ack send failed for chat ${msg.chatId}:`, err));
  }

  // "Typing…" from the moment we start working on a reply until it's
  // actually sent — covers both the initial assistant call (a flight
  // search can take 20-30s) and, if it continues into a poll below, that
  // too, so the chat never goes silent while something is happening.
  const stopTyping = keepTypingAlive(() => sender.setTyping(msg.chatId));

  try {
    const result = await askAssistant(sessionKey, msg.senderName, message);
    stopTyping();
    await reply(result.reply);
    if (result.bookingJobId) {
      pollBookingJob(result.bookingJobId, {
        sendText: reply,
        sendImage: (buffer, caption) => sender.sendImage(msg.chatId, buffer, caption),
        setTyping: () => sender.setTyping(msg.chatId),
      });
    }
    if (result.balanceUpdateTriggeredAt) {
      pollBalanceUpdate(result.balanceUpdateTriggeredAt, reply, () => sender.setTyping(msg.chatId));
    }
  } catch (err) {
    stopTyping();
    console.error(`[whatsapp] assistant call failed for chat ${msg.chatId}:`, err);
    const reason = err instanceof Error ? err.message : String(err);
    await reply(`I couldn't reach the assistant just now — mind trying again in a moment? (${reason})`);
  }
}
