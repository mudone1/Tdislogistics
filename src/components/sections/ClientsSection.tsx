"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp, getClientAmountOwed, getClientTotalSpent } from "@/lib/store";
import { formatNaira, initials } from "@/lib/utils";
import Modal from "@/components/ui/Modal";

export default function ClientsSection() {
  const { clients, bookingUpdates, addClient, updateClientPayment, showToast } = useApp();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [payClient, setPayClient] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [preference, setPreference] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q));
  }, [search, clients]);

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => showToast("✓ Copied to clipboard", "success"));
  }

  function saveClient() {
    if (!name.trim() || !phone.trim()) {
      showToast("Name and phone are required", "warn");
      return;
    }
    addClient({ name: name.trim(), phone: phone.trim(), email: email.trim(), preference: preference.trim() });
    setName("");
    setPhone("");
    setEmail("");
    setPreference("");
    setAddOpen(false);
  }

  const unpaidBookingsForPay = useMemo(() => {
    if (!payClient) return [];
    return bookingUpdates
      .map((b, i) => ({ ...b, index: i }))
      .filter((b) => b.client === payClient && b.status !== "Paid" && b.status !== "Cancelled");
  }, [payClient, bookingUpdates]);

  function savePayment() {
    const val = parseFloat(payAmount);
    if (isNaN(val) || val <= 0 || unpaidBookingsForPay.length === 0) return;
    // Apply payment to the oldest outstanding booking first.
    updateClientPayment(unpaidBookingsForPay[0].index, val);
    setPayAmount("");
    setPayClient(null);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Clients</div>

      <div className="clients-toolbar">
        <div className="search-input-wrap">
          <span className="input-icon">🔍</span>
          <input
            type="text"
            placeholder="Search clients by name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 38 }}
          />
        </div>
        <button className="add-client-btn" onClick={() => setAddOpen(true)}>
          ➕ Add Client
        </button>
      </div>

      <div className="clients-table">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Preference</th>
              <th>Total Spent</th>
              <th>Owed</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--gray-400)" }}>
                  No clients found
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const owed = getClientAmountOwed(bookingUpdates, c.name);
                const spent = getClientTotalSpent(bookingUpdates, c.name);
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="client-name-cell">
                        <span className="client-avatar">{initials(c.name)}</span>
                        {c.name}
                      </div>
                    </td>
                    <td>
                      {c.phone}{" "}
                      <button className="copy-icon" onClick={() => copy(c.phone)} title="Copy phone">
                        📋
                      </button>
                    </td>
                    <td>
                      {c.email}{" "}
                      {c.email && (
                        <button className="copy-icon" onClick={() => copy(c.email)} title="Copy email">
                          📋
                        </button>
                      )}
                    </td>
                    <td>{c.preference ? <span className="pref-tag">{c.preference}</span> : "—"}</td>
                    <td>{formatNaira(spent)}</td>
                    <td>
                      {owed > 0 ? <span className="unpaid-owe">{formatNaira(owed)}</span> : formatNaira(0)}
                    </td>
                    <td>
                      {owed > 0 && (
                        <button className="action-link" onClick={() => setPayClient(c.name)}>
                          Record Payment
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="➕ Add Client"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveClient}>
              Save Client
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Full Name *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Phone *</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Preference</label>
          <input type="text" placeholder="e.g. Window seat, Economy" value={preference} onChange={(e) => setPreference(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={!!payClient}
        onClose={() => setPayClient(null)}
        title={`Record Payment — ${payClient ?? ""}`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setPayClient(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={savePayment}>
              Save Payment
            </button>
          </>
        }
      >
        <p style={{ fontSize: 12, color: "var(--gray-400)", marginBottom: 14 }}>
          Applies to the oldest outstanding booking first. Total outstanding:{" "}
          <strong style={{ color: "var(--red)" }}>
            {formatNaira(unpaidBookingsForPay.reduce((s, b) => s + (b.amount - (b.amountPaid || 0)), 0))}
          </strong>
        </p>
        <div className="form-group">
          <label>Payment Amount (₦)</label>
          <input type="number" className="balance-input-big" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
        </div>
      </Modal>
    </motion.div>
  );
}
