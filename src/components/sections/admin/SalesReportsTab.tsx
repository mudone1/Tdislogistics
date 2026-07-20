"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";

const AIRLINE_OPTIONS = [
  { value: "AERO", label: "Aero" },
  { value: "AIRPEACE", label: "Airpeace" },
  { value: "IBOM", label: "Ibom" },
  { value: "ARIK", label: "Arik" },
];

interface GeneratedReport {
  reportId: string;
  airline: string;
  reportDate: string;
  reportText: string;
  grandTotal: number;
  confidence: number;
  needsReview: boolean;
  confidenceReasons: string[];
  staffTotals: { staffName: string; amount: number; transactionCount: number }[];
  ticketCount: number;
  transactionsIncludedCount: number;
  transactionsIgnoredCount: number;
  unknownStaff: string[];
  warnings: string[];
}

export default function SalesReportsTab() {
  const { showToast } = useApp();
  const [airline, setAirline] = useState(AIRLINE_OPTIONS[0].value);
  const [files, setFiles] = useState<FileList | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  async function generate() {
    if (!files || files.length === 0) {
      showToast("Choose at least one Excel file first", "warn");
      return;
    }
    setGenerating(true);
    setReport(null);
    setCorrections({});
    try {
      const form = new FormData();
      form.set("airline", airline);
      Array.from(files).forEach((f) => form.append("files", f));

      const res = await fetch("/api/sales-reports/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setReport(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Generation failed", "warn");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!report) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-reports/${report.reportId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifiedBy: "admin", staffCorrections: corrections }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      showToast("✓ Report saved", "success");
      setReport(null);
      setFiles(null);
      setCorrections({});
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "warn");
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!report) return;
    try {
      await fetch(`/api/sales-reports/${report.reportId}/discard`, { method: "POST" });
    } catch {
      /* best-effort — the report just stays PENDING_VERIFICATION, harmless */
    }
    setReport(null);
    setCorrections({});
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--gray-400)", marginBottom: 18 }}>
        Upload an airline&apos;s raw MCO invoice export (.xls/.xlsx). The report is generated but held for your
        review — nothing is saved or counted toward weekly/monthly totals until you confirm it below.
      </p>

      <div className="adm-control-card" style={{ marginBottom: 20 }}>
        <div className="adm-control-title">Generate Report</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14, alignItems: "flex-end" }}>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label>Airline</label>
            <select value={airline} onChange={(e) => setAirline(e.target.value)}>
              {AIRLINE_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 260 }}>
            <label>Excel file(s)</label>
            <input
              type="file"
              accept=".xls,.xlsx"
              multiple
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>
          <button className="adm-btn adm-btn-primary" disabled={generating} onClick={generate}>
            {generating ? "Generating…" : "Generate Report"}
          </button>
        </div>
      </div>

      {report && (
        <div className="adm-control-card">
          <div className="adm-control-title">
            Generated Report
            {report.needsReview && (
              <span className="status-badge cancelled" style={{ marginLeft: 10 }}>
                Needs review — {Math.round(report.confidence * 100)}% confidence
              </span>
            )}
          </div>

          <pre
            style={{
              background: "var(--gray-50, #f7f8fa)",
              padding: 16,
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              marginTop: 14,
            }}
          >
            {report.reportText}
          </pre>

          <div style={{ marginTop: 16 }}>
            <div className="adm-control-title" style={{ fontSize: 13 }}>
              Verification Checklist
            </div>
            <ul style={{ fontSize: 12.5, color: "var(--gray-400)", marginTop: 8, lineHeight: 1.8 }}>
              <li>Detected airline: {report.airline}</li>
              <li>Detected date: {report.reportDate}</li>
              <li>Grand total: {report.grandTotal.toLocaleString()}</li>
              <li>Confidence: {Math.round(report.confidence * 100)}%{report.confidenceReasons.length > 0 && ` — ${report.confidenceReasons.join("; ")}`}</li>
              <li>Transactions included: {report.transactionsIncludedCount}</li>
              <li>Transactions ignored: {report.transactionsIgnoredCount}</li>
              <li>Tickets counted: {report.ticketCount}</li>
              {report.warnings.length > 0 && <li>Parser warnings: {report.warnings.join("; ")}</li>}
            </ul>
          </div>

          {report.unknownStaff.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="adm-control-title" style={{ fontSize: 13 }}>
                Unrecognized staff codes — confirm before saving
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {report.unknownStaff.map((rawCode) => (
                  <div key={rawCode} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <code style={{ fontSize: 11.5, minWidth: 260 }}>{rawCode}</code>
                    <input
                      type="text"
                      placeholder="Display name (e.g. FLORENCE)"
                      style={{ maxWidth: 220 }}
                      value={corrections[rawCode] ?? ""}
                      onChange={(e) => setCorrections((c) => ({ ...c, [rawCode]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--gray-400)", marginTop: 6 }}>
                Naming a code here is optional but recommended — it&apos;s learned permanently, so future reports
                won&apos;t ask about it again. If a code&apos;s transactions were counted toward the grand total
                above, the Confidence line will call that out.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="adm-btn adm-btn-secondary" disabled={saving} onClick={discard}>
              Discard
            </button>
            <button className="adm-btn adm-btn-primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save Report"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
