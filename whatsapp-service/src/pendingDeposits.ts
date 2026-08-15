import type { PaymentReceiptExtraction, DepositAirlineMenuOption } from "./assistantClient";

// Two small in-memory caches, same pattern as lastImageCache.ts — a single
// long-running process, so no persistence layer is needed; a restart just
// means any payment screenshot mid-tag needs to be re-discussed, which is
// an acceptable, rare cost (the confirmed/recorded deposits themselves are
// safely in Postgres by the time this cache entry would otherwise matter).

export interface PendingScreenshot {
  chatId: string;
  messageId: string;
  extraction: PaymentReceiptExtraction;
  cachedAt: number;
}

// Generous TTL relative to lastImageCache's 15 minutes — a payment
// screenshot posted in a busy deposit group might genuinely not get
// reviewed and tagged "credited" for hours, unlike a ticket-extraction
// command that's always an immediate follow-up to its own image.
const SCREENSHOT_TTL_MS = 24 * 60 * 60 * 1000;

const pendingScreenshots = new Map<string, PendingScreenshot>();

function key(chatId: string, messageId: string): string {
  return `${chatId}|${messageId}`;
}

export function recordPendingScreenshot(chatId: string, messageId: string, extraction: PaymentReceiptExtraction): void {
  pendingScreenshots.set(key(chatId, messageId), { chatId, messageId, extraction, cachedAt: Date.now() });
}

function isExpired(entry: PendingScreenshot): boolean {
  return Date.now() - entry.cachedAt > SCREENSHOT_TTL_MS;
}

export function getPendingScreenshot(chatId: string, messageId: string): PendingScreenshot | null {
  const entry = pendingScreenshots.get(key(chatId, messageId));
  if (!entry) return null;
  if (isExpired(entry)) {
    pendingScreenshots.delete(key(chatId, messageId));
    return null;
  }
  return entry;
}

// Fallback for a "credited"/"not credited" reply with no real WhatsApp
// reply-to attached — same reasoning as lastImageCache's fallback for the
// ticket-extraction command: the common case of just typing the next
// message rather than using WhatsApp's own reply-to picker. Only returns a
// match when there's EXACTLY one screenshot currently pending in this chat
// — with two or more in flight at once, which one "credited" refers to is
// genuinely ambiguous, and guessing wrong here would silently mis-record
// a real deposit, so this deliberately returns null rather than picking
// "the most recent" in that case.
export function getSolePendingScreenshot(chatId: string): PendingScreenshot | null {
  const matches: PendingScreenshot[] = [];
  for (const entry of pendingScreenshots.values()) {
    if (entry.chatId !== chatId || isExpired(entry)) continue;
    matches.push(entry);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function clearPendingScreenshot(chatId: string, messageId: string): void {
  pendingScreenshots.delete(key(chatId, messageId));
}

// One at a time per chat — the spec's own workflow is a simple sequential
// exchange ("wait for the user's response"), not a system designed to
// juggle several simultaneously-ambiguous payments. A second payment
// needing airline selection while one is already pending in the same chat
// simply replaces it; the earlier screenshot stays in pendingScreenshots
// and can still be resolved later via a fresh "credited" reply.
export interface PendingAirlineSelection {
  chatId: string;
  screenshot: PendingScreenshot;
  menu: DepositAirlineMenuOption[];
}

const pendingAirlineSelections = new Map<string, PendingAirlineSelection>();

export function setPendingAirlineSelection(chatId: string, screenshot: PendingScreenshot, menu: DepositAirlineMenuOption[]): void {
  pendingAirlineSelections.set(chatId, { chatId, screenshot, menu });
}

export function getPendingAirlineSelection(chatId: string): PendingAirlineSelection | null {
  return pendingAirlineSelections.get(chatId) ?? null;
}

export function clearPendingAirlineSelection(chatId: string): void {
  pendingAirlineSelections.delete(chatId);
}
