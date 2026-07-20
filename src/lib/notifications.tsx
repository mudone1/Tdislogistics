"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  onClick?: () => void;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (title: string, body: string, onClick?: () => void) => void;
  markAllRead: () => void;
  markRead: (id: number) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationState | null>(null);

export function useNotifications(): NotificationState {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within <NotificationProvider>");
  return ctx;
}

const MAX_NOTIFICATIONS = 30;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const counter = useRef(0);

  const addNotification = useCallback((title: string, body: string, onClick?: () => void) => {
    const id = ++counter.current;
    setNotifications((prev) => [
      { id, title, body, createdAt: new Date().toISOString(), read: false, onClick },
      ...prev,
    ].slice(0, MAX_NOTIFICATIONS));

    // If the tab is backgrounded (not just a different app entirely — a
    // fully closed PWA can't receive this without real server-triggered
    // Web Push, which is a separate, larger follow-up) and permission was
    // already granted, also surface a real OS-level notification.
    if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, icon: "/icons/icon-192.png" });
        n.onclick = () => {
          window.focus();
          onClick?.();
        };
      } catch {
        /* some browsers restrict Notification outside a service worker — ignore */
      }
    }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, markRead, clearAll }}>
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
