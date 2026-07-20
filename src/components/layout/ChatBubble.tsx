"use client";

import { useState, useRef, useEffect } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/lib/icon-map";
import { authHelper } from "@/lib/firebase";
import { useNotifications } from "@/lib/notifications";
import { formatLeg, formatRouteHeader } from "@/modules/travel-assistant/formatting/formatFlightResults";
import FlightCards, { type FlightLeg } from "./FlightCards";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  hasResults?: boolean;
  legs?: FlightLeg[];
  showCards?: boolean;
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
  const [scrollToId, setScrollToId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);
  const { addNotification } = useNotifications();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Jump to a specific result when opened from a notification click — the
  // target message needs to actually be in the DOM first, which only
  // happens once `open` flips true and this panel mounts.
  useEffect(() => {
    if (!open || scrollToId == null) return;
    const el = document.getElementById(`chat-msg-${scrollToId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollToId(null);
  }, [open, scrollToId]);

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

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text }]);
    setInput("");
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

      if (hasResults) {
        const q = legs[0].result.query;
        addNotification("Flight search completed", `${q.origin} → ${q.destination} results are ready`, () => {
          setOpen(true);
          setScrollToId(newId);
        });
      }
    } catch (err) {
      console.error("[assistant] request threw:", err);
      setMessages((m: ChatMessage[]) => [
        ...m,
        {
          id: idCounter++,
          role: "assistant",
          text: "Couldn't reach the search service — check your connection and try again.",
        },
      ]);
      setPending(null);
    } finally {
      setSending(false);
    }
  }

  async function copyMessage(m: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500);
    } catch (err) {
      console.error("[assistant] copy failed:", err);
    }
  }

  function shareToWhatsApp(text: string): void {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
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
    setMessages((m: ChatMessage[]) => [
      ...m,
      { id: idCounter++, role: "assistant", text, hasResults: true, legs },
    ]);
    setHistoryOpen(false);
  }

  function describeHttpError(status: number): string {
    if (status === 504) {
      return "That search is taking longer than expected and timed out — try narrowing it (e.g. name one airline) or try again in a moment.";
    }
    if (status >= 500) {
      return "The search service hit an error on its end — try again in a moment.";
    }
    return "That request didn't go through — try rephrasing it.";
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
                      <button onClick={() => shareToWhatsApp(m.text)}>Share to WhatsApp</button>
                      <button onClick={() => toggleCards(m.id)}>{m.showCards ? "View Text" : "View Cards"}</button>
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
