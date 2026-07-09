"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp, revenueInWindow } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import type { SalesGoals } from "@/lib/types";

const PERIODS: { key: keyof SalesGoals; label: string; icon: string; days: number }[] = [
  { key: "weekly", label: "This Week", icon: "📅", days: 7 },
  { key: "monthly", label: "This Month", icon: "🗓️", days: 30 },
  { key: "yearly", label: "This Year", icon: "📆", days: 365 },
];

export default function GoalsSection() {
  const { salesGoals, setGoal, bookingUpdates } = useApp();
  const [inputs, setInputs] = useState<Record<string, string>>({});

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Goals &amp; Targets</div>

      <div className="goals-period-grid">
        {PERIODS.map((p) => {
          const target = salesGoals[p.key] || 0;
          const achieved = revenueInWindow(bookingUpdates, p.days);
          const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
          const isAchieved = target > 0 && achieved >= target;

          return (
            <div className="goal-card" key={p.key}>
              <div className="goal-card-head">
                <span className="goal-card-title">{p.label}</span>
                <span className="goal-card-icon">{p.icon}</span>
              </div>
              <div className="goal-card-body">
                <div className="goal-input-row">
                  <input
                    type="number"
                    placeholder={`Set ${p.label.toLowerCase()} target (₦)`}
                    value={inputs[p.key] ?? ""}
                    onChange={(e) => setInputs((s) => ({ ...s, [p.key]: e.target.value }))}
                  />
                  <button
                    className="goal-set-btn"
                    onClick={() => {
                      const val = parseFloat(inputs[p.key] ?? "");
                      if (!isNaN(val) && val >= 0) {
                        setGoal(p.key, val);
                        setInputs((s) => ({ ...s, [p.key]: "" }));
                      }
                    }}
                  >
                    Set Target
                  </button>
                </div>

                {target > 0 ? (
                  <>
                    <div className="goal-pct-row">
                      <span className={`goal-pct ${isAchieved ? "achieved" : ""}`}>{pct}%</span>
                      <span style={{ fontSize: 12, color: "var(--gray-400)" }}>
                        {formatNaira(achieved)} / {formatNaira(target)}
                      </span>
                    </div>
                    <div className="goal-bar-bg">
                      <div className={`goal-bar ${isAchieved ? "achieved" : ""}`} style={{ width: `${pct}%` }} />
                    </div>
                    {isAchieved ? (
                      <>
                        <div className="goal-trophy">🏆</div>
                        <div className="goal-achieved-text">Target achieved!</div>
                      </>
                    ) : (
                      <div className="goal-sub">{formatNaira(target - achieved)} remaining</div>
                    )}
                  </>
                ) : (
                  <div className="empty-state" style={{ padding: "16px 8px" }}>
                    <div className="empty-sub">No target set yet</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
