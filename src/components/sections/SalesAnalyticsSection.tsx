"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatNaira } from "@/lib/utils";
import { salesReportAirlineLabel, formatDDMMYYYY } from "@/lib/salesReportAirlines";

type Preset = "today" | "week" | "month" | "lastMonth";

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  lastMonth: "Last Month",
};

function startOfWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - diff);
  return start;
}

function resolvePreset(preset: Preset): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (preset) {
    case "today":
      return { dateFrom: formatDDMMYYYY(today), dateTo: formatDDMMYYYY(today) };
    case "week":
      return { dateFrom: formatDDMMYYYY(startOfWeek(today)), dateTo: formatDDMMYYYY(today) };
    case "lastMonth": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { dateFrom: formatDDMMYYYY(start), dateTo: formatDDMMYYYY(end) };
    }
    case "month":
    default: {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { dateFrom: formatDDMMYYYY(start), dateTo: formatDDMMYYYY(today) };
    }
  }
}

interface ExecutiveKPIs {
  grossSalesAmount: number;
  netSalesAmount: number;
  totalTicketsIssued: number;
  totalTicketsVoided: number;
  totalVoidAmount: number;
  totalCommission: number;
  reportCount: number;
}

interface AirlineMetric {
  rank: number;
  airline: string;
  sales: number;
  tickets: number;
  voids: number;
}

interface StaffMetric {
  rank: number;
  staffName: string;
  sales: number;
  tickets: number;
  commission: number;
}

interface TrendPoint {
  label: string;
  sales: number;
  tickets: number;
}

interface GrowthResponse {
  sales: { current: number; previous: number; delta: number; growthPct: number };
  tickets: { current: number; previous: number; delta: number; growthPct: number };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export default function SalesAnalyticsSection() {
  const [preset, setPreset] = useState<Preset>("month");
  const { dateFrom, dateTo } = useMemo(() => resolvePreset(preset), [preset]);

  const [kpi, setKpi] = useState<ExecutiveKPIs | null>(null);
  const [airlines, setAirlines] = useState<AirlineMetric[]>([]);
  const [staff, setStaff] = useState<StaffMetric[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [growth, setGrowth] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const granularity = preset === "today" ? "daily" : preset === "week" ? "daily" : "weekly";
    const qs = `dateFrom=${dateFrom}&dateTo=${dateTo}`;

    Promise.all([
      fetchJson<ExecutiveKPIs & { period: unknown }>(`/api/analytics/kpi?${qs}`),
      fetchJson<{ metrics: AirlineMetric[] }>(`/api/analytics/airline?${qs}`),
      fetchJson<{ metrics: StaffMetric[] }>(`/api/analytics/staff?${qs}&sortBy=sales`),
      fetchJson<{ points: TrendPoint[] }>(`/api/analytics/trends?${qs}&granularity=${granularity}`),
      fetchJson<GrowthResponse>(`/api/analytics/growth?${qs}`),
    ])
      .then(([kpiRes, airlineRes, staffRes, trendRes, growthRes]) => {
        if (cancelled) return;
        setKpi(kpiRes);
        setAirlines(airlineRes.metrics);
        setStaff(staffRes.metrics.slice(0, 8));
        setTrend(trendRes.points);
        setGrowth(growthRes);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, preset]);

  const maxTrendSales = Math.max(1, ...trend.map((p) => p.sales));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Sales Analytics</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            style={
              preset === p
                ? { background: "var(--navy, #1e3a5f)", color: "white", borderColor: "var(--navy, #1e3a5f)" }
                : undefined
            }
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
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
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16, marginBottom: 28 }}>
            <div className="stat-card">
              <div className="stat-value">{formatNaira(kpi?.grossSalesAmount ?? 0)}</div>
              <div className="stat-label">Gross Sales</div>
            </div>
            <div className="stat-card" style={{ borderColor: "var(--green)" }}>
              <div className="stat-value" style={{ color: "var(--green)" }}>{formatNaira(kpi?.netSalesAmount ?? 0)}</div>
              <div className="stat-label">Net Sales</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{kpi?.totalTicketsIssued ?? 0}</div>
              <div className="stat-label">Tickets Issued</div>
            </div>
            <div className="stat-card" style={{ borderColor: "var(--red)" }}>
              <div className="stat-value" style={{ color: "var(--red)" }}>{kpi?.totalTicketsVoided ?? 0}</div>
              <div className="stat-label">Tickets Voided</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{kpi?.reportCount ?? 0}</div>
              <div className="stat-label">Reports</div>
            </div>
          </div>

          {growth && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <span className="card-title">📊 vs Previous Period</span>
              </div>
              <div style={{ display: "flex", gap: 24, padding: "14px 20px", flexWrap: "wrap" }}>
                <GrowthStat label="Sales" current={formatNaira(growth.sales.current)} pct={growth.sales.growthPct} />
                <GrowthStat label="Tickets" current={String(growth.tickets.current)} pct={growth.tickets.growthPct} />
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <span className="card-title">📈 Sales Trend</span>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {trend.length === 0 ? (
                <div className="empty-sub" style={{ textAlign: "center" }}>
                  No trend data for this period
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140 }}>
                  {trend.map((p, i) => (
                    <div
                      key={i}
                      title={`${p.label}: ${formatNaira(p.sales)} (${p.tickets} tickets)`}
                      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: `${Math.max(4, (p.sales / maxTrendSales) * 120)}px`,
                          background: "linear-gradient(180deg, var(--navy-light, #3b5a7a), var(--navy, #1e3a5f))",
                          borderRadius: "4px 4px 0 0",
                        }}
                      />
                      <span style={{ fontSize: 9, color: "var(--gray-400)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                        {p.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dash-two-col">
            <div className="card">
              <div className="card-header">
                <span className="card-title">🏆 Airline Performance</span>
              </div>
              <div style={{ padding: 0 }}>
                {airlines.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px 8px" }}>
                    <div className="empty-sub">No data for this period</div>
                  </div>
                ) : (
                  airlines.map((a) => (
                    <div className="unpaid-row" key={a.airline} style={{ padding: "10px 20px" }}>
                      <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>
                        {a.rank}. {salesReportAirlineLabel(a.airline)}
                      </span>
                      <span style={{ fontWeight: 700 }}>{formatNaira(a.sales)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">⭐ Top Staff</span>
              </div>
              <div style={{ padding: 0 }}>
                {staff.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px 8px" }}>
                    <div className="empty-sub">No data for this period</div>
                  </div>
                ) : (
                  staff.map((s) => (
                    <div className="unpaid-row" key={s.staffName} style={{ padding: "10px 20px" }}>
                      <span style={{ fontWeight: 600, color: "var(--navy-dark)", fontSize: 13 }}>
                        {s.rank}. {s.staffName}
                      </span>
                      <span style={{ fontWeight: 700 }}>{formatNaira(s.sales)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

function GrowthStat({ label, current, pct }: { label: string; current: string; pct: number }) {
  const color = pct > 0 ? "var(--green)" : pct < 0 ? "var(--red)" : "var(--gray-400)";
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--navy-dark)" }}>{current}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color }}>
        {arrow} {Math.abs(pct)}%
      </div>
    </div>
  );
}
