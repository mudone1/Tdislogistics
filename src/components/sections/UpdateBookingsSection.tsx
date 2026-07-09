"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { AIRLINES } from "@/lib/constants";
import { formatNaira } from "@/lib/utils";
import type { BookingType, PaymentStatus } from "@/lib/types";

export default function UpdateBookingsSection() {
  const { clients, currentUser, saveBookingUpdate, bookingUpdates } = useApp();

  const [clientQuery, setClientQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [airline, setAirline] = useState(AIRLINES[0].name);
  const [amount, setAmount] = useState("");
  const [pnr, setPnr] = useState("");
  const [bookingType, setBookingType] = useState<BookingType>("Issued");
  const [status, setStatus] = useState<PaymentStatus>("Pending");

  const suggestions = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [clientQuery, clients]);

  const recent = useMemo(() => [...bookingUpdates].slice(-6).reverse(), [bookingUpdates]);

  function reset() {
    setClientQuery("");
    setSelectedClient("");
    setAmount("");
    setPnr("");
    setBookingType("Issued");
    setStatus("Pending");
  }

  function handleSave() {
    const clientName = selectedClient || clientQuery.trim();
    const amt = parseFloat(amount);
    if (!clientName || isNaN(amt) || amt <= 0) return;

    const ok = saveBookingUpdate({
      client: clientName,
      airline,
      amount: amt,
      amountPaid: status === "Paid" ? amt : 0,
      status,
      bookingType,
      pnr: pnr.trim(),
      initiatedBy: currentUser?.name || "Unknown",
      updatedBy: currentUser?.name || "Unknown",
    });
    if (ok) reset();
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Update Bookings</div>

      <div className="dash-two-col booking-update-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">New Booking Entry</span>
          </div>
          <div className="card-body">
            <div className="form-group" style={{ marginBottom: 14, position: "relative" }}>
              <label>Client Name</label>
              <input
                type="text"
                placeholder="Search or type a new client name…"
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setSelectedClient("");
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                autoComplete="off"
              />
              <div className={`suggestion-box ${showSuggestions && suggestions.length ? "show" : ""}`}>
                {suggestions.map((c) => (
                  <div
                    key={c.id}
                    className="suggestion-item"
                    onMouseDown={() => {
                      setSelectedClient(c.name);
                      setClientQuery(c.name);
                      setShowSuggestions(false);
                    }}
                  >
                    <span className="suggestion-name">{c.name}</span>
                    <span className="suggestion-detail">{c.phone}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Airline</label>
                <select value={airline} onChange={(e) => setAirline(e.target.value)}>
                  {AIRLINES.map((a) => (
                    <option key={a.code} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Booking Amount (₦)</label>
                <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>PNR / Reference</label>
                <input type="text" value={pnr} onChange={(e) => setPnr(e.target.value)} placeholder="e.g. AB12CD" />
              </div>
              <div className="form-group">
                <label>Booking Type</label>
                <select value={bookingType} onChange={(e) => setBookingType(e.target.value as BookingType)}>
                  <option value="Issued">Issued</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Payment Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
                <option value="Pending">Pending</option>
                <option value="Paid">Paid</option>
                <option value="Partial">Partial</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            <button className="search-btn" onClick={handleSave}>
              💾 Save Booking
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recently Updated</span>
          </div>
          <div className="card-body">
            {recent.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 8px" }}>
                <div className="empty-icon">🧾</div>
                <div className="empty-title">No bookings yet</div>
                <div className="empty-sub">New entries will appear here</div>
              </div>
            ) : (
              recent.map((b, i) => (
                <div className="unpaid-row" key={i}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>{b.client}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)" }}>
                      {b.airline} · {b.pnr || "no ref"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--navy-dark)" }}>{formatNaira(b.amount)}</div>
                    <span className={`status-badge ${b.status.toLowerCase()}`}>{b.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
