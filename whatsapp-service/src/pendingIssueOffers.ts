// Tracks "the PNR a chat was just offered an Issue-Now option for", keyed
// by chatId — a plain in-memory map, same pattern as VarsBookOnHold.ts's own
// session cache (this service is one long-running process, not serverless).
// Lets a bare "1" or "Issue Now" reply resolve to the correct PNR without
// ever assuming "the latest booking" — it only resolves against whatever
// PNR THIS specific chat was just shown, and is cleared the moment it's used
// (or replaced the moment a newer booking offers a different PNR).
const offers = new Map<string, string>();

export function setPendingIssueOffer(chatId: string, pnr: string): void {
  offers.set(chatId, pnr);
}

const AFFIRMATIVE_ISSUE_REPLY = /^(1|issue now)$/i;

// Returns the PNR to issue if this message is a bare "1"/"Issue Now" reply
// AND this chat currently has a pending offer — consuming (clearing) it in
// the process so a stray second "1" later doesn't silently reuse a stale
// PNR. Returns null otherwise, leaving the message untouched for normal
// processing (including the full "Issue <PNR>"/"Pay <PNR>" commands, which
// never need this map at all since they already carry their own PNR).
export function resolvePendingIssueOffer(chatId: string, text: string): string | null {
  if (!AFFIRMATIVE_ISSUE_REPLY.test(text.trim())) return null;
  const pnr = offers.get(chatId);
  if (!pnr) return null;
  offers.delete(chatId);
  return pnr;
}
