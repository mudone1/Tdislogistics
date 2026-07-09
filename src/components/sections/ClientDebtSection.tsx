"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp, getGroupBalance } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import { DEBT_BANKS } from "@/lib/constants";
import Modal from "@/components/ui/Modal";
import type { DebtTxType, DebtTxStatus } from "@/lib/types";

export default function ClientDebtSection() {
  const { debtGroups, addDebtGroup, addDebtTransaction, markDebtTxPaid, deleteDebtTx, deleteDebtGroup, showToast } = useApp();
  const [search, setSearch] = useState("");
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupBill, setGroupBill] = useState("");

  const [txGroupId, setTxGroupId] = useState<string | null>(null);
  const [txDesc, setTxDesc] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txType, setTxType] = useState<DebtTxType>("charge");
  const [txStatus, setTxStatus] = useState<DebtTxStatus>("pending");

  const [payGroupId, setPayGroupId] = useState<string | null>(null);
  const [payBank, setPayBank] = useState("zenith");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return debtGroups;
    return debtGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [search, debtGroups]);

  const kpis = useMemo(() => {
    const totalOwed = debtGroups.reduce((s, g) => s + Math.max(0, getGroupBalance(g)), 0);
    const pending = debtGroups.filter((g) => getGroupBalance(g) > 0).length;
    const paid = debtGroups.filter((g) => getGroupBalance(g) <= 0).length;
    return { groups: debtGroups.length, totalOwed, pending, paid };
  }, [debtGroups]);

  const duplicateWarning = useMemo(
    () => groupName.trim() !== "" && debtGroups.some((g) => g.name.trim().toLowerCase() === groupName.trim().toLowerCase()),
    [groupName, debtGroups]
  );

  function saveGroup() {
    const bill = parseFloat(groupBill);
    if (!groupName.trim() || isNaN(bill) || bill < 0 || duplicateWarning) {
      showToast("Please check the group name and bill amount", "warn");
      return;
    }
    const ok = addDebtGroup(groupName.trim(), bill);
    if (ok) {
      setGroupName("");
      setGroupBill("");
      setAddGroupOpen(false);
    }
  }

  function saveTx() {
    const amount = parseFloat(txAmount);
    if (!txGroupId || !txDesc.trim() || isNaN(amount) || amount <= 0) {
      showToast("Please fill in description and a valid amount", "warn");
      return;
    }
    addDebtTransaction(txGroupId, txDesc.trim(), amount, txType, txStatus);
    setTxDesc("");
    setTxAmount("");
    setTxType("charge");
    setTxStatus("pending");
    setTxGroupId(null);
  }

  const payGroup = payGroupId ? debtGroups.find((g) => g.id === payGroupId) : null;
  const payBalance = payGroup ? getGroupBalance(payGroup) : 0;
  const bank = DEBT_BANKS[payBank];
  const payMessage = payGroup ? `${payBalance.toLocaleString("en-NG")}\n${bank.acct}\n${bank.holder}\n${bank.name}` : "";

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Client Debt Tracker</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 22 }}>
            {kpis.groups}
          </div>
          <div className="stat-label">Client Groups</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--red)" }}>
          <div className="stat-value" style={{ fontSize: 22, color: "var(--red)" }}>
            {formatNaira(kpis.totalOwed)}
          </div>
          <div className="stat-label">Total Outstanding</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--amber)" }}>
          <div className="stat-value" style={{ fontSize: 22, color: "var(--amber)" }}>
            {kpis.pending}
          </div>
          <div className="stat-label">Pending Groups</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--green)" }}>
          <div className="stat-value" style={{ fontSize: 22, color: "var(--green)" }}>
            {kpis.paid}
          </div>
          <div className="stat-label">Fully Paid</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          type="text"
          placeholder="🔍 Search group name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
        <button className="add-client-btn" onClick={() => setAddGroupOpen(true)}>
          ➕ Add Client Group
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📒</div>
          <div className="empty-title">No client groups yet</div>
          <div className="empty-sub">Add a group to start tracking outstanding balances</div>
        </div>
      ) : (
        filtered.map((g) => {
          const balance = getGroupBalance(g);
          return (
            <div className="card" key={g.id} style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">{g.name}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    className="unpaid-owe"
                    style={balance <= 0 ? { background: "var(--green-light)", color: "var(--green)" } : undefined}
                  >
                    {formatNaira(balance)}
                  </span>
                  <button className="action-link" onClick={() => setTxGroupId(g.id)}>
                    + Transaction
                  </button>
                  <button className="action-link" onClick={() => setPayGroupId(g.id)}>
                    Payment Info
                  </button>
                  <button className="action-link" style={{ color: "var(--red)" }} onClick={() => deleteDebtGroup(g.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {g.transactions.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: "var(--gray-400)" }}>
                    Opening bill: {formatNaira(g.initialBill)}. No transactions logged yet.
                  </div>
                ) : (
                  <div className="clients-table" style={{ border: "none" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.transactions.map((t) => (
                          <tr key={t.id}>
                            <td>{t.date}</td>
                            <td>{t.desc}</td>
                            <td style={{ textTransform: "capitalize" }}>{t.type}</td>
                            <td>{formatNaira(t.amount)}</td>
                            <td>
                              <span className={`status-badge ${t.status === "paid" ? "paid" : "pending"}`}>{t.status}</span>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 8 }}>
                                {t.status !== "paid" && (
                                  <button className="action-link" onClick={() => markDebtTxPaid(g.id, t.id)}>
                                    Mark Paid
                                  </button>
                                )}
                                <button className="action-link" style={{ color: "var(--red)" }} onClick={() => deleteDebtTx(g.id, t.id)}>
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      <Modal
        open={addGroupOpen}
        onClose={() => setAddGroupOpen(false)}
        title="➕ Add Client Group"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAddGroupOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveGroup}>
              Save Group
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Group Name *</label>
          <input type="text" placeholder="e.g. Okafor Family, ABC Corp…" value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus />
          {duplicateWarning && (
            <div style={{ marginTop: 6, padding: "7px 10px", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 6, fontSize: 12, color: "#856404", fontWeight: 600 }}>
              ⚠️ This group already exists. Please use a unique name.
            </div>
          )}
        </div>
        <div className="form-group">
          <label>Initial Bill Amount (₦) *</label>
          <input type="number" min={0} placeholder="e.g. 150000" value={groupBill} onChange={(e) => setGroupBill(e.target.value)} />
        </div>
        <p style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 10 }}>This sets the opening balance. You can add more transactions later.</p>
      </Modal>

      <Modal
        open={!!txGroupId}
        onClose={() => setTxGroupId(null)}
        title={`Add Transaction${txGroupId ? " — " + (debtGroups.find((g) => g.id === txGroupId)?.name ?? "") : ""}`}
        maxWidth={480}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setTxGroupId(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveTx}>
              Save Transaction
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Description</label>
          <input type="text" value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="e.g. Lagos–Abuja flight" autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Amount (₦)</label>
            <input type="number" min={0} value={txAmount} onChange={(e) => setTxAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={txType} onChange={(e) => setTxType(e.target.value as DebtTxType)}>
              <option value="charge">Charge</option>
              <option value="payment">Payment</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Status</label>
          <select value={txStatus} onChange={(e) => setTxStatus(e.target.value as DebtTxStatus)}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={!!payGroupId}
        onClose={() => setPayGroupId(null)}
        title="Payment Details"
        footer={
          <button
            className="btn-primary"
            onClick={() => {
              navigator.clipboard?.writeText(payMessage).then(() => showToast("✓ Message copied!", "success"));
            }}
          >
            Copy Message
          </button>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Bank</label>
          <select value={payBank} onChange={(e) => setPayBank(e.target.value)}>
            {Object.entries(DEBT_BANKS).map(([key, b]) => (
              <option key={key} value={key}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <pre
          style={{
            background: "var(--off-white)",
            border: "1.5px solid var(--gray-200)",
            borderRadius: 10,
            padding: 14,
            fontSize: 13,
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
          }}
        >
          {payMessage}
        </pre>
      </Modal>
    </motion.div>
  );
}
