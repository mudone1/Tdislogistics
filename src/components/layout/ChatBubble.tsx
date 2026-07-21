"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/lib/icon-map";
import { authHelper } from "@/lib/firebase";
import { useNotifications, OPEN_REFERENCE_EVENT } from "@/lib/notifications";
import {
  formatLeg,
  formatRouteHeader,
  cheapestPerAirline,
  cheapestFareClass,
} from "@/modules/travel-assistant/formatting/formatFlightResults";
import FlightCards, { type FlightLeg } from "./FlightCards";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  hasResults?: boolean;
  legs?: FlightLeg[];
  showCards?: boolean;
  imageBlob?: Blob;
}

interface PendingRoundTrip {
  origin: string;
  destination: string;
  date: string;
}

interface HistoryEntry {
  referenceId: string;
  origin: string;
  destination: string;
  date: string;
  resultCount: number;
  createdAt: string;
  result: FlightLeg["result"];
}

interface ChatIdentity {
  sessionKey: string;
  displayName: string | null;
  isAuthenticated: boolean;
}

const ANON_KEY_STORAGE = "tdis_assistant_anon_key";

function getAnonSessionKey(): string {
  if (typeof window === "undefined") return "anon:server";
  let key = localStorage.getItem(ANON_KEY_STORAGE);
  if (!key) {
    key = `anon:${crypto.randomUUID()}`;
    localStorage.setItem(ANON_KEY_STORAGE, key);
  }
  return key;
}

let idCounter = 0;

function buildQuoteImagePayload(legs: FlightLeg[]) {
  const generatedAt = legs[0]?.result.searchedAt ?? new Date().toISOString();
  return {
    generatedAt,
    legs: legs.map((leg) => ({
      label: leg.label,
      origin: leg.result.query.origin,
      destination: leg.result.query.destination,
      date: leg.result.query.date,
      rows: cheapestPerAirline(leg.result.options).map((option) => {
        const fareClass = cheapestFareClass(option);
        return {
          airline: option.airline,
          fare: option.fare,
          seatStatus: option.seatStatus,
          baggage: fareClass?.baggage ?? null,
          seatsLeft: fareClass?.seatsLeft ?? null,
        };
      }),
    })),
  };
}

