"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { formatNaira } from "@/lib/utils";
import { AIRLINES, ALL_PERMISSIONS, getRoleLabel } from "@/lib/constants";
import AirlineConnectorsTab from "./AirlineConnectorsTab";

type AdminTab = "data" | "staff-ctrl" | "system" | "audit" | "finance" | "users" | "connectors";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "data", label: "Data Management" },
  { id: "staff-ctrl", label: "Staff Controls" },
  { id: "system", label: "System Settings" },
  { id: "audit", label: "Audit & Security" },
  { id: "finance", label: "Financial Controls" },
  { id: "users", label: "Users & Permissions" },
  { id: "connectors", label: "Airline Connectors" },
];

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminSection() {
  const {
    balances,
    clients,
    bookingUpdates,
    allUsers,
    systemLogs,
    settings,
    updateSettings,
    runBulkAction,
    resetData,
    toggleUserStatus,
    deleteUser,
    updateUserPermission,
    createNewUser,
    showToast,
  } = useApp();

  const [tab, setTab] = useState<AdminTab>("data");
  const [bulkAction, setBulkAction] = useState("");
  const [confirmReset, setConfirmReset] = useState<"bookings" | "clients" | "balances" | "logs" | null>(null);

  const stats = useMemo(
    () => ({
      totalUsers: allUsers.length,
      activeUsers: allUsers.filter((u) => u.status === "active").length,
      totalClients: clients.length,
      totalBalance: balances.reduce((s, b) => s + b.balance, 0),
      totalBookings: bookingUpdates.length,
    }),
    [allUsers, clients, balances, bookingUpdates]
  );

  const auditStats = useMemo(
    () => ({
      logins: systemLogs.filter((l) => l.action.includes("LOGIN") || l.action === "LOGOUT").length,
      deletes: systemLogs.filter((l) => l.action.startsWith("DELETE")).length,
      payments: systemLogs.filter((l) => l.action.includes("PAYMENT") || l.action.includes("FUND")).length,
    }),
    [systemLogs]
  );

  const failedLogins = useMemo(() => systemLogs.filter((l) => l.action === "FAILED_LOGIN"), [systemLogs]);

  // ─── company info form state ───
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [iataCode, setIataCode] = useState(settings.iataCode);
  const [companyPhone, setCompanyPhone] = useState(settings.companyPhone);
  const [companyEmail, setCompanyEmail] = useState(settings.companyEmail);
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress);
  const [thresholdCritical, setThresholdCritical] = useState(String(settings.thresholdCritical));
  const [thresholdLow, setThresholdLow] = useState(String(settings.thresholdLow));

  // ─── financial form state ───
  const [commAirline, setCommAirline] = useState(AIRLINES[0].name);
  const [commRate, setCommRate] = useState("");
  const [markupRate, setMarkupRate] = useState(String(settings.markupRate));
  const [markupLabel, setMarkupLabel] = useState(settings.markupLabel);
  const [invPrefix, setInvPrefix] = useState(settings.invoicePrefix);
  const [invStart, setInvStart] = useState(String(settings.invoiceStartNum));

  // ─── new user form state ───
  const [nuUsername, setNuUsername] = useState("");
  const [nuPassword, setNuPassword] = useState("");
  const [nuName, setNuName] = useState("");
  const [nuRole, setNuRole] = useState("agent");

  function exportAllBookings() {
    const rows: (string | number)[][] = [
      ["Client", "Airline", "Amount", "Amount Paid", "Status", "Type", "PNR", "Initiated By", "Updated"],
      ...bookingUpdates.map((b) => [b.client, b.airline, b.amount, b.amountPaid || 0, b.status, b.bookingType, b.pnr, b.initiatedBy, b.updated]),
    ];
    downloadCSV("tdis-bookings-all.csv", rows);
    showToast("✓ Bookings exported", "success");
  }
  function exportPaidBookings() {
    const rows: (string | number)[][] = [
      ["Client", "Airline", "Amount", "Status", "Updated"],
      ...bookingUpdates.filter((b) => b.status === "Paid").map((b) => [b.client, b.airline, b.amount, b.status, b.updated]),
    ];
    downloadCSV("tdis-bookings-paid.csv", rows);
    showToast("✓ Paid bookings exported", "success");
  }
  function exportClients() {
    const rows: (string | number)[][] = [
      ["Name", "Phone", "Email", "Preference", "Created"],
      ...clients.map((c) => [c.name, c.phone, c.email, c.preference || "", c.createdAt]),
    ];
    downloadCSV("tdis-clients.csv", rows);
    showToast("✓ Clients exported", "success");
  }

  function handleReset(type: "bookings" | "clients" | "balances" | "logs") {
    resetData(type);
    setConfirmReset(null);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="section-title">Admin Control Centre</div>

      <div className="admin-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalUsers}</div>
          <div className="stat-label">Total Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.activeUsers}</div>
          <div className="stat-label">Active Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalClients}</div>
          <div className="stat-label">Total Clients</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatNaira(stats.totalBalance)}</div>
          <div className="stat-label">Total Balance</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalBookings}</div>
          <div className="stat-label">Total Bookings</div>
        </div>
      </div>

      <div className="admin-tab-nav" style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`adm-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "data" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
          <div className="adm-control-card">
            <div className="adm-control-icon">📥</div>
            <div className="adm-control-title">Export Bookings to CSV</div>
            <div className="adm-control-desc">Download all booking records as a spreadsheet file.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="adm-btn adm-btn-primary" onClick={exportAllBookings}>
                Export All Bookings
              </button>
              <button className="adm-btn adm-btn-secondary" onClick={exportPaidBookings}>
                Paid Only
              </button>
            </div>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">👤</div>
            <div className="adm-control-title">Export Clients to CSV</div>
            <div className="adm-control-desc">Download the full client database with contact details.</div>
            <div style={{ marginTop: 14 }}>
              <button className="adm-btn adm-btn-primary" onClick={exportClients}>
                Export Clients
              </button>
            </div>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">⚡</div>
            <div className="adm-control-title">Bulk Booking Actions</div>
            <div className="adm-control-desc">Mark multiple bookings as cancelled, or clear old records in bulk.</div>
            <div style={{ marginTop: 12 }}>
              <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} style={{ width: "100%", marginBottom: 10 }}>
                <option value="">— Select action —</option>
                <option value="cancel-pending">Cancel all Pending bookings</option>
                <option value="clear-cancelled">Delete all Cancelled bookings</option>
              </select>
              <button className="adm-btn adm-btn-danger" onClick={() => runBulkAction(bulkAction)}>
                ⚠ Run Bulk Action
              </button>
            </div>
          </div>

          <div className="adm-control-card adm-danger-card">
            <div className="adm-control-icon">🗑️</div>
            <div className="adm-control-title">Reset Specific Data</div>
            <div className="adm-control-desc">
              Permanently clear selected data. <strong>This cannot be undone.</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button className="adm-btn adm-btn-danger" onClick={() => setConfirmReset("bookings")}>
                Clear All Bookings
              </button>
              <button className="adm-btn adm-btn-danger" onClick={() => setConfirmReset("clients")}>
                Clear All Clients
              </button>
              <button className="adm-btn adm-btn-danger" onClick={() => setConfirmReset("balances")}>
                Reset All Balances to ₦0
              </button>
              <button className="adm-btn adm-btn-danger" onClick={() => setConfirmReset("logs")}>
                Clear Activity Logs
              </button>
            </div>
            {confirmReset && (
              <div style={{ marginTop: 12, padding: 12, background: "white", borderRadius: 10, border: "1.5px solid var(--red)" }}>
                <p style={{ fontSize: 12, marginBottom: 8 }}>Are you sure? This cannot be undone.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="adm-btn adm-btn-secondary" onClick={() => setConfirmReset(null)}>
                    Cancel
                  </button>
                  <button className="adm-btn adm-btn-danger" onClick={() => handleReset(confirmReset)}>
                    Yes, Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "staff-ctrl" && (
        <div>
          {allUsers.map((u) => (
            <div className="staff-ctrl-card" key={u.id}>
              <div className="staff-ctrl-header">
                <div className="staff-ctrl-info">
                  <div className="staff-ctrl-avatar">{u.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="staff-ctrl-name">{u.name}</div>
                    <div className="staff-ctrl-meta">
                      {getRoleLabel(u.role)} · {u.status === "active" ? "Active" : "Inactive"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="adm-btn adm-btn-secondary" onClick={() => toggleUserStatus(u.id)}>
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                  {u.role !== "admin" && (
                    <button className="adm-btn adm-btn-danger" onClick={() => deleteUser(u.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="staff-ctrl-body">
                <div className="form-group">
                  <label>Permissions</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {ALL_PERMISSIONS.map((p) => (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={u.permissions.includes(p.id)}
                          onChange={(e) => updateUserPermission(u.id, p.id, e.target.checked)}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "system" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 20 }}>
          <div className="adm-control-card" style={{ gridColumn: "1/-1" }}>
            <div className="adm-control-icon">🏢</div>
            <div className="adm-control-title">Company Information</div>
            <div className="adm-control-desc">Displayed on invoices and reports.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <div className="form-group">
                <label>Company Name</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="TDIS Logistics Ltd" />
              </div>
              <div className="form-group">
                <label>IATA Code</label>
                <input value={iataCode} onChange={(e) => setIataCode(e.target.value)} placeholder="e.g. TD" />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="+234..." />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="info@company.com" />
              </div>
              <div className="form-group" style={{ gridColumn: "1/-1" }}>
                <label>Address</label>
                <input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="Street, City, State" />
              </div>
            </div>
            <button
              className="adm-btn adm-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => updateSettings({ companyName, iataCode, companyPhone, companyEmail, companyAddress })}
            >
              💾 Save Company Info
            </button>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">⚠️</div>
            <div className="adm-control-title">Balance Alert Thresholds</div>
            <div className="adm-control-desc">Set at what balance level airlines are flagged as Low or Critical.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              <div className="form-group">
                <label>🔴 Critical below (₦)</label>
                <input type="number" min={0} value={thresholdCritical} onChange={(e) => setThresholdCritical(e.target.value)} />
              </div>
              <div className="form-group">
                <label>🟡 Low below (₦)</label>
                <input type="number" min={0} value={thresholdLow} onChange={(e) => setThresholdLow(e.target.value)} />
              </div>
            </div>
            <button
              className="adm-btn adm-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() =>
                updateSettings({
                  thresholdCritical: parseFloat(thresholdCritical) || 0,
                  thresholdLow: parseFloat(thresholdLow) || 0,
                })
              }
            >
              Save Thresholds
            </button>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">🔀</div>
            <div className="adm-control-title">Feature Toggles</div>
            <div className="adm-control-desc">Enable or disable system features for all users.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 14 }}>
              {Object.entries(settings.features).map(([key, on]) => (
                <label className="adm-toggle-row" key={key}>
                  <span className="adm-toggle-label">
                    <span style={{ fontWeight: 600, color: "var(--navy-dark)" }}>{key}</span>
                  </span>
                  <div
                    className={`adm-toggle-switch ${on ? "on" : ""}`}
                    onClick={() => updateSettings({ features: { ...settings.features, [key]: !on } })}
                  >
                    <div className="adm-toggle-knob" />
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div>
          <div className="admin-grid">
            <div className="stat-card">
              <div className="stat-value">{auditStats.logins}</div>
              <div className="stat-label">Login Events</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{auditStats.deletes}</div>
              <div className="stat-label">Delete Actions</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{auditStats.payments}</div>
              <div className="stat-label">Payment Updates</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Activity Log</span>
              <span style={{ fontSize: 11, color: "var(--gray-400)" }}>{systemLogs.length} entries</span>
            </div>
            <div className="clients-table">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {systemLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: 20, color: "var(--gray-400)" }}>
                        No logs yet
                      </td>
                    </tr>
                  ) : (
                    [...systemLogs].reverse().slice(0, 100).map((l, i) => (
                      <tr key={i}>
                        <td>{new Date(l.timestamp).toLocaleString("en-NG")}</td>
                        <td>{l.user}</td>
                        <td>{l.action}</td>
                        <td>{l.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header">
              <span className="card-title">🔐 Failed Login Attempts</span>
            </div>
            <div className="clients-table">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Username Attempted</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {failedLogins.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: "center", padding: 20, color: "var(--gray-400)" }}>
                        No failed attempts recorded
                      </td>
                    </tr>
                  ) : (
                    failedLogins
                      .slice(-50)
                      .reverse()
                      .map((l, i) => (
                        <tr key={i}>
                          <td>{new Date(l.timestamp).toLocaleString("en-NG")}</td>
                          <td>{l.details.replace("Failed login attempt with username: ", "")}</td>
                          <td>Invalid credentials</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "finance" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 20 }}>
          <div className="adm-control-card">
            <div className="adm-control-icon">💹</div>
            <div className="adm-control-title">Commission Rates</div>
            <div className="adm-control-desc">Set default commission percentages per airline.</div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <select value={commAirline} onChange={(e) => setCommAirline(e.target.value)} style={{ flex: 1 }}>
                  {AIRLINES.map((a) => (
                    <option key={a.code} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="%"
                  min={0}
                  max={100}
                  step={0.1}
                  value={commRate}
                  onChange={(e) => setCommRate(e.target.value)}
                  style={{ width: 80 }}
                />
                <button
                  className="adm-btn adm-btn-primary"
                  onClick={() => {
                    const val = parseFloat(commRate);
                    if (!isNaN(val)) {
                      updateSettings({ commissionRates: { ...settings.commissionRates, [commAirline]: val } });
                      setCommRate("");
                    }
                  }}
                >
                  Set
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--gray-400)" }}>
                {Object.entries(settings.commissionRates).length === 0
                  ? "No custom rates set"
                  : Object.entries(settings.commissionRates).map(([k, v]) => `${k}: ${v}%`).join(" · ")}
              </div>
            </div>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">📈</div>
            <div className="adm-control-title">Global Markup Rule</div>
            <div className="adm-control-desc">Apply a flat percentage markup when calculating client prices.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              <div className="form-group">
                <label>Default Markup (%)</label>
                <input type="number" min={0} max={100} step={0.5} value={markupRate} onChange={(e) => setMarkupRate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Markup Label (shown on invoice)</label>
                <input value={markupLabel} onChange={(e) => setMarkupLabel(e.target.value)} />
              </div>
            </div>
            <button
              className="adm-btn adm-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => updateSettings({ markupRate: parseFloat(markupRate) || 0, markupLabel })}
            >
              Save Markup Rule
            </button>
          </div>

          <div className="adm-control-card">
            <div className="adm-control-icon">🧾</div>
            <div className="adm-control-title">Invoice Number Format</div>
            <div className="adm-control-desc">Configure how invoice/booking reference numbers are generated.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              <div className="form-group">
                <label>Prefix</label>
                <input value={invPrefix} maxLength={10} onChange={(e) => setInvPrefix(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Starting Number</label>
                <input type="number" min={1} value={invStart} onChange={(e) => setInvStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Preview</label>
                <div
                  style={{
                    padding: "9px 14px",
                    background: "var(--gold-pale)",
                    border: "1.5px solid var(--gold)",
                    borderRadius: 8,
                    fontWeight: 700,
                    color: "var(--brown)",
                  }}
                >
                  {invPrefix}
                  {invStart}
                </div>
              </div>
            </div>
            <button
              className="adm-btn adm-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => updateSettings({ invoicePrefix: invPrefix, invoiceStartNum: parseInt(invStart) || 1001 })}
            >
              Save Format
            </button>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Create New User</span>
            </div>
            <div className="card-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Username</label>
                  <input value={nuUsername} onChange={(e) => setNuUsername(e.target.value)} placeholder="e.g. agent_mark" />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={nuPassword} onChange={(e) => setNuPassword(e.target.value)} placeholder="Min 6 characters" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Full Name</label>
                  <input value={nuName} onChange={(e) => setNuName(e.target.value)} placeholder="e.g. Mark Johnson" />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <select value={nuRole} onChange={(e) => setNuRole(e.target.value)}>
                    <option value="agent">Staff Agent</option>
                    <option value="manager">Operational Manager</option>
                    <option value="independent">TDIS Independent Agent</option>
                    <option value="frontdesk">Front Desk Staff</option>
                  </select>
                </div>
              </div>
              <button
                className="search-btn"
                onClick={() => {
                  const ok = createNewUser({ username: nuUsername, password: nuPassword, name: nuName, role: nuRole });
                  if (ok) {
                    setNuUsername("");
                    setNuPassword("");
                    setNuName("");
                    setNuRole("agent");
                  }
                }}
              >
                ➕ Create User
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Manage Users &amp; Permissions</span>
            </div>
            <div className="card-body">
              {allUsers.map((u) => (
                <div key={u.id} className="unpaid-row">
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--navy-dark)" }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)" }}>
                      {u.username} · {getRoleLabel(u.role)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="action-link" onClick={() => toggleUserStatus(u.id)}>
                      {u.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                    {u.role !== "admin" && (
                      <button className="action-link" style={{ color: "var(--red)" }} onClick={() => deleteUser(u.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "connectors" && <AirlineConnectorsTab />}
    </motion.div>
  );
}
