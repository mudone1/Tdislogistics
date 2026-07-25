"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import { SALES_REPORT_AIRLINES, salesReportAirlineLabel } from "@/lib/salesReportAirlines";
import Modal from "@/components/ui/Modal";

interface ReportListItem {
  id: string;
  airline: string;
  reportDate: string;
  grandTotal: number;
  confidence: number;
  status: "PENDING_VERIFICATION" | "SAVED";
  createdAt: string;
  verifiedAt: string | null;
  isDuplicateSuperseded: boolean;
  totalTicketsIssued: number | null;
}

interface ReportDetail {
  id: string;
  airline: string;
  reportDate: string;
  grandTotal: number;
  confidence: number;
  reportText: string;
  status: "PENDING_VERIFICATION" | "SAVED";
  createdAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  originalFilename: string | null;
  staffTotals: { staffName: string; amount: number; transactionCount: number }[];
  analytics: {
    totalTicketsIssued: number;
    totalTicketsVoided: number;
    totalVoidAmount: number;
    grossSalesAmount: number;
    netSalesAmount: number;
  } | null;
}

const STATUS_LABEL: Record<string, string> = { PENDING_VERIFICATION: "Pending", SAVED: "Saved" };

export default function SalesReportsSection() {
  const { currentUser } = useApp();
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [airlineFilter, setAirlineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<"saving" | "discarding" | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (airlineFilter) params.set("airline", airlineFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/sales-reports/history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReports(data.reports);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [airlineFilter, statusFilter, offset]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/sales-reports/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmReport() {
    if (!detail) return;
    setActionBusy("saving");
    try {
      const res = await fetch(`/api/sales-reports/${detail.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifiedBy: currentUser?.name || "Admin Dashboard" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(null);
      loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  }

  async function discardReport() {
    if (!detail) return;
    setActionBusy("discarding");
    try {
      const res = await fetch(`/api/sales-reports/${detail.id}/discard`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDetail(null);
      loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  }

  const pendingCount = reports.filter((r) => r.status === "PENDING_VERIFICATION").length;
  const savedTotal = reports.filter((r) => r.status === "SAVED").reduce((sum, r) => sum + r.grandTotal, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Sales Reports</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16, marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Reports (this page)</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--amber, #d97706)" }}>
          <div className="stat-value" style={{ color: "var(--amber, #d97706)" }}>{pendingCount}</div>
          <div className="stat-label">Pending Verification</div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--green)" }}>
          <div className="stat-value" style={{ color: "var(--green)" }}>{formatNaira(savedTotal)}</div>
          <div className="stat-label">Saved Sales (this page)</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">📄 Report History</span>
        </div>
        <div style={{ display: "flex", gap: 12, padding: "12px 20px", flexWrap: "wrap" }}>
          <select
            value={airlineFilter}
            onChange={(e) => {
              setOffset(0);
              setAirlineFilter(e.target.value);
            }}
          >
            <option value="">All Airlines</option>
            {SALES_REPORT_AIRLINES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setOffset(0);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">All Statuses</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
            <option value="SAVED">Saved</option>
          </select>
        </div>

        {error && (
          <div className="empty-state" style={{ color: "var(--red)" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <div className="empty-sub">Loading…</div>
          </div>
        ) : reports.length === 0 ? (
          <div className="empty-state">
            <div className="empty-sub">No reports match those filters</div>
          </div>
        ) : (
          <div style={{ padding: 0 }}>
            {reports.map((r) => (
              <button
                key={r.id}
                className="unpaid-row"
                style={{ padding: "10px 20px", width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "none" }}
                onClick={() => openDetail(r.id)}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>
                    {salesReportAirlineLabel(r.airline)} — {r.reportDate}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)" }}>
                    {r.totalTicketsIssued != null ? `${r.totalTicketsIssued} tickets · ` : ""}
                    {r.isDuplicateSuperseded ? "Superseded · " : ""}
                    Confidence {Math.round(r.confidence * 100)}%
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={`status-badge ${r.status === "SAVED" ? "paid" : "pending"}`}>{STATUS_LABEL[r.status]}</span>
                  <span style={{ fontWeight: 700, color: "var(--navy-dark)" }}>{formatNaira(r.grandTotal)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px" }}>
          <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}>
            ← Previous
          </button>
          <span style={{ fontSize: 12, color: "var(--gray-400)" }}>
            {total === 0 ? "0" : `${offset + 1}-${Math.min(offset + LIMIT, total)}`} of {total}
          </span>
          <button disabled={offset + LIMIT >= total} onClick={() => setOffset((o) => o + LIMIT)}>
            Next →
          </button>
        </div>
      </div>

      <Modal
        open={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title="Sales Report Detail"
        maxWidth={640}
        footer={
          detail && detail.status === "PENDING_VERIFICATION" ? (
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={confirmReport} disabled={!!actionBusy}>
                {actionBusy === "saving" ? "Saving…" : "Save Report"}
              </button>
              <button onClick={discardReport} disabled={!!actionBusy}>
                {actionBusy === "discarding" ? "Discarding…" : "Discard"}
              </button>
            </div>
          ) : undefined
        }
      >
        {detailLoading || !detail ? (
          <div className="empty-state">
            <div className="empty-sub">Loading…</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={`status-badge ${detail.status === "SAVED" ? "paid" : "pending"}`}>{STATUS_LABEL[detail.status]}</span>
              <span style={{ fontSize: 12, color: "var(--gray-400)" }}>Confidence {Math.round(detail.confidence * 100)}%</span>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, background: "var(--gray-100, #f5f5f5)", padding: 14, borderRadius: 8 }}>
              {detail.reportText}
            </pre>
            {detail.analytics && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                <div className="stat-card">
                  <div className="stat-value">{detail.analytics.totalTicketsIssued}</div>
                  <div className="stat-label">Tickets</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{detail.analytics.totalTicketsVoided}</div>
                  <div className="stat-label">Voided</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ fontSize: 15 }}>{formatNaira(detail.analytics.netSalesAmount)}</div>
                  <div className="stat-label">Net Sales</div>
                </div>
              </div>
            )}
            {detail.originalFilename && (
              <div style={{ fontSize: 12, color: "var(--gray-400)" }}>Source: {detail.originalFilename}</div>
            )}
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
