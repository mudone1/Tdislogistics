"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useApp, getClientAmountOwed } from "@/lib/store";
import { formatNaira } from "@/lib/utils";

export default function DashboardSection() {
  const { balances, clients, bookingUpdates, settings } = useApp();

  const stats = useMemo(() => {
    const totalBalance = balances.reduce((s, b) => s + b.balance, 0);
    const criticalAirlines = balances.filter((b) => b.balance < settings.thresholdCritical);
    const lowAirlines = balances.filter((b) => b.balance >= settings.thresholdCritical && b.balance < settings.thresholdLow);
    const pending = bookingUpdates.filter((b) => b.status === "Pending" || b.status === "Partial");
    const totalOwed = pending.reduce((s, b) => {
      const paid = b.amountPaid || 0;
      return s + Math.max(0, b.amount - paid);
    }, 0);
    const totalRevenue = bookingUpdates.filter((b) => b.status !== "Cancelled").reduce((s, b) => s + b.amount, 0);
    const uniqueClientsWithDebt = new Set(
      clients.filter((c) => getClientAmountOwed(bookingUpdates, c.name) > 0).map((c) => c.id)
    );

    return {
      totalBalance,
      criticalAirlines,
      lowAirlines,
      pendingCount: pending.length,
      totalOwed,
      totalRevenue,
      totalBookings: bookingUpdates.length,
      totalClients: clients.length,
      clientsWithDebtCount: uniqueClientsWithDebt.size,
    };
  }, [balances, clients, bookingUpdates, settings]);

  // Simple last-7-record bar trend of booking amounts (bounded, no external chart lib needed)
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="section-title">Operations Dashboard</div>

      <div className="dash-kpi-grid">
        <div className="dash-kpi-card">
          <div className="dash-kpi-icon">💰</div>
          <div className="dash-kpi-value">{formatNaira(stats.totalBalance)}</div>
          <div className="dash-kpi-label">Total Airline Balance</div>
        </div>
        <div className={`dash-kpi-card ${stats.criticalAirlines.length ? "alert" : ""}`}>
          <div className="dash-kpi-icon">🔴</div>
          <div className="dash-kpi-value">{stats.criticalAirlines.length}</div>
          <div className="dash-kpi-label">Critical Airlines</div>
        </div>
        <div className={`dash-kpi-card ${stats.lowAirlines.length ? "warn" : ""}`}>
          <div className="dash-kpi-icon">🟡</div>
          <div className="dash-kpi-value">{stats.lowAirlines.length}</div>
          <div className="dash-kpi-label">Low Airlines</div>
        </div>
        <div className="dash-kpi-card">
          <div className="dash-kpi-icon">👤</div>
          <div className="dash-kpi-value">{stats.totalClients}</div>
          <div className="dash-kpi-label">Total Clients</div>
        </div>
        <div className="dash-kpi-card">
          <div className="dash-kpi-icon">🧾</div>
          <div className="dash-kpi-value">{stats.totalBookings}</div>
          <div className="dash-kpi-label">Total Bookings</div>
        </div>
        <div className={`dash-kpi-card ${stats.totalOwed ? "warn" : "success"}`}>
          <div className="dash-kpi-icon">⏳</div>
          <div className="dash-kpi-value">{formatNaira(stats.totalOwed)}</div>
          <div className="dash-kpi-label">Outstanding Payments</div>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Booking Value</span>
          </div>
          <div className="card-body">
            {recentBars.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <div className="empty-icon">📊</div>
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
                <div className="empty-icon">✅</div>
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
              <div className="empty-icon">✈️</div>
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
