import { checkPaymentScreenshot, tagDeposit, getDepositReport } from "./assistantClient";
import {
  recordPendingScreenshot,
  getPendingScreenshot,
  getSolePendingScreenshot,
  clearPendingScreenshot,
  setPendingAirlineSelection,
  getPendingAirlineSelection,
  clearPendingAirlineSelection,
  type PendingScreenshot,
} from "./pendingDeposits";

// Manual-testing-phase airline-deposit tracking (see the project spec this
// was built from). No fixed "the one deposit group" — per product
// direction, this runs in whatever group it's used in; deposits are scoped
// per-chat everywhere (see AirlineDepositRepository/schema).
//
// Split across two entry points because of WHERE in the message pipeline
// each needs to run:
// - isPaymentTagReply/handlePaymentTagReply: a "credited"/"not credited"
//   reply to a screenshot. Deliberately bypasses the group @tdisbot
//   mention gate (called from whatsapp.ts BEFORE that gate is applied),
//   same as the ticket-extraction command already does — a natural
//   follow-up reply to something just posted shouldn't need re-addressing
//   the bot every time.
// - handleDepositCommand: airline-selection ("N", only reachable at all in
//   a group because the mention gate already ran) and "credit update".
//   These DO require @tdisbot, per the spec's own "@TDISbot 1" example —
//   enforced structurally by running from messageHandler.ts, which only
//   calls this after the existing mention gate has already passed.

const NOT_CREDITED_PATTERN = /\bnot\s+credited\b/i;
const CREDITED_PATTERN = /\bcredited\b/i;
const CREDIT_UPDATE_COMMAND = /^credit\s*update$/i;
const BARE_NUMBER = /^\d+$/;

export function isPaymentTagReply(text: string): "CREDITED" | "NOT_CREDITED" | null {
  const trimmed = text.trim();
  // Checked first — "not credited" also contains the word "credited",
  // so the negative match must win before the bare positive pattern runs.
  if (NOT_CREDITED_PATTERN.test(trimmed)) return "NOT_CREDITED";
  if (CREDITED_PATTERN.test(trimmed)) return "CREDITED";
  return null;
}

/**
 * A group image that might be a payment receipt — runs the detection
 * vision call and, if confirmed, caches it as pending (no DB write yet).
 * Always returns null: per the "SILENT PAYMENT PROCESSING RULE" spec,
 * the bot must never speak at screenshot-receipt time, not even to
 * acknowledge it or flag an unreadable amount — analysis happens now,
 * but every visible response (or lack of one) is decided only once a
 * "credited"/"not credited" tag arrives, see resolveAndRecord below.
 */
export async function handleDepositScreenshot(chatId: string, messageId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  const extraction = await checkPaymentScreenshot(buffer, mimeType);
  if (!extraction.isPaymentReceipt) return null; // not a payment screenshot at all — ignore completely, not even cached

  recordPendingScreenshot(chatId, messageId, extraction);
  return null;
}

// Default = silent. The only messages this ever sends are the two the
// spec explicitly requires: the fixed airline-selection question (worded
// differently for a Paystack payment vs an ambiguous direct-airline
// payment), and the literal word "Copy" once an airline-direct payment is
// actually recorded. Everything else — duplicates, a Paystack payment's
// airline finally being resolved, internal failures aside — stays quiet.
async function resolveAndRecord(chatId: string, screenshot: PendingScreenshot, airlineOverride: string | undefined, sendReply: (text: string) => Promise<void>): Promise<void> {
  const result = await tagDeposit(chatId, screenshot.messageId, "CREDITED", screenshot.extraction, airlineOverride);

  if (result.status === "unreadable") {
    // The one genuinely-required clarification: nothing can be recorded
    // at all without an amount, so the sender needs to know.
    clearPendingScreenshot(chatId, screenshot.messageId);
    await sendReply(result.message);
    return;
  }

  if (result.status === "needs_airline") {
    setPendingAirlineSelection(chatId, screenshot, result.menu);
    const menuText = result.menu.map((o) => `${o.num}. ${o.label}`).join("\n");
    const intro = result.isPaystack ? "Which airline is this credit for?" : "Which airline is this payment for?";
    await sendReply(`${intro} Reply with @TDISbot followed by the number:\n\n${menuText}\n\nExample: If this payment is for ValueJet, reply with @TDISbot 1.`);
    return;
  }

  clearPendingScreenshot(chatId, screenshot.messageId);
  clearPendingAirlineSelection(chatId);

  if (result.status === "duplicate") {
    // Already recorded — per spec, do not create another record AND do
    // not send another unnecessary response. Silent.
    return;
  }

  if (result.status === "ignored") {
    // Shouldn't happen — this path always sends decision "CREDITED" — but
    // the type includes it (tagDeposit's response covers both decisions),
    // so guard it rather than assuming "recorded" below. A real failure,
    // not a normal silent-success path, so this one does speak up.
    await sendReply("Something went wrong recording that payment — please try again.");
    return;
  }

  // status === "recorded"
  if (result.isPaystack) {
    // The airline was just attached to an already-silently-recorded
    // Paystack payment — per spec, don't repeat the amount/details, and
    // there's no "Copy" for this path either (that's reserved for a
    // direct airline payment, per the spec's own worked example).
    return;
  }
  await sendReply("Copy");
}

/** Called BEFORE the group mention gate — see module doc comment above. */
export async function handlePaymentTagReply(
  chatId: string,
  quotedMessageId: string | null,
  decision: "CREDITED" | "NOT_CREDITED",
  sendReply: (text: string) => Promise<void>
): Promise<void> {
  const screenshot = (quotedMessageId ? getPendingScreenshot(chatId, quotedMessageId) : null) ?? getSolePendingScreenshot(chatId);
  if (!screenshot) return; // nothing pending to tag — silently ignore, matches "not a comment on every message" principle

  if (decision === "NOT_CREDITED") {
    clearPendingScreenshot(chatId, screenshot.messageId);
    await tagDeposit(chatId, screenshot.messageId, "NOT_CREDITED", screenshot.extraction).catch(() => {});
    return; // explicitly silent — "completely ignore it for the deposit record" per spec, no reply needed
  }

  await resolveAndRecord(chatId, screenshot, undefined, sendReply);
}

/**
 * Called AFTER the mention gate (from messageHandler.ts) — handles the
 * airline-selection number reply and the "credit update" command. `text`
 * is already trigger-stripped by the caller, matching every other command
 * in this codebase.
 */
export async function handleDepositCommand(chatId: string, text: string, sendReply: (text: string) => Promise<void>): Promise<{ handled: boolean }> {
  const trimmed = text.trim();

  if (BARE_NUMBER.test(trimmed)) {
    const pending = getPendingAirlineSelection(chatId);
    if (!pending) return { handled: false }; // a bare number with nothing awaiting selection isn't ours — let it fall through
    const num = parseInt(trimmed, 10);
    const chosen = pending.menu.find((o) => o.num === num);
    if (!chosen) {
      await sendReply(`That's not one of the options — please reply @TDISbot with a number from 1 to ${pending.menu.length}.`);
      return { handled: true };
    }
    clearPendingAirlineSelection(chatId);
    await resolveAndRecord(chatId, pending.screenshot, chosen.airline, sendReply);
    return { handled: true };
  }

  if (CREDIT_UPDATE_COMMAND.test(trimmed)) {
    const { date, count, report } = await getDepositReport(chatId);
    if (count === 0) {
      await sendReply(`No credited deposits recorded yet for ${date} in this chat.`);
    } else {
      await sendReply(report);
    }
    return { handled: true };
  }

  return { handled: false };
}
