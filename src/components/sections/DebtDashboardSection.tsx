"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useApp, getGroupBalance } from "@/lib/store";
import { formatNaira } from "@/lib/utils";

export default function DebtDashboardSection() {
  const { debtGroups } = useApp();

  const kpis = useMemo(() => {
    const totalOwed = debtGroups.reduce((s, g) => s + Math.max(0, getGroupBalance(g)), 0);
    const totalWeOwe = debtGroups.reduce((s, g) => s + Math.max(0, -getGroupBalance(g)), 0);
    const allTx = debtGroups.flatMap((g) => g.transactions);
    const totalCharged = allTx.filter((t) => t.type === "charge").reduce((s, t) => s + t.amount, 0);
    const totalPaid = allTx.filter((t) => t.type === "payment" || t.status === "paid").reduce((s, t) => s + t.amount, 0);
    return { totalOwed, totalWeOwe, totalCharged, totalPaid, groups: debtGroups.length, transactions: allTx.length };
  }, [debtGroups]);

  const topDebtors = useMemo(
    () =>
      [...debtGroups]
        .map((g) => ({ name: g.name, balance: getGroupBalance(g) }))
        .filter((g) => g.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5),
    [debtGroups]
  );

  const statusBreakdown = useMemo(() => {
    const allTx = debtGroups.flatMap((g) => g.transactions);
    const pending = allTx.filter((t) => t.status === "pending").length;
    const paid = allTx.filter((t) => t.status === "paid").length;
    return { pending, paid, total: allTx.length || 1 };
  }, [debtGroups]);

  const recentTx = useMemo(
    () =>
      debtGroups
        .flatMap((g) => g.transactions.map((t) => ({ ...t, group: g.name })))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [debtGroups]
  );

  const settledGroups = useMemo(
    () => debtGroups.filter((g) => getGroupBalance(g) <= 0 && g.transactions.length > 0).slice(0, 6),
    [debtGroups]
  );

  const mostActive = useMemo(
    () =>
      [...debtGroups]
        .sort((a, b) => b.transactions.length - a.transactions.length)
        .slice(0, 6)
        .filter((g) => g.transactions.length > 0),
    [debtGroups]
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Debt Dashboard</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16, marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-value">{kpis.groups}</div>
          <div className="stat-label">Client Groups</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--red)" }}>
          <div className="stat-value" style={{ color: "var(--red)" }}>{formatNaira(kpis.totalOwed)}</div>
          <div className="stat-label">Total Owed to Us</div>
        </div>
        <div className="stat-card" style={{ borderColor: "#4f46e5" }}>
          <div className="stat-value" style={{ color: "#4f46e5" }}>{formatNaira(kpis.totalWeOwe)}</div>
          <div className="stat-label">We Owe Clients</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--green)" }}>
          <div className="stat-value" style={{ color: "var(--green)" }}>{formatNaira(kpis.totalPaid)}</div>
          <div className="stat-label">Total Collected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{kpis.transactions}</div>
          <div className="stat-label">Transactions</div>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="card">
          <div className="card-header">
            <span className="card-title">🏆 Top Debtors</span>
          </div>
          <div style={{ padding: 0 }}>
            {topDebtors.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <div className="empty-sub">No outstanding debtors</div>
              </div>
            ) : (
              topDebtors.map((d, i) => (
                <div className="unpaid-row" key={i} style={{ padding: "10px 20px" }}>
                  <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{d.name}</span>
                  <span className="unpaid-owe">{formatNaira(d.balance)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">📋 Status Breakdown</span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
              <span>Paid</span>
              <span>{statusBreakdown.paid}</span>
            </div>
            <div className="goal-bar-bg">
              <div className="goal-bar achieved" style={{ width: `${(statusBreakdown.paid / statusBreakdown.total) * 100}%` }} />
            </div>
            <div style={{ margin: "14px 0 10px", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
              <span>Pending</span>
              <span>{statusBreakdown.pending}</span>
            </div>
            <div className="goal-bar-bg">
              <div className="goal-bar" style={{ width: `${(statusBreakdown.pending / statusBreakdown.total) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="card">
          <div className="card-header">
            <span className="card-title">🕐 Recent Transactions</span>
          </div>
          <div style={{ padding: 0 }}>
            {recentTx.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <div className="empty-sub">No transactions yet</div>
              </div>
            ) : (
              recentTx.map((t) => (
                <div className="unpaid-row" key={t.id} style={{ padding: "10px 20px" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{t.group}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)" }}>{t.desc} · {t.date}</div>
                  </div>
                  <span className={`status-badge ${t.status === "paid" ? "paid" : "pending"}`}>{formatNaira(t.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">✅ Recently Settled</span>
          </div>
          <div style={{ padding: 16 }}>
            {settledGroups.length === 0 ? (
              <div className="empty-sub" style={{ textAlign: "center" }}>
                No fully settled groups yet
              </div>
            ) : (
              settledGroups.map((g) => (
                <div className="unpaid-row" key={g.id}>
                  <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{g.name}</span>
                  <span className="status-badge paid">Settled</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">🔁 Most Active Groups</span>
        </div>
        <div style={{ padding: 0 }}>
          {mostActive.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 8px" }}>
              <div className="empty-sub">No activity yet</div>
            </div>
          ) : (
            mostActive.map((g) => (
              <div className="unpaid-row" key={g.id} style={{ padding: "10px 20px" }}>
                <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: "var(--gray-400)" }}>{g.transactions.length} transactions</span>
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}
