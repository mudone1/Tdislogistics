"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: { referenceId?: string; referenceIds?: string[] } | null;
  read: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  setSessionKey: (key: string | null) => void;
  refresh: () => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
}

const NotificationContext = createContext<NotificationState | null>(null);

export function useNotifications(): NotificationState {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within <NotificationProvider>");
  return ctx;
}

// Opening a notification whose payload names a saved search reuses the
// existing reference-ID lookup shortcut already wired into the chat
// bubble (typing a bare "TDIS-..." reference re-opens that search) —
// dispatched as a DOM event rather than threaded through props since the
// bell (Header) and the chat panel (ChatBubble) are unrelated components.
export const OPEN_REFERENCE_EVENT = "tdis:open-reference";

const POLL_INTERVAL_MS = 15000;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const sessionKeyRef = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const refresh = useCallback(async () => {
    const sessionKey = sessionKeyRef.current;
    if (!sessionKey) return;
    try {
      const res = await fetch("/api/assistant/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey }),
      });
      const data = await res.json();
      const rows: AppNotification[] = data.notifications ?? [];
      setNotifications(rows);

      // Pop a real OS notification for anything new since the last poll —
      // skip the very first load so opening the app doesn't replay history,
      // and only bother while the tab is actually backgrounded.
      if (
        !firstLoad.current &&
        typeof document !== "undefined" &&
        document.hidden &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        for (const n of rows) {
          if (!seenIds.current.has(n.id) && !n.read) {
            try {
              new Notification(n.title, { body: n.body, icon: "/icons/icon-192.png" });
            } catch {
              /* some browsers restrict Notification outside a service worker — ignore */
            }
          }
        }
      }
      firstLoad.current = false;
      rows.forEach((n) => seenIds.current.add(n.id));
    } catch (err) {
      console.error("[notifications] refresh failed:", err);
    }
  }, []);

  const setSessionKey = useCallback(
    (key: string | null) => {
      if (sessionKeyRef.current === key) return;
      sessionKeyRef.current = key;
      firstLoad.current = true;
      seenIds.current = new Set();
      if (key) refresh();
    },
    [refresh]
  );

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const markAllRead = useCallback(() => {
    const sessionKey = sessionKeyRef.current;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!sessionKey) return;
    fetch("/api/assistant/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey, all: true }),
    }).catch((err) => console.error("[notifications] markAllRead failed:", err));
  }, []);

  const markRead = useCallback((id: string) => {
    const sessionKey = sessionKeyRef.current;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    if (!sessionKey) return;
    fetch("/api/assistant/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey, id }),
    }).catch((err) => console.error("[notifications] markRead failed:", err));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, setSessionKey, refresh, markAllRead, markRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// Best-effort — call from a real user gesture (e.g. opening the bell
// dropdown for the first time), never on page load, or browsers will
// often auto-deny and remember that denial.
export function requestNotificationPermission(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
