"use client";

import { motion } from "framer-motion";
import { AIRLINES, AIRLINE_LOGO_MAP } from "@/lib/constants";
import { useApp } from "@/lib/store";

export default function AirlinesSection() {
  const { balances, settings } = useApp();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Airlines</div>
      <div className="airlines-grid">
        {AIRLINES.map((a) => {
          const bal = balances.find((b) => b.airline === a.name)?.balance ?? 0;
          const isLow = bal < settings.thresholdLow;
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
              <span className={`airline-status ${isLow ? "status-low" : "status-active"}`}>
                {isLow ? "● Low balance" : "● Active"}
              </span>
            </a>
          );
        })}
      </div>
    </motion.div>
  );
}
