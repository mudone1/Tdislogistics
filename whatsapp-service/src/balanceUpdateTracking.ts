import { reportBalanceUpdateMessage } from "./assistantClient";

// Lightweight local check ONLY — just enough to decide "should this
// message even be forwarded", never the real classification (that's
// re-validated server-side in /api/assistant/deposits/opening-balance,
// same division of labor as isPaymentTagReply's CREDITED/NOT_CREDITED
// regexes vs. the actual DB write happening in the main app). Only checks
// the message's own first line, same as the server-side check.
const TITLE_PATTERN = /^\s*balance\s*update\b/i;

export function isBalanceUpdateMessage(text: string): boolean {
  const firstLine = text.split("\n")[0] ?? "";
  return TITLE_PATTERN.test(firstLine);
}

/**
 * Forwards a nightly Balance Update post for parsing/storage. Always
 * silent — no group reply, success or failure — same "default = silent"
 * principle as the rest of deposit tracking: this is a passive background
 * accounting task the group shouldn't hear about, not a command someone
 * is waiting on a reply for. Failures are only logged server-side (this
 * function's own caller in whatsapp.ts already wraps it in .catch), so a
 * transient failure here never surfaces as bot noise in the group.
 */
export async function handleBalanceUpdateMessage(chatId: string, text: string): Promise<void> {
  await reportBalanceUpdateMessage(chatId, text);
}
