import type { Airline, AppUser, SystemSettings } from "./types";

export const AIRLINES: Airline[] = [
  { name: "Air Peace", code: "P4", url: "https://book-airpeace.crane.aero/", color: "#003087", abbr: "AP" },
  { name: "Aero Contractors", code: "NG", url: "https://flyaero.crane.aero/", color: "#cc0000", abbr: "AE" },
  { name: "NG Eagle", code: "NGE", url: "https://book-ngeagle.crane.aero/", color: "#006400", abbr: "NGE" },
  { name: "Ibom Air", code: "Z9", url: "https://book-ibomair.crane.aero/", color: "#0057a8", abbr: "IA" },
  { name: "Arik Air", code: "W3", url: "https://arikair.crane.aero/", color: "#cc0000", abbr: "WK" },
  { name: "XE Jet", code: "XE", url: "https://booking.xejet.com/vars/public/CustomerPanels/AgentLoginBS.aspx", color: "#1a1a2e", abbr: "XE" },
  { name: "Rano Air", code: "RN", url: "https://www.ranoair.com", color: "#004080", abbr: "RA" },
  { name: "United Nigeria", code: "UNN", url: "https://booking.flyunitednigeria.com/VARS/Public/b/Dashboard.aspx", color: "#006633", abbr: "UN" },
  { name: "Enugu Air", code: "EA", url: "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx", color: "#8b0000", abbr: "EA" },
  { name: "ValueJet", code: "VJ", url: "https://kiu.click/login/", color: "#ff6600", abbr: "VJ" },
];

// NOTE: original source filenames used inconsistent casing (e.g. "P4_logo.svg" while the
// actual file on disk is "p4_logo.svg"). That silently broke logo loading on
// case-sensitive hosts (Linux/Vercel). Fixed here to lowercase, matching the actual files.
export const AIRLINE_LOGO_MAP: Record<string, string> = {
  P4: "/airline-logos/p4_logo.svg",
  NGE: "/airline-logos/nge_logo.svg",
  NG: "/airline-logos/ng_logo.svg",
  Z9: "/airline-logos/z9_logo.svg",
  W3: "/airline-logos/w3_logo.svg",
  XE: "/airline-logos/xe_logo.svg",
  RN: "/airline-logos/rn_logo.svg",
  UNN: "/airline-logos/unn_logo.svg",
  EA: "/airline-logos/ea_logo.svg",
  VJ: "/airline-logos/vj_logo.svg",
};

export const ROLES: { value: string; label: string; isAdmin: boolean }[] = [
  { value: "manager", label: "Operational Manager", isAdmin: true },
  { value: "agent", label: "Staff Agent", isAdmin: false },
  { value: "independent", label: "TDIS Independent Agent", isAdmin: false },
  { value: "frontdesk", label: "Front Desk Staff", isAdmin: false },
];

export function getRoleLabel(role: string): string {
  if (role === "admin") return "Operational Manager";
  if (role === "staff") return "Staff Agent";
  const found = ROLES.find((r) => r.value === role);
  return found ? found.label : role;
}

export function isAdminRole(role: string): boolean {
  if (role === "admin" || role === "superadmin") return true;
  return ROLES.some((r) => r.value === role && r.isAdmin);
}

export const ADMIN_PERMISSIONS = [
  "view_all",
  "manage_users",
  "manage_balances",
  "view_analytics",
  "edit_clients",
  "delete_bookings",
  "view_balances",
  "update_bookings",
  "manage_clients",
  "view_clients",
];

export const STAFF_PERMISSIONS = ["view_balances", "update_bookings", "manage_clients", "view_clients"];

export const ALL_PERMISSIONS = [
  { id: "view_balances", label: "View Balances" },
  { id: "manage_balances", label: "Update Balances" },
  { id: "view_clients", label: "View Clients" },
  { id: "manage_clients", label: "Manage Clients" },
  { id: "update_bookings", label: "Update Bookings" },
  { id: "delete_bookings", label: "Delete Bookings" },
  { id: "view_analytics", label: "View Analytics" },
  { id: "manage_users", label: "Manage Users" },
];

