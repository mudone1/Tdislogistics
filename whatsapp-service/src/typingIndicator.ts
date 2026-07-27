// WhatsApp's "composing…" (typing) indicator times out client-side after
// roughly 10-25s, so a multi-second (or multi-minute, for a Book-on-Hold
// or balance sync) wait needs it re-sent periodically to stay visible the
// whole time — a single send at the start would silently drop out partway
// through a long wait. Returns a stop function to call once the real
// reply is ready to send.
const REFRESH_MS = 8000;

export function keepTypingAlive(sendTyping: () => Promise<void>): () => void {
  sendTyping().catch(() => {});
  const interval = setInterval(() => {
    sendTyping().catch(() => {});
  }, REFRESH_MS);
  return () => clearInterval(interval);
}
