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
 * Returns an acknowledgement to send, or null to stay silent.
 *
 * Silent whenever possible — same "don't comment on unrelated photos"
 * principle imageHandler.ts already applies to IDs/tickets. The screenshot
 * is cached as pending either way, so a later "credited"/"not credited"
 * reply still resolves it even when nothing was said here.
 *
 * The two cases where it DOES speak up:
 * - the amount isn't readable (nothing useful could be recorded anyway,
 *   so the sender needs to know)
 * - the airline can't be told apart from the narration alone (a real
 *   question that needs an answer before this can be recorded)
 */
export async function handleDepositScreenshot(chatId: string, messageId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  const extraction = await checkPaymentScreenshot(buffer, mimeType);
  if (!extraction.isPaymentReceipt) return null;

  recordPendingScreenshot(chatId, messageId, extraction);

  if (!extraction.readable) {
    return "📥 Got a payment screenshot, but I couldn't clearly read the amount — could you send a clearer one? I'll still hold this one if you reply \"credited\" to it, but the amount may be missing.";
  }

  if (!extraction.airlineMatched) {
    return '📥 Payment screenshot received. Reply "credited" (or reply directly to this message) once it\'s confirmed credited, or "not credited" to ignore it.';
  }

  return null; // airline is clear from the narration — nothing to ask, stay silent
}

async function resolveAndRecord(chatId: string, screenshot: PendingScreenshot, airlineOverride: string | undefined, sendReply: (text: string) => Promise<void>): Promise<void> {
  const result = await tagDeposit(chatId, screenshot.messageId, "CREDITED", screenshot.extraction, airlineOverride);

  if (result.status === "unreadable") {
    clearPendingScreenshot(chatId, screenshot.messageId);
    await sendReply(result.message);
    return;
  }

  if (result.status === "needs_airline") {
    setPendingAirlineSelection(chatId, screenshot, result.menu);
    const menuText = result.menu.map((o) => `${o.num}. ${o.label}`).join("\n");
    await sendReply(
      `Which airline is this payment for? Reply with @TDISbot followed by the number:\n\n${menuText}\n\nExample: If this payment is for ValueJet, reply with @TDISbot 1.`
    );
    return;
  }

  clearPendingScreenshot(chatId, screenshot.messageId);
  clearPendingAirlineSelection(chatId);

  if (result.status === "duplicate") {
    await sendReply(`That payment is already recorded for ${result.airline} — not adding it again.`);
    return;
  }

  if (result.status === "ignored") {
    // Shouldn't happen — this path always sends decision "CREDITED" — but
    // the type includes it (tagDeposit's response covers both decisions),
    // so guard it rather than assuming "recorded" below.
    await sendReply("Something went wrong recording that payment — please try again.");
    return;
  }

  // status === "recorded"
  const amountText = result.amount.toLocaleString("en-NG");
  await sendReply(`✅ Recorded: ${result.airline} — ₦${amountText}`);
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
