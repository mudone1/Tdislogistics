"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useApp } from "@/lib/store";
import { getRoleLabel } from "@/lib/constants";
import { initials } from "@/lib/utils";

export default function Header() {
  const { currentUser, logout } = useApp();
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-NG", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="logo-box">
          <Image src="/images/Tdis_logo.svg" alt="TDIS Logistics" width={50} height={50} style={{ height: 50, width: "auto", objectFit: "contain" }} priority />
        </div>
        <span className="iata-badge">✈ IATA ACCREDITED</span>
      </div>
      <div className="header-right">
        <div className="live-dot" aria-hidden />
        <span className="clock" suppressHydrationWarning>
          {clock}
        </span>
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