export const LOCAL_CREDENTIALS = [
  {
    email: "admin@tdis.com",
    password: "admin123",
    name: "Admin User",
    role: "admin" as const,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    email: "agent@tdis.com",
    password: "agent123",
    name: "Agent One",
    role: "staff" as const,
    permissions: STAFF_PERMISSIONS,
  },
];

export const DEFAULT_USERS: AppUser[] = [
  {
    id: 1,
    username: "admin",
    password: "admin123",
    name: "Admin User",
    role: "admin",
    permissions: ADMIN_PERMISSIONS,
    status: "active",
    createdAt: new Date("2024-01-01").toISOString(),
  },
  {
    id: 2,
    username: "agent1",
    password: "agent123",
    name: "Agent One",
    role: "staff",
    permissions: STAFF_PERMISSIONS,
    status: "active",
    createdAt: new Date("2024-01-01").toISOString(),
  },
  {
    id: 3,
    username: "agent2",
    password: "agent123",
    name: "Agent Two",
    role: "staff",
    permissions: STAFF_PERMISSIONS,
    status: "active",
    createdAt: new Date("2024-01-01").toISOString(),
  },
];

export const DEBT_BANKS: Record<string, { acct: string; holder: string; name: string }> = {
  zenith: { acct: "1234567890", holder: "TDIS Logistics Ltd", name: "Zenith Bank" },
  gtbank: { acct: "0987654321", holder: "TDIS Logistics Ltd", name: "GTBank" },
  access: { acct: "1122334455", holder: "TDIS Logistics Ltd", name: "Access Bank" },
};

export const DEFAULT_SETTINGS: SystemSettings = {
  companyName: "TDIS Logistics Ltd",
  iataCode: "",
  companyPhone: "",
  companyEmail: "",
  companyAddress: "",
  thresholdCritical: 200000,
  thresholdLow: 500000,
  features: { goals: true, clientDebt: true, staffPerformance: true, auditLog: true },
  invoicePrefix: "TDIS-",
  invoiceStartNum: 1001,
  markupRate: 0,
  markupLabel: "Service Charge",
  commissionRates: {},
  spendingLimits: {},
};

// Icon values are lucide-react icon names (see src/components/layout/Sidebar.tsx
// and src/lib/icon-map.tsx for the key -> component mapping). Using string keys
// here keeps this file framework-agnostic and easy to scan.
export const SIDEBAR_SECTIONS: {
  label: string;
  items: { id: string; icon: string; label: string; requiresAdmin?: boolean; permission?: string }[];
}[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", icon: "layout-dashboard", label: "Dashboard" },
      { id: "goals", icon: "target", label: "Goals & Targets" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "airlines", icon: "building-2", label: "Airlines" },
      { id: "balances", icon: "wallet", label: "Airline Deposits" },
      { id: "availableTkt", icon: "ticket", label: "Available TKT to Issue", permission: "update_bookings" },
      { id: "clients", icon: "users", label: "Clients", permission: "view_clients" },
    ],
  },
  {
    label: "Client Accounts",
    items: [
      { id: "clientDebt", icon: "book-open", label: "Client Debt Tracker" },
      { id: "debtDashboard", icon: "line-chart", label: "Debt Dashboard" },
    ],
  },
  {
    label: "System",
    items: [{ id: "admin", icon: "settings", label: "Admin Dashboard", requiresAdmin: true }],
  },
];

// NOTE: "Team Management" (Staff Directory) is intentionally removed from
// navigation for this phase — see StaffSection.tsx, which is kept in the
// codebase untouched so it can be re-added to SIDEBAR_SECTIONS and the
// page.tsx section router later without rebuilding it.

export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.flatMap((s) => s.items.map((i) => [i.id, i.label]))
);
