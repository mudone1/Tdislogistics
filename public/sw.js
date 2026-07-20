// Minimal service worker — its main job right now is just being
// registered at all: Chrome/Android's PWA install criteria require an
// active service worker with a fetch handler, and iOS Web Push (a planned
// follow-up) requires one too. Deliberately no offline caching yet — that's
// a separate decision with its own tradeoffs (stale data risk on a
// dashboard that shows live balances), not bundled into this pass.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op passthrough — required for installability checks, but every
  // request still just goes to the network normally.
});
