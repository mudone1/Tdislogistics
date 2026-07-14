"use client";

import { useEffect, useState, useCallback } from "react";
import { useApp } from "@/lib/store";
import { formatNaira } from "@/lib/utils";

interface ConnectorRow {
  airline: string;
  displayName: string;
  enabled: boolean;
  hasCredentials: boolean;
  syncIntervalMinutes: number | null;
  dailyRunAtUtc: string | null;
  connectionStatus: "NOT_CONFIGURED" | "CONNECTED" | "ERROR";
  lastTestedAt: string | null;
  currentBalance: number | null;
  currency: string;
  lastSynced: string | null;
  lastStatus: "SUCCESS" | "FAILED" | "IN_PROGRESS" | "PENDING";
}

const SCHEDULE_OPTIONS = [
  { value: "", label: "Manual only" },
  { value: "120", label: "Every 2 hours" },
  { value: "1440", label: "Daily" },
];

export default function AirlineConnectorsTab() {
  const { showToast } = useApp();
  const [connectors, setConnectors] = useState<ConnectorRow[] | null>(null);
  const [busy, setBusy] = useState<Record<string, "testing" | "syncing" | "saving" | undefined>>({});
  const [creds, setCreds] = useState<Record<string, { username: string; password: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors", { cache: "no-store" });
      const data = await res.json();
      setConnectors(data.connectors ?? []);
    } catch {
      showToast("Could not load connector settings — is the database configured?", "warn");
      setConnectors([]);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSettings(airline: string, patch: Record<string, unknown>) {
    setBusy((b) => ({ ...b, [airline]: "saving" }));
    try {
      const res = await fetch(`/api/connectors/${airline}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      showToast("✓ Connector settings saved", "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "warn");
    } finally {
      setBusy((b) => ({ ...b, [airline]: undefined }));
    }
  }

  async function testConnection(airline: string) {
    setBusy((b) => ({ ...b, [airline]: "testing" }));
    try {
      const res = await fetch(`/api/connectors/${airline}/test`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) showToast("✓ Connection test succeeded", "success");
      else showToast(`Connection test failed: ${data.error || "unknown error"}`, "warn");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Connection test failed", "warn");
    } finally {
      setBusy((b) => ({ ...b, [airline]: undefined }));
      await load();
    }
  }

  async function manualSync(airline: string) {
    setBusy((b) => ({ ...b, [airline]: "syncing" }));
    try {
      const res = await fetch(`/api/connectors/${airline}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.accepted) {
        // The connector-service runs the actual sync in the background
        // (it can take well over a minute) — this response just confirms
        // it started. The real result shows up as a toast automatically
        // once the balance lands in Firestore (see src/lib/store.tsx),
        // and we poll a few times below to refresh this card's status
        // without requiring a manual page reload.
        showToast(`Sync started for ${airline} — this can take up to a minute`, "success");
        pollForCompletion(airline);
      } else {
        showToast(`Could not start sync: ${data.error || "unknown error"}`, "warn");
        setBusy((b) => ({ ...b, [airline]: undefined }));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start sync", "warn");
      setBusy((b) => ({ ...b, [airline]: undefined }));
    }
  }

  function pollForCompletion(airline: string) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      await load();
      // Stop after ~2 minutes (24 x 5s) regardless — the toast from the
      // Firestore listener is the real source of truth for completion;
      // this polling loop only exists to refresh the card's status badge
      // and last-synced time without the user needing to reload.
      if (attempts >= 24) {
        clearInterval(interval);
        setBusy((b) => ({ ...b, [airline]: undefined }));
      }
    }, 5000);
    // Also clear the busy state after a reasonable ceiling so the button
    // doesn't look stuck forever if something goes wrong silently.
    setTimeout(() => setBusy((b) => ({ ...b, [airline]: undefined })), 90_000);
  }

  if (connectors === null) {
    return (
      <div className="empty-state">
        <div className="empty-sub">Loading connector settings…</div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--gray-400)", marginBottom: 18 }}>
        Phase 1 — Air Peace, Aero, Arik, Ibom, and NG Eagle only, all on the shared Crane platform.
        Selectors are placeholders until verified against each live portal — see{" "}
        <code>connectors/README.md</code> in the codebase.
      </p>

      {connectors.map((c) => {
        const isBusy = busy[c.airline];
        const cred = creds[c.airline] || { username: "", password: "" };
        return (
          <div className="staff-ctrl-card" key={c.airline}>
            <div className="staff-ctrl-header">
              <div className="staff-ctrl-info">
                <div className="staff-ctrl-avatar">{c.displayName.slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="staff-ctrl-name">{c.displayName}</div>
                  <div className="staff-ctrl-meta">
                    <span
                      className={`status-badge ${
                        c.connectionStatus === "CONNECTED" ? "paid" : c.connectionStatus === "ERROR" ? "cancelled" : "pending"
                      }`}
                    >
                      {c.connectionStatus.replace("_", " ")}
                    </span>{" "}
                    · Last sync: {c.lastSynced ? new Date(c.lastSynced).toLocaleString("en-NG") : "Never"}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-inter-tight)", fontWeight: 800, fontSize: 16, color: "var(--navy-dark)" }}>
                  {c.currentBalance != null ? formatNaira(Number(c.currentBalance)) : "—"}
                </div>
                <div style={{ fontSize: 10, color: "var(--gray-400)" }}>{c.currency}</div>
              </div>
            </div>

            <div className="staff-ctrl-body">
              <label className="adm-toggle-row" style={{ minWidth: 140 }}>
                <span className="adm-toggle-label">
                  <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 12 }}>Enabled</span>
                </span>
                <div
                  className={`adm-toggle-switch ${c.enabled ? "on" : ""}`}
                  onClick={() => saveSettings(c.airline, { enabled: !c.enabled })}
                >
                  <div className="adm-toggle-knob" />
                </div>
              </label>

              <div className="form-group" style={{ minWidth: 160 }}>
                <label>Username</label>
                <input
                  type="text"
                  placeholder={c.hasCredentials ? "•••••• (saved)" : "Agent username"}
                  value={cred.username}
                  onChange={(e) => setCreds((s) => ({ ...s, [c.airline]: { ...cred, username: e.target.value } }))}
                />
              </div>
              <div className="form-group" style={{ minWidth: 160 }}>
                <label>Password</label>
                <input
                  type="password"
                  placeholder={c.hasCredentials ? "•••••• (saved)" : "Agent password"}
                  value={cred.password}
                  onChange={(e) => setCreds((s) => ({ ...s, [c.airline]: { ...cred, password: e.target.value } }))}
                />
              </div>
              <div className="form-group" style={{ minWidth: 140 }}>
                <label>Sync Interval</label>
                <select
                  value={String(c.syncIntervalMinutes ?? "")}
                  onChange={(e) =>
                    saveSettings(c.airline, { syncIntervalMinutes: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  {SCHEDULE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                <button
                  className="adm-btn adm-btn-secondary"
                  disabled={!cred.username && !cred.password}
                  onClick={() => saveSettings(c.airline, { username: cred.username || undefined, password: cred.password || undefined })}
                >
                  Save Credentials
                </button>
                <button className="adm-btn adm-btn-secondary" disabled={!!isBusy} onClick={() => testConnection(c.airline)}>
                  {isBusy === "testing" ? "Testing…" : "Test Connection"}
                </button>
                <button className="adm-btn adm-btn-primary" disabled={!!isBusy || !c.enabled} onClick={() => manualSync(c.airline)}>
                  {isBusy === "syncing" ? "Syncing…" : "Manual Sync"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
