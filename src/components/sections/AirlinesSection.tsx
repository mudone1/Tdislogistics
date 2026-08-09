"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AIRLINES, AIRLINE_LOGO_MAP } from "@/lib/constants";
import { useApp } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import AirlineSyncPanel from "./AirlineSyncPanel";
import { useAirlineSessions } from "./useAirlineSessions";
import Modal from "../ui/Modal";

// Bridges each airline's short code (constants.ts -> AIRLINES) to the
// connector framework's AirlineKey (src/modules/airline-connectors/core/
// types.ts) so this tile can look up its synced balance from
// /api/connectors. ValueJet has no connector yet — its tile just shows
// "Not yet synced", same as any connector-covered airline before its
// first sync.
const CODE_TO_AIRLINE_KEY: Record<string, string> = {
  P4: "AIRPEACE",
  NG: "AERO",
  NGE: "NGEAGLE",
  Z9: "IBOM",
  W3: "ARIK",
  XE: "XEJET",
  RN: "RANO",
  UNN: "UNITED",
  EA: "ENUGU",
};

interface ConnectorBalance {
  airline: string;
  currentBalance: number | null;
  previousBalance: number | null;
  currency: string;
  lastSynced: string | null;
  isInAuthCooldown: boolean;
  cooldownRemainingMs: number | null;
  cooldownMessage: string | null;
}

export default function AirlinesSection() {
  const { settings } = useApp();
  const [connectors, setConnectors] = useState<ConnectorBalance[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const { sessions, activeCode, openOrFocus, closeSession, minimizeAll } = useAirlineSessions();
  const [closeConfirmCode, setCloseConfirmCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/balances", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.balances)) {
          setConnectors(
            data.balances.map((b: any) => ({
              airline: b.airline,
              currentBalance: b.currentBalance != null ? parseFloat(b.currentBalance.toString()) : null,
              previousBalance: b.previousBalance != null ? parseFloat(b.previousBalance.toString()) : null,
              currency: b.currency,
              lastSynced: b.lastSynced,
              isInAuthCooldown: b.isInAuthCooldown,
              cooldownRemainingMs: b.cooldownRemainingMs,
              cooldownMessage: b.cooldownMessage,
            }))
          );
        }
      })
      .catch(() => {
        /* tiles just show "Not yet synced" — no separate error state needed here */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSyncComplete = () => {
    setLastSyncTime(new Date());
    // Refresh balances after sync completes
    fetch("/api/balances", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.balances)) return;
        setConnectors(
          data.balances.map((b: any) => ({
            airline: b.airline,
            currentBalance: b.currentBalance ? parseFloat(b.currentBalance) : null,
            previousBalance: b.previousBalance ? parseFloat(b.previousBalance) : null,
            currency: b.currency,
            lastSynced: b.lastSynced,
            isInAuthCooldown: b.isInAuthCooldown,
            cooldownRemainingMs: b.cooldownRemainingMs,
            cooldownMessage: b.cooldownMessage,
          }))
        );
      })
      .catch(() => {});
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Airlines</div>
      <p style={{ fontSize: 12.5, color: "var(--gray-400)", marginBottom: 18 }}>
        Balances shown here come from each airline&apos;s automated connector sync — Airline Deposits is a separate,
        fully manual record and never affects what&apos;s shown on these tiles.
      </p>

      {sessions.length > 0 && (
        <div className="airline-sessions-bar">
          <div className="airline-sessions-header">
            <span className="airline-sessions-title">Open Sessions</span>
            <button type="button" className="airline-sessions-minimize-all" onClick={minimizeAll}>
              Minimize All
            </button>
          </div>
          <div className="airline-sessions-pills">
            {sessions.map((s) => (
              <div key={s.code} className={`airline-session-pill ${activeCode === s.code ? "active" : ""}`}>
                <button type="button" className="airline-session-pill-main" onClick={() => openOrFocus(s)}>
                  {s.name}
                </button>
                <button
                  type="button"
                  className="airline-session-pill-close"
                  aria-label={`Close ${s.name} session`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCloseConfirmCode(s.code);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync Panel */}
      <AirlineSyncPanel onSyncComplete={handleSyncComplete} />

      <div className="airlines-grid">
        {AIRLINES.map((a) => {
          const key = CODE_TO_AIRLINE_KEY[a.code];
          const entry = key ? connectors.find((c) => c.airline === key) : undefined;
          // A wallet row is created with a placeholder currentBalance of 0
          // the first time an airline is registered — that's not a real
          // synced balance, so gate display on lastSynced, not on whether
          // currentBalance happens to be a number.
          const hasSynced = !!entry?.lastSynced;
          const bal = hasSynced ? entry?.currentBalance ?? null : null;
          const prevBal = hasSynced ? entry?.previousBalance ?? null : null;
          const change = bal !== null && prevBal !== null ? bal - prevBal : null;
          const logo = AIRLINE_LOGO_MAP[a.code];
          return (
            <a
              key={a.code}
              className={`airline-tile ${activeCode === a.code ? "session-active" : ""}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // A plain left-click opens/focuses the tracked session tab
                // instead of the browser's default new-tab-every-time
                // behavior — see useAirlineSessions.ts. Middle-click,
                // Ctrl/Cmd-click, and right-click "open in new tab" all
                // still work normally since the real href is left intact.
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                openOrFocus({ code: a.code, name: a.name, url: a.url });
              }}
              style={{
                opacity: entry?.isInAuthCooldown ? 0.6 : 1,
                position: "relative",
              }}
            >
              <span className="tile-open">Open ↗</span>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={a.name} className="airline-logo-lg" />
              ) : (
                <div className="airline-logo-fallback" style={{ background: a.color }}>
                  {a.abbr}
                </div>
              )}
              <div className="airline-tile-name">{a.name}</div>
              <div className="airline-tile-code">{a.code}</div>

              {/* Cooldown Alert */}
              {entry?.isInAuthCooldown && entry?.cooldownMessage && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--orange-600)",
                    backgroundColor: "var(--orange-50)",
                    padding: 6,
                    borderRadius: 3,
                    marginBottom: 6,
                    textAlign: "center",
                  }}
                >
                  ⏸ {entry.cooldownMessage}
                </div>
              )}

              <div style={{ fontFamily: "var(--font-inter-tight)", fontWeight: 800, fontSize: 15, color: "var(--navy-dark)", marginTop: 6 }}>
                {bal != null ? formatNaira(bal) : "—"}
                {change !== null && change !== 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: change > 0 ? "var(--green-500)" : "var(--red-500)" }}>
                    ({change > 0 ? "+" : ""}{formatNaira(change)})
                  </span>
                )}
              </div>

              <div style={{ fontSize: 10, color: "var(--gray-400)", marginBottom: 2 }}>
                {entry?.lastSynced ? new Date(entry.lastSynced).toLocaleString("en-NG") : "Not yet synced"}
              </div>

              {bal != null && !entry?.isInAuthCooldown && (
                <span className={`airline-status ${bal < settings.thresholdLow ? "status-low" : "status-active"}`}>
                  {bal < settings.thresholdLow ? "● Low balance" : "● Active"}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <Modal
        open={!!closeConfirmCode}
        onClose={() => setCloseConfirmCode(null)}
        title="Close airline session?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCloseConfirmCode(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                if (closeConfirmCode) closeSession(closeConfirmCode);
                setCloseConfirmCode(null);
              }}
            >
              Close
            </button>
          </>
        }
      >
        <p>
          Close {sessions.find((s) => s.code === closeConfirmCode)?.name ?? "this"} session? Your current session
          will be removed.
        </p>
      </Modal>
    </motion.div>
  );
}
