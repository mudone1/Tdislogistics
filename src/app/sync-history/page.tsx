"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { SyncTrigger } from "@/modules/airline-connectors/core/types";

interface SyncRun {
  runId: string;
  trigger: SyncTrigger;
  initiatedBy?: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalAirlines: number;
  successfulCount: number;
  failedCount: number;
  skippedCount: number;
  authFailureCount: number;
  networkFailureCount: number;
  portalFailureCount: number;
  unknownFailureCount: number;
}

interface SyncRunDetail extends SyncRun {
  airlineResults: Array<{
    airline: string;
    status: string;
    balance?: number;
    balanceChange?: number;
    error?: string;
    errorCategory?: string;
  }>;
  logs: Array<{
    step: string;
    message: string;
    level: string;
  }>;
}

export default function SyncHistoryPage() {
  const [syncs, setSyncs] = useState<SyncRun[]>([]);
  const [selectedSync, setSelectedSync] = useState<SyncRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState<SyncTrigger | "">("");
  const [days, setDays] = useState(7);

  useEffect(() => {
    loadSyncs();
  }, [trigger, days]);

  async function loadSyncs() {
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const url = new URL("/api/sync-history", window.location.origin);
      url.searchParams.set("limit", "100");
      url.searchParams.set("since", since);
      if (trigger) url.searchParams.set("trigger", trigger);

      const res = await fetch(url);
      const data = await res.json();
      setSyncs(data.runs || []);
    } catch (err) {
      console.error("Failed to load sync history:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSyncDetail(runId: string) {
    try {
      const res = await fetch(`/api/sync-history/${runId}`);
      const data = await res.json();
      setSelectedSync(data);
    } catch (err) {
      console.error("Failed to load sync detail:", err);
    }
  }

  const getStatusColor = (status: string) => {
    if (status === "SUCCESS") return "var(--green-500)";
    if (status === "FAILED") return "var(--red-500)";
    return "var(--gray-400)";
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 style={{ marginTop: 0, marginBottom: 24, fontSize: 28, fontWeight: 700 }}>
          Sync History
        </h1>

        {/* Filters */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 24,
            padding: 16,
            backgroundColor: "var(--bg-elevated)",
            borderRadius: 8,
            border: "1px solid var(--border-light)",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
              Trigger Type
            </label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as SyncTrigger | "")}
              style={{
                padding: "8px 12px",
                borderRadius: 4,
                border: "1px solid var(--border-light)",
                backgroundColor: "var(--bg-default)",
              }}
            >
              <option value="">All</option>
              <option value="MANUAL">Manual</option>
              <option value="SCHEDULED">Scheduled</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
              Last N Days
            </label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              style={{
                padding: "8px 12px",
                borderRadius: 4,
                border: "1px solid var(--border-light)",
                backgroundColor: "var(--bg-default)",
              }}
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Sync List */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Recent Syncs ({syncs.length})
            </h2>

            {loading ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--gray-400)" }}>
                Loading...
              </div>
            ) : syncs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--gray-400)" }}>
                No sync runs found
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {syncs.map((sync) => (
                  <motion.div
                    key={sync.runId}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => loadSyncDetail(sync.runId)}
                    style={{
                      padding: 12,
                      backgroundColor: selectedSync?.runId === sync.runId ? "var(--blue-50)" : "var(--bg-elevated)",
                      border: `1px solid ${selectedSync?.runId === sync.runId ? "var(--blue-300)" : "var(--border-light)"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>
                        {sync.runId.slice(0, 8)}...
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 6px",
                          backgroundColor: sync.trigger === "MANUAL" ? "var(--blue-100)" : "var(--gray-100)",
                          borderRadius: 2,
                        }}
                      >
                        {sync.trigger}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, marginBottom: 6, color: "var(--gray-400)" }}>
                      {new Date(sync.startedAt).toLocaleString("en-NG")}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      <span style={{ color: "var(--green-500)" }}>✓ {sync.successfulCount}</span>
                      {sync.failedCount > 0 && <span style={{ color: "var(--red-500)" }}>✗ {sync.failedCount}</span>}
                      {sync.skippedCount > 0 && <span style={{ color: "var(--gray-400)" }}>— {sync.skippedCount}</span>}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Sync Detail */}
          {selectedSync && (
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              style={{
                padding: 16,
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-light)",
                borderRadius: 8,
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                Sync Details
              </h2>

              <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 16 }}>
                <div>
                  <span style={{ color: "var(--gray-400)" }}>Run ID:</span>
                  <span style={{ marginLeft: 8, fontFamily: "monospace" }}>{selectedSync.runId}</span>
                </div>
                <div>
                  <span style={{ color: "var(--gray-400)" }}>Trigger:</span>
                  <span style={{ marginLeft: 8, fontWeight: 500 }}>{selectedSync.trigger}</span>
                </div>
                <div>
                  <span style={{ color: "var(--gray-400)" }}>Started:</span>
                  <span style={{ marginLeft: 8 }}>
                    {new Date(selectedSync.startedAt).toLocaleString("en-NG")}
                  </span>
                </div>
                {selectedSync.durationMs && (
                  <div>
                    <span style={{ color: "var(--gray-400)" }}>Duration:</span>
                    <span style={{ marginLeft: 8 }}>
                      {(selectedSync.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                )}
              </div>

              {/* Summary Stats */}
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: "var(--bg-subtle)", borderRadius: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--gray-400)" }}>
                  Summary
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <span style={{ color: "var(--gray-400)" }}>Successful:</span>
                    <span style={{ marginLeft: 8, fontWeight: 600, color: "var(--green-500)" }}>
                      {selectedSync.successfulCount}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--gray-400)" }}>Failed:</span>
                    <span style={{ marginLeft: 8, fontWeight: 600, color: "var(--red-500)" }}>
                      {selectedSync.failedCount}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--gray-400)" }}>Skipped:</span>
                    <span style={{ marginLeft: 8, fontWeight: 600 }}>
                      {selectedSync.skippedCount}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--gray-400)" }}>Auth Failures:</span>
                    <span style={{ marginLeft: 8, fontWeight: 600, color: "var(--orange-500)" }}>
                      {selectedSync.authFailureCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* Airline Results */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--gray-400)" }}>
                  Airlines
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "400px", overflowY: "auto" }}>
                  {selectedSync.airlineResults.map((airline) => (
                    <div
                      key={airline.airline}
                      style={{
                        padding: 8,
                        backgroundColor: "var(--bg-subtle)",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontWeight: 500 }}>{airline.airline}</span>
                        <span style={{ color: getStatusColor(airline.status), fontWeight: 600 }}>
                          {airline.status === "SUCCESS" ? "✓" : airline.status === "FAILED" ? "✗" : "—"}
                        </span>
                      </div>
                      {airline.balance && (
                        <div style={{ color: "var(--gray-400)", fontSize: 11 }}>
                          Balance: ₦{airline.balance.toLocaleString()}
                          {airline.balanceChange && airline.balanceChange !== 0 && (
                            <span style={{ marginLeft: 8, color: airline.balanceChange > 0 ? "var(--green-500)" : "var(--red-500)" }}>
                              ({airline.balanceChange > 0 ? "+" : ""}{airline.balanceChange.toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}
                      {airline.error && (
                        <div style={{ color: "var(--red-600)", fontSize: 11, marginTop: 4 }}>
                          {airline.errorCategory}: {airline.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
