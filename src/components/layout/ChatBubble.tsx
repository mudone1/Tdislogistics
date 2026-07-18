"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/lib/icon-map";

let idCounter = 0;

export default function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: idCounter++,
      role: "assistant",
      text: 'Ask me for a flight quote - e.g. "Enugu ABV-LOS today" or "from Lagos to Enugu tomorrow". Currently only Enugu Air is supported.',
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { id: idCounter++, role: "user", text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/assistant/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { id: idCounter++, role: "assistant", text: data.reply || "No response." }]);
    } catch {
      setMessages((m) => [...m, { id: idCounter++, role: "assistant", text: "Something went wrong - try again." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button className="chat-bubble-fab" onClick={() => setOpen((o) => !o)} aria-label="AI Operations Assistant">
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
              <button onClick={() => setOpen(false)} aria-label="Close">
                x
              </button>
            </div>

            <div className="chat-bubble-messages" ref={scrollRef}>
              {messages.map((m) => (
                <div key={m.id} className={`chat-bubble-msg ${m.role}`}>
                  {m.text}
                </div>
              ))}
              {sending && <div className="chat-bubble-msg assistant chat-bubble-typing">Searching...</div>}
            </div>

            <div className="chat-bubble-input-row">
              <input
                type="text"
                placeholder="Type a route and date..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                disabled={sending}
              />
              <button onClick={send} disabled={sending || !input.trim()}>
                Send
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
