"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AIRLINES, AIRLINE_LOGO_MAP } from "@/lib/constants";
import { useApp } from "@/lib/store";
import { formatNaira } from "@/lib/utils";

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
  currency: string;
  lastSynced: string | null;
}

export default function AirlinesSection() {
  const { settings } = useApp();
  const [connectors, setConnectors] = useState<ConnectorBalance[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setConnectors(data.connectors ?? []);
      })
      .catch(() => {
        /* tiles just show "Not yet synced" — no separate error state needed here */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Airlines</div>
      <p style={{ fontSize: 12.5, color: "var(--gray-400)", marginBottom: 18 }}>
        Balances shown here come from each airline&apos;s automated connector sync (Admin → Airline Connectors) —
        Airline Deposits is a separate, fully manual record and never affects what&apos;s shown on these tiles.
      </p>
      <div className="airlines-grid">
        {AIRLINES.map((a) => {
          const key = CODE_TO_AIRLINE_KEY[a.code];
          const entry = key ? connectors.find((c) => c.airline === key) : undefined;
          const bal = entry?.currentBalance ?? null;
          const logo = AIRLINE_LOGO_MAP[a.code];
          return (
            <a
              key={a.code}
              className="airline-tile"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="tile-open">Open ↗</span>
              {logo ? (
                // Airline logos are third-party brand marks — kept as plain <img> since
                // next/image's optimizer isn't needed for small static SVGs like these.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={a.name} className="airline-logo-lg" />
              ) : (
                <div className="airline-logo-fallback" style={{ background: a.color }}>
                  {a.abbr}
                </div>
              )}
              <div className="airline-tile-name">{a.name}</div>
              <div className="airline-tile-code">{a.code}</div>
              <div style={{ fontFamily: "var(--font-inter-tight)", fontWeight: 800, fontSize: 15, color: "var(--navy-dark)", marginTop: 6 }}>
                {bal != null ? formatNaira(bal) : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--gray-400)", marginBottom: 2 }}>
                {entry?.lastSynced ? new Date(entry.lastSynced).toLocaleString("en-NG") : "Not yet synced"}
              </div>
              {bal != null && (
                <span className={`airline-status ${bal < settings.thresholdLow ? "status-low" : "status-active"}`}>
                  {bal < settings.thresholdLow ? "● Low balance" : "● Active"}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </motion.div>
  );
}
