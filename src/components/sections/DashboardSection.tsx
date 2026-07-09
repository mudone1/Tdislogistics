"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useApp, getClientAmountOwed, revenueInWindow } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import { Icon } from "@/lib/icon-map";
import type { SectionId } from "@/lib/types";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function DashboardSection({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { balances, clients, bookingUpdates, settings, isSyncing, lastSyncedAt, syncNow } = useApp();

  const stats = useMemo(() => {
    const totalBalance = balances.reduce((s, b) => s + b.balance, 0);
    const criticalAirlines = balances.filter((b) => b.balance < settings.thresholdCritical);
    const lowAirlines = balances.filter((b) => b.balance >= settings.thresholdCritical && b.balance < settings.thresholdLow);
    const availableToIssue = bookingUpdates.filter((b) => b.bookingType === "On Hold" || b.status === "Pending").length;
    const pending = bookingUpdates.filter((b) => b.status === "Pending" || b.status === "Partial");
    const totalOwed = pending.reduce((s, b) => s + Math.max(0, b.amount - (b.amountPaid || 0)), 0);
    const dailySales = revenueInWindow(bookingUpdates, 1);
    const weeklySales = revenueInWindow(bookingUpdates, 7);
    return {
      totalBalance,
      criticalAirlines,
      lowAirlines,
      availableToIssue,
      pendingCount: pending.length,
      totalOwed,
      totalBookings: bookingUpdates.length,
      totalClients: clients.length,
      dailySales,
      weeklySales,
    };
  }, [balances, clients, bookingUpdates, settings]);

  const recentBars = useMemo(() => {
    const last = bookingUpdates.slice(-7);
    const max = Math.max(1, ...last.map((b) => b.amount));
    return last.map((b) => ({
      label: new Date(b.createdAt).toLocaleDateString("en-NG", { day: "2-digit", month: "short" }),
      pct: Math.round((b.amount / max) * 100),
      color: b.status === "Paid" ? "green" : b.status === "Cancelled" ? "red" : "gold",
    }));
  }, [bookingUpdates]);

  const topUnpaid = useMemo(
    () =>
      [...bookingUpdates]
        .filter((b) => b.status !== "Cancelled" && b.status !== "Paid")
        .sort((a, b) => b.amount - (b.amountPaid || 0) - (a.amount - (a.amountPaid || 0)))
        .slice(0, 5),
    [bookingUpdates]
  );

  const clientsWithDebt = useMemo(
    () => clients.filter((c) => getClientAmountOwed(bookingUpdates, c.name) > 0).length,
    [clients, bookingUpdates]
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          Operations Dashboard
        </div>
        <button className="sync-btn" onClick={syncNow} disabled={isSyncing}>
          <Icon name="refresh-cw" size={14} className={isSyncing ? "sync-spin" : ""} />
          {isSyncing ? "Syncing…" : "Manual Sync"}
        </button>
      </div>
      {lastSyncedAt && (
        <p style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 0, marginBottom: 20 }}>
          Last synced {new Date(lastSyncedAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {/* ─── Priority quick-access grid ─── */}
      <motion.div className="priority-grid" variants={container} initial="hidden" animate="show">
        <motion.button variants={item} className="priority-tile" onClick={() => onNavigate("balances")}>
          <div className="priority-tile-icon">
            <Icon name="wallet" size={18} />
          </div>
          <div className="priority-tile-title">Airline Wallet Balances</div>
          <div className="priority-tile-value">{formatNaira(stats.totalBalance)}</div>
          <div className="priority-tile-sub">
            {stats.criticalAirlines.length + stats.lowAirlines.length > 0
              ? `${stats.criticalAirlines.length + stats.lowAirlines.length} need attention`
              : "All balances healthy"}
          </div>
        </motion.button>

        <motion.button variants={item} className="priority-tile" onClick={() => onNavigate("availableTkt")}>
          <div className="priority-tile-icon">
            <Icon name="ticket" size={18} />
          </div>
          <div className="priority-tile-title">Available TKT to Issue</div>
          <div className="priority-tile-value">{stats.availableToIssue}</div>
          <div className="priority-tile-sub">Tickets pending issuance</div>
        </motion.button>

        <motion.div variants={item} className="priority-tile disabled">
          <span className="priority-tile-badge">Coming soon</span>
          <div className="priority-tile-icon">
            <Icon name="file-bar-chart" size={18} />
          </div>
          <div className="priority-tile-title">Report Generator</div>
          <div className="priority-tile-sub">Generate custom operational reports</div>
        </motion.div>

        <motion.div variants={item} className="priority-tile disabled">
          <span className="priority-tile-badge">Coming soon</span>
          <div className="priority-tile-icon">
            <Icon name="sparkles" size={18} />
          </div>
          <div className="priority-tile-title">AI Operations Assistant</div>
          <div className="priority-tile-sub">Ask questions about your data</div>
        </motion.div>

        <motion.div variants={item} className="priority-tile">
          <div className="priority-tile-icon">
            <Icon name="calendar-days" size={18} />
          </div>
          <div className="priority-tile-title">Daily Sales</div>
          <div className="priority-tile-value">{formatNaira(stats.dailySales)}</div>
          <div className="priority-tile-sub">Last 24 hours</div>
        </motion.div>

        <motion.div variants={item} className="priority-tile">
          <div className="priority-tile-icon">
            <Icon name="calendar-range" size={18} />
          </div>
          <div className="priority-tile-title">Weekly Sales</div>
          <div className="priority-tile-value">{formatNaira(stats.weeklySales)}</div>
          <div className="priority-tile-sub">Last 7 days</div>
        </motion.div>

        <motion.div variants={item} className="priority-tile disabled">
          <span className="priority-tile-badge">Coming soon</span>
          <div className="priority-tile-icon">
            <Icon name="clock" size={18} />
          </div>
          <div className="priority-tile-title">Recent Reports</div>
          <div className="priority-tile-sub">Your last generated reports</div>
        </motion.div>

        <motion.button variants={item} className="priority-tile" onClick={() => onNavigate("clients")}>
          <div className="priority-tile-icon">
            <Icon name="users" size={18} />
          </div>
          <div className="priority-tile-title">Clients With Debt</div>
          <div className="priority-tile-value">{clientsWithDebt}</div>
          <div className="priority-tile-sub">{formatNaira(stats.totalOwed)} outstanding</div>
        </motion.button>
      </motion.div>

      <div className="dash-two-col">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Booking Value</span>
          </div>
          <div className="card-body">
            {recentBars.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <Icon name="inbox" size={32} className="empty-icon" />
                <div className="empty-sub">No bookings recorded yet</div>
              </div>
            ) : (
              <div className="bar-chart-wrap">
                {recentBars.map((b, i) => (
                  <div className="bar-col" key={i}>
                    <div className={`bar ${b.color}`} style={{ height: `${Math.max(4, b.pct)}%` }} />
                    <div className="bl">{b.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Top Unpaid Bookings</span>
          </div>
          <div className="card-body">
            {topUnpaid.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <Icon name="check-circle" size={32} className="empty-icon" />
                <div className="empty-sub">Everything is settled</div>
              </div>
            ) : (
              topUnpaid.map((b, i) => (
                <div className="unpaid-row" key={i}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{b.client}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)" }}>{b.airline}</div>
                  </div>
                  <span className="unpaid-owe">{formatNaira(b.amount - (b.amountPaid || 0))}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Airline Balance Watch</span>
        </div>
        <div className="card-body">
          {stats.criticalAirlines.length === 0 && stats.lowAirlines.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 8px" }}>
              <Icon name="check-circle" size={32} className="empty-icon" />
              <div className="empty-sub">All airline balances are healthy</div>
            </div>
          ) : (
            [...stats.criticalAirlines, ...stats.lowAirlines].map((b, i) => (
              <div className="critical-airline-row" key={i}>
                <div style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{b.airline}</div>
                <span
                  className="unpaid-owe"
                  style={
                    b.balance < settings.thresholdCritical
                      ? undefined
                      : { background: "var(--amber-light)", color: "var(--amber)" }
                  }
                >
                  {formatNaira(b.balance)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}
