// Core data model for the TDIS Logistics dashboard.
// Mirrors the shapes used by the original vanilla-JS app 1:1 so that
// existing localStorage / Firestore data can be read without migration.

export type Role = "manager" | "agent" | "independent" | "frontdesk" | "admin" | "staff" | "superadmin";

export interface AppUser {
  id: number;
  username: string;
  password: string; // NOTE: preserved from the original app's local-auth model.
  name: string;
  role: Role;
  permissions: string[];
  status: "active" | "inactive";
  createdAt: string;
  phone?: string;
  email?: string;
}

export interface CurrentUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
  permissions: string[];
}

export interface Airline {
  name: string;
  code: string;
  url: string;
  color: string;
  abbr: string;
}

export interface Balance {
  airline: string;
  balance: number;
  updated: string;
}

export interface Deposit {
  id: number;
  airline: string;
  amount: number;
  date: string;
  time: string;
  loggedAt: string;
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string;
  preference?: string;
  createdAt: string;
}

export type BookingType = "Issued" | "On Hold";
export type PaymentStatus = "Pending" | "Paid" | "Partial" | "Cancelled";

export interface BookingUpdate {
  client: string;
  airline: string;
  amount: number;
  amountPaid: number;
  status: PaymentStatus;
  bookingType: BookingType;
  pnr: string;
  initiatedBy: string;
  updatedBy: string;
  updated: string;
  createdAt: string;
}

export interface SystemLog {
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

export interface SalesGoals {
  weekly?: number;
  monthly?: number;
  yearly?: number;
}

export type DebtTxType = "charge" | "payment";
export type DebtTxStatus = "pending" | "paid";

export interface DebtTransaction {
  id: string;
  date: string;
  desc: string;
  amount: number;
  type: DebtTxType;
  status: DebtTxStatus;
}

export interface DebtGroup {
  id: string;
  name: string;
  initialBill: number;
  transactions: DebtTransaction[];
  createdAt: string;
}

export interface SystemSettings {
  companyName: string;
  iataCode: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  thresholdCritical: number;
  thresholdLow: number;
  features: Record<string, boolean>;
  invoicePrefix: string;
  invoiceStartNum: number;
  markupRate: number;
  markupLabel: string;
  commissionRates: Record<string, number>;
  spendingLimits: Record<number, number>;
}

export type SectionId =
  | "dashboard"
  | "goals"
  | "airlines"
  | "balances"
  | "availableTkt"
  | "clients"
  | "staff"
  | "admin"
  | "clientDebt"
  | "debtDashboard";
