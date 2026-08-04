// Remembers the most recent image sent in each chat, briefly — backs two
// cases where the ticket-extraction command arrives as a message SEPARATE
// from the image itself: a private-chat "Extract"/"X" sent right after an
// image with no caption, and a group-chat command that isn't a formal
// WhatsApp reply-to (whatsapp.ts tries a real quoted-message lookup first;
// this is the fallback for the common case of just typing the command next).
// Single most-recent image per chat is enough — a second image simply
// replaces the first, matching "the last one I sent" as most users mean it.
const TTL_MS = 15 * 60 * 1000;

interface CachedImage {
  buffer: Buffer;
  mimeType: string;
  cachedAt: number;
}

const cache = new Map<string, CachedImage>();

export function setLastImage(chatId: string, buffer: Buffer, mimeType: string): void {
  cache.set(chatId, { buffer, mimeType, cachedAt: Date.now() });
}

export function getLastImage(chatId: string): { buffer: Buffer; mimeType: string } | null {
  const entry = cache.get(chatId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(chatId);
    return null;
  }
  return { buffer: entry.buffer, mimeType: entry.mimeType };
}
