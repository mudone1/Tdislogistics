// Normalized transaction shape the rule engine operates on — decoupled
// from whatever raw column layout a given Excel export or screenshot
// happens to use. The parsing layer is responsible for producing this
// shape; the rule engine never looks at raw file structure.
//
// Calibrated against real MCO invoice report exports: "Payment Type" is
// always a bare code (PT/PM/CL/RT) — "Deposit" and "Commission Payback"
// aren't distinct types, they're just PM rows with descriptive text in
// the "MCO Definition" column. Every airline's rules ignore PM outright
// regardless of that description, so no separate kind is needed for them.
export type TransactionKind = "PT" | "PM" | "CL" | "RT" | "OTHER";

export type DrCr = "DEBIT" | "CREDIT" | null;

export interface RawTransactionRow {
  rowIndex: number;
  user: string; // raw reservation-software code, e.g. "TDISLOGIST-FLORENCE AINA"
  kind: TransactionKind;
  drCr: DrCr;
  paymentTypeLabel: string; // original label as it appeared in the source, kept for audit/display
  amount: number;
  mcoReference: string | null;
  pnr: string | null;
  date: string | null; // "DD/MM/YYYY", from the source's payment date column
  raw: string; // original row text/line, verbatim
}

export type TransactionStatus =
  | "INCLUDED"
  | "SYSTEM_CL_DEBIT"
  | "CANCELLED_BY_RT"
  | "IGNORED_PM"
  | "IGNORED_CREDIT"
  | "IGNORED_RT"
  | "IGNORED_OTHER";

export interface ClassifiedTransaction extends RawTransactionRow {
  staffName: string; // resolved display name, or "SYSTEM"
  isSystem: boolean;
  included: boolean;
  status: TransactionStatus;
}

export interface StaffTotal {
  staffName: string;
  amount: number;
  transactionCount: number;
}

export interface RuleEngineResult {
  transactions: ClassifiedTransaction[];
  staffTotals: StaffTotal[]; // SYSTEM always last
  grandTotal: number;
  ticketCount: number; // count of included PT-kind transactions
}

export const AIRLINE_RULE_KEYS = ["AERO", "AIRPEACE", "IBOM", "ARIK"] as const;
export type AirlineRuleKey = (typeof AIRLINE_RULE_KEYS)[number];