export default function ChatBubble() {
  const [open, setOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: idCounter++,
      role: "assistant",
      text: 'Ask me for a flight quote — e.g. "Enugu ABV-LOS today" or "ABV to LOS 12th july to return 23rd". Searches Enugu Air, United Nigeria, XeJet, and Rano Air.',
    },
  ]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [pending, setPending] = useState<PendingRoundTrip | null>(null);
  const [identity, setIdentity] = useState<ChatIdentity | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);
  const { setSessionKey, refresh } = useNotifications();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Resolve who's chatting (logged-in Firebase user, or a stable anonymous
  // id) so the assistant can remember this session and greet accordingly.
  useEffect(() => {
    const unsubscribe = authHelper.onAuthStateChanged((user) => {
      setIdentity(
        user
          ? { sessionKey: `fb:${user.uid}`, displayName: user.displayName, isAuthenticated: true }
          : { sessionKey: getAnonSessionKey(), displayName: null, isAuthenticated: false }
      );
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (identity) setSessionKey(identity.sessionKey);
  }, [identity, setSessionKey]);

  // Fired as soon as results arrive (not waiting for the user to click
  // Share) so the image is already sitting in memory by the time they do.
  // The Web Share API only allows navigator.share() to be called
  // synchronously off a real user gesture — an await'd fetch right before
  // that call breaks "user activation" on most mobile browsers, which
  // silently fails and falls back to plain-text sharing instead of the
  // image. Pre-generating removes that fetch from the click path entirely.
  const prefetchQuoteImage = useCallback(async (id: number, legs: FlightLeg[]): Promise<void> => {
    try {
      const res = await fetch("/api/assistant/quote-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildQuoteImagePayload(legs)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setMessages((m: ChatMessage[]) => m.map((msg) => (msg.id === id ? { ...msg, imageBlob: blob } : msg)));
    } catch (err) {
      console.error("[assistant] quote image prefetch failed:", err);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!text || sending) return;

      setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text }]);
      setSending(true);

      try {
        const res = await fetch("/api/assistant/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, pending, ...identity }),
        });

        if (!res.ok) {
          console.error(`[assistant] request failed: HTTP ${res.status}`);
          setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "assistant", text: describeHttpError(res.status) }]);
          setPending(null);
          return;
        }

        const data = await res.json();
        const legs: FlightLeg[] = [];
        if (data.outbound) legs.push({ label: "Outbound", result: data.outbound });
        if (data.return) legs.push({ label: "Return", result: data.return });
        if (data.result) legs.push({ label: "", result: data.result });
        const hasResults = legs.some((l) => l.result.options.length > 0);

        const newId = idCounter++;
        setMessages((m: ChatMessage[]) => [
          ...m,
          { id: newId, role: "assistant", text: data.reply || "No response.", hasResults, legs },
        ]);
        setPending(data.pending ?? null);

        // The notification itself is created server-side (durable, survives
        // reload); eagerly re-poll here just so the bell updates within a
        // second instead of waiting out the regular poll interval.
        if (hasResults) {
          refresh();
          prefetchQuoteImage(newId, legs);
        }
      } catch (err) {
        console.error("[assistant] request threw:", err);
        const reason = err instanceof Error ? err.message : String(err);
        setMessages((m: ChatMessage[]) => [
          ...m,
          {
            id: idCounter++,
            role: "assistant",
            text: `Couldn't reach the search service — check your connection and try again.${errorContactNote(reason)}`,
          },
        ]);
        setPending(null);
      } finally {
        setSending(false);
      }
    },
    [sending, pending, identity, refresh, prefetchQuoteImage]
  );

  function send(): void {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  }

  // A notification bell click for a saved search dispatches this with the
  // reference ID — reuse the existing bare-reference-ID lookup shortcut
  // the orchestrator already supports rather than duplicating that logic.
  useEffect(() => {
    function onOpenReference(e: Event) {
      const referenceId = (e as CustomEvent<string>).detail;
      if (!referenceId) return;
      setOpen(true);
      sendMessage(referenceId);
    }
    window.addEventListener(OPEN_REFERENCE_EVENT, onOpenReference);
    return () => window.removeEventListener(OPEN_REFERENCE_EVENT, onOpenReference);
  }, [sendMessage]);

  useEffect(() => {
    if (!identity || greeted.current) return;
    greeted.current = true;
    fetch("/api/assistant/greet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.reply) setMessages([{ id: idCounter++, role: "assistant", text: data.reply }]);
      })
      .catch(() => {
        /* keep the default static greeting on failure */
      });
  }, [identity]);

  async function copyMessage(m: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500);
    } catch (err) {
      console.error("[assistant] copy failed:", err);
    }
  }

  function shareTextToWhatsApp(text: string): void {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function downloadImageAndOpenWhatsApp(blob: Blob): void {
    // No URL-scheme way to pre-attach an image to wa.me — download the
    // image and open WhatsApp Web/App so the user can attach it manually.
    // This is the guaranteed-delivery path: once we have a real image in
    // hand, every other path funnels back to this rather than ever
    // degrading to a plain-text message.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tdis-flight-quote.png";
    a.click();
    URL.revokeObjectURL(url);
    window.open("https://wa.me/", "_blank", "noopener,noreferrer");
  }

  async function shareImageBlob(blob: Blob): Promise<void> {
    const file = new File([blob], "tdis-flight-quote.png", { type: "image/png" });

    // navigator.canShare (and even navigator.share itself) is inconsistent
    // across installed-PWA/WebView contexts on Android — some versions
    // throw synchronously rather than returning false for file shares, or
    // silently drop the files and would otherwise leave us with nothing.
    // Wrapping the whole check means any failure here still falls through
    // to the guaranteed image-download path below instead of propagating
    // and losing the image entirely.
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "TDIS Flight Quote" });
        return;
      }
    } catch (err) {
      // AbortError just means the user dismissed the share sheet — not a
      // failure worth falling back for.
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[assistant] navigator.share failed:", err);
    }

    downloadImageAndOpenWhatsApp(blob);
  }

  async function shareToWhatsApp(m: ChatMessage): Promise<void> {
    if (!m.legs || m.legs.length === 0) {
      shareTextToWhatsApp(m.text);
      return;
    }

    // The image is normally already prefetched (see prefetchQuoteImage) by
    // the time the user gets around to clicking Share, so this call is
    // synchronous from the click and navigator.share() still counts as
    // user-activated. Only fall back to fetching here if prefetch hasn't
    // finished yet (e.g. clicked immediately) or failed — that path may
    // not preserve the share gesture on strict mobile browsers, but it's
    // the best available fallback.
    if (m.imageBlob) {
      try {
        await shareImageBlob(m.imageBlob);
      } catch (err) {
        // We already have a valid image in hand at this point, so even an
        // unexpected failure here should still deliver the image rather
        // than degrading all the way down to a plain-text share.
        console.error("[assistant] WhatsApp image share failed unexpectedly:", err);
        downloadImageAndOpenWhatsApp(m.imageBlob);
      }
      return;
    }

    try {
      const res = await fetch("/api/assistant/quote-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildQuoteImagePayload(m.legs)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await shareImageBlob(blob);
    } catch (err) {
      // Only reachable when image GENERATION itself failed — there's no
      // image to fall back to, so text is genuinely the last resort here.
      console.error("[assistant] WhatsApp image share failed:", err);
      shareTextToWhatsApp(m.text);
    }
  }

  function toggleCards(id: number): void {
    setMessages((m: ChatMessage[]) => m.map((msg) => (msg.id === id ? { ...msg, showCards: !msg.showCards } : msg)));
  }

  async function openHistory(): Promise<void> {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/assistant/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: identity?.sessionKey }),
      });
      const data = await res.json();
      setHistoryEntries(data.searches ?? []);
    } catch (err) {
      console.error("[assistant] history fetch failed:", err);
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function reopenSearch(entry: HistoryEntry): void {
    const legs: FlightLeg[] = [{ label: "", result: entry.result }];
    const text = `${entry.referenceId} — ${formatRouteHeader(entry.origin, entry.destination, entry.date)}\n${formatLeg(entry.result)}`;
    const newId = idCounter++;
    setMessages((m: ChatMessage[]) => [
      ...m,
      { id: newId, role: "assistant", text, hasResults: true, legs },
    ]);
    setHistoryOpen(false);
    prefetchQuoteImage(newId, legs);
  }

  // Per explicit product direction: unlike a public customer-facing bot, this
// tool's users are TDIS staff — the whole point of surfacing the actual
// reason is so it can be relayed to Muhammed (the developer) to fix, not
// hidden from them the way a stack trace would be from an end customer.
function errorContactNote(reason: string): string {
  return ` Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
}

function describeHttpError(status: number): string {
    if (status === 504) {
      return `That search is taking longer than expected and timed out — try narrowing it (e.g. name one airline) or try again in a moment.${errorContactNote(`HTTP 504`)}`;
    }
    if (status >= 500) {
      return `The search service hit an error on its end — try again in a moment.${errorContactNote(`HTTP ${status}`)}`;
    }
    return `That request didn't go through — try rephrasing it.${errorContactNote(`HTTP ${status}`)}`;
  }

  return (
    <>
      <button
        className="chat-bubble-fab"
        onClick={() => setOpen((o: boolean) => !o)}
        aria-label="AI Operations Assistant"
      >
        <Icon name="sparkles" size={22} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="chat-bubble-panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="chat-bubble-header">
              <span>
                <Icon name="sparkles" size={14} /> AI Operations Assistant
              </span>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={() => (historyOpen ? setHistoryOpen(false) : openHistory())} aria-label="Search history">
                  {historyOpen ? "← Back" : "🕘 History"}
                </button>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  ✕
                </button>
              </span>
            </div>

            {historyOpen ? (
              <div className="chat-bubble-history">
                {historyLoading ? (
                  <div className="chat-bubble-history-empty">Loading…</div>
                ) : historyEntries.length === 0 ? (
                  <div className="chat-bubble-history-empty">No past searches yet</div>
                ) : (
                  historyEntries.map((entry) => (
                    <button key={entry.referenceId} className="chat-bubble-history-item" onClick={() => reopenSearch(entry)}>
                      <div className="chat-bubble-history-ref">{entry.referenceId}</div>
                      <div className="chat-bubble-history-route">
                        {entry.origin} → {entry.destination} · {entry.date}
                      </div>
                      <div className="chat-bubble-history-meta">{entry.resultCount} result(s)</div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <>
            <div className="chat-bubble-messages" ref={scrollRef}>
              {messages.map((m: ChatMessage) => (
                <div id={`chat-msg-${m.id}`} key={m.id} className={`chat-bubble-msg-wrap ${m.role} ${m.showCards ? "wide" : ""}`}>
                  {m.showCards && m.legs ? (
                    <FlightCards legs={m.legs} />
                  ) : (
                    <div className={`chat-bubble-msg ${m.role}`}>{m.text}</div>
                  )}
                  {m.hasResults && (
                    <div className="chat-bubble-msg-actions">
                      <button onClick={() => copyMessage(m)}>
                        {copiedId === m.id ? "✓ Copied" : "📋 Copy"}
                      </button>
                      <button onClick={() => shareToWhatsApp(m)}>Share to WhatsApp</button>
                      <button onClick={() => toggleCards(m.id)}>{m.showCards ? "View Text" : "View Quote"}</button>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="chat-bubble-msg assistant chat-bubble-typing">🔍 Searching available flights…</div>
              )}
            </div>

            <div className="chat-bubble-input-row">
              <input
                type="text"
                placeholder={pending ? "Return date…" : "Type a route and date…"}
                value={input}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && send()}
                disabled={sending}
              />
              <button onClick={send} disabled={sending || !input.trim()}>
                Send
              </button>
            </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
