"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useApp } from "@/lib/store";
import { useNotifications, requestNotificationPermission } from "@/lib/notifications";
import { getRoleLabel } from "@/lib/constants";
import { initials } from "@/lib/utils";

export default function Header() {
  const { currentUser, logout } = useApp();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const [clock, setClock] = useState("--:--:--");
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-NG", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggleBell() {
    const next = !bellOpen;
    setBellOpen(next);
    if (next) {
      requestNotificationPermission();
      markAllRead();
    }
  }

  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="logo-box">
          <Image src="/images/Tdis_logo.jpeg" alt="TDIS Logistics" width={97} height={50} style={{ height: 50, width: "auto", objectFit: "contain" }} priority />
        </div>
        <span className="iata-badge">✈ IATA ACCREDITED</span>
      </div>
      <div className="header-right">
        <div className="live-dot" aria-hidden />
        <span className="clock" suppressHydrationWarning>
          {clock}
        </span>
        <div className="notif-bell-wrap" ref={bellRef}>
          <button className="notif-bell-btn" onClick={toggleBell} aria-label="Notifications">
            🔔
            {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
          {bellOpen && (
            <div className="notif-dropdown">
              <div className="notif-dropdown-header">Notifications</div>
              {notifications.length === 0 ? (
                <div className="notif-empty">No notifications yet</div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className={`notif-item ${n.read ? "" : "unread"}`}
                    onClick={() => {
                      markRead(n.id);
                      setBellOpen(false);
                      n.onClick?.();
                    }}
                  >
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-body">{n.body}</div>
                    <div className="notif-item-time">{timeAgo(n.createdAt)}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="agent-pill">
          <div className="agent-avatar">{currentUser ? initials(currentUser.name) : "AG"}</div>
          <div>
            <div className="agent-name">{currentUser?.name ?? "Agent On Duty"}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {currentUser ? getRoleLabel(currentUser.role) : "Staff"}
            </div>
          </div>
        </div>
        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}
