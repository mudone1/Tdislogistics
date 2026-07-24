"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";

interface SyncProgress {
  runId: string;
  status: "in-progress" | "completed" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  progress: { completed: number; total: number; percentage: number };
  airlines: Array<{
    airline: AirlineKey;
    status: string;
    balance?: number;
    previousBalance?: number;
    balanceChange?: number;
    error?: string;
    errorCategory?: string;
    durationMs?: number;
  }>;
  summary: {
    successfulCount: number;
    failedCount: number;
    skippedCount: number;
    authFailureCount: number;
    networkFailureCount: number;
    portalFailureCount: number;
  };
}

interface AirlineSyncPanelProps {
  onSyncStart?: (runId: string) => void;
  onSyncComplete?: (summary: SyncProgress["summary"]) => void;
  showDetails?: boolean;
}

export default function AirlineSyncPanel({
  onSyncStart,
  onSyncComplete,
  showDetails = true,
}: AirlineSyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [expandedAirlines, setExpandedAirlines] = useState<Set<AirlineKey>>(new Set());

  // Poll for progress while syncing
  useEffect(() => {
    if (!syncing || !currentRunId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sync/progress/${currentRunId}`);
        const data = await res.json();
        setProgress(data);

        if (data.status === "completed" || data.status === "failed") {
          setSyncing(false);
          onSyncComplete?.(data.summary);
        }
      } catch (err) {
        console.error("Failed to fetch sync progress:", err);
      }
    }, 1000); // Poll every 1 second

    return () => clearInterval(interval);
  }, [syncing, currentRunId, onSyncComplete]);

  async function handleSyncAll() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initiatedBy: "user" }),
      });

      if (!res.ok) {
        throw new Error((await res.json()).error || "Failed to start sync");
      }

      const data = await res.json();
      setCurrentRunId(data.runId);
      onSyncStart?.(data.runId);
    } catch (err) {
      setSyncing(false);
      console.error("Failed to start sync:", err);
      alert(err instanceof Error ? err.message : "Failed to start sync");
    }
  }

  const handleToggleAirline = (airline: AirlineKey) => {
    const newExpanded = new Set(expandedAirlines);
    if (newExpanded.has(airline)) {
      newExpanded.delete(airline);
    } else {
      newExpanded.add(airline);
    }
    setExpandedAirlines(newExpanded);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="sync-panel"
      style={{
        border: "1px solid var(--border-light)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 24,
        backgroundColor: "var(--bg-elevated)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: progress ? 16 : 0,
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: 16, fontWeight: 600 }}>
            Airline Balance Sync
          </h3>
          {progress && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--gray-400)" }}>
              {syncing ? "Syncing..." : "Sync complete"}
            </p>
          )}
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncing}
          style={{
            padding: "8px 16px",
            backgroundColor: syncing ? "var(--gray-400)" : "var(--blue-500)",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: syncing ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {syncing ? "Syncing..." : "Sync All Airlines"}
        </button>
      </div>

      {/* Progress Bar */}
      {progress && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 12,
            }}
          >
            <span>Progress</span>
            <span style={{ color: "var(--gray-400)" }}>
              {progress.progress.completed} of {progress.progress.total}
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: 8,
              backgroundColor: "var(--border-light)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.progress.percentage}%` }}
              transition={{ duration: 0.3 }}
              style={{
                height: "100%",
                backgroundColor: syncing ? "var(--blue-500)" : "var(--green-500)",
              }}
            />
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {progress && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
            marginBottom: 16,
            padding: 12,
            backgroundColor: "var(--bg-subtle)",
            borderRadius: 4,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 4 }}>
              Successful
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--green-500)" }}>
              {progress.summary.successfulCount}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 4 }}>
              Failed
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--red-500)" }}>
              {progress.summary.failedCount}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 4 }}>
              Skipped
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--gray-400)" }}>
              {progress.summary.skippedCount}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 4 }}>
              Auth Failures
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--orange-500)" }}>
              {progress.summary.authFailureCount}
            </div>
          </div>
        </div>
      )}

      {/* Airline Details */}
      {showDetails && progress && (
        <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--gray-400)" }}>
            Airlines
          </div>
          {progress.airlines.map((airline) => (
            <div
              key={airline.airline}
              style={{
                marginBottom: 8,
                padding: 8,
                backgroundColor: "var(--bg-subtle)",
                borderRadius: 4,
                cursor: "pointer",
              }}
              onClick={() => handleToggleAirline(airline.airline)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {airline.airline}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      airline.status === "SUCCESS"
                        ? "var(--green-500)"
                        : airline.status === "FAILED"
                          ? "var(--red-500)"
                          : "var(--gray-400)",
                  }}
                >
                  {airline.status === "SUCCESS"
                    ? "✓"
                    : airline.status === "FAILED"
                      ? "✗"
                      : "—"}
                </span>
              </div>

              {/* Expanded Details */}
              {expandedAirlines.has(airline.airline) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-light)", fontSize: 12 }}>
                  {airline.balance !== undefined && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: "var(--gray-400)" }}>Balance: </span>
                      <span style={{ fontWeight: 500 }}>
                        ₦{airline.balance.toLocaleString()}
                      </span>
                      {airline.balanceChange !== undefined && airline.balanceChange !== 0 && (
                        <span
                          style={{
                            marginLeft: 8,
                            color: airline.balanceChange > 0 ? "var(--green-500)" : "var(--red-500)",
                          }}
                        >
                          ({airline.balanceChange > 0 ? "+" : ""}
                          {airline.balanceChange.toLocaleString()})
                        </span>
                      )}
                    </div>
                  )}
                  {airline.durationMs && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: "var(--gray-400)" }}>Duration: </span>
                      <span>{(airline.durationMs / 1000).toFixed(1)}s</span>
                    </div>
                  )}
                  {airline.error && (
                    <div style={{ marginTop: 8, padding: 8, backgroundColor: "var(--red-50)", borderRadius: 3 }}>
                      <div style={{ fontSize: 11, color: "var(--red-700)", marginBottom: 2 }}>
                        {airline.errorCategory || "Error"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--red-600)" }}>
                        {airline.error}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {progress && !syncing && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border-light)",
            fontSize: 12,
            color: "var(--gray-400)",
          }}
        >
          Completed in {progress.durationMs ? (progress.durationMs / 1000).toFixed(1) : "?"}s
        </div>
      )}
    </motion.div>
  );
}
