import * as XLSX from "xlsx";
import type { DrCr, RawTransactionRow, TransactionKind } from "../core/types";

export interface ParsedExcelResult {
  rows: RawTransactionRow[];
  warnings: string[];
  detectedColumns: Record<string, string>;
}

type McoColumnField = "user" | "paymentType" | "debit" | "credit" | "mco" | "pnr" | "paymentDate";

// Calibrated against real "MCO INVOICE REPORT" exports (Hitit/VARS
// booking-engine style): headers are "Payment Date", "Payment Type",
// "Debit", "Credit", "MCO Reference", "MCO Definition", "User", "User
// Name", "Revenue Date", "PNR", "Ticket No", "Passengers Name And
// Surname", "Balance". Debit/Credit are separate numeric columns, not a
// combined "PT Debit"-style label — direction comes from whichever one
// is non-zero. Matched by exact name first, then a keyword fallback in
// case a different export tool uses different headers. Used by
// AERO/AIRPEACE/IBOM/ARIK.
const MCO_COLUMN_ALIASES: Record<McoColumnField, string[]> = {
  user: ["user"],
  paymentType: ["payment type", "tran type", "transaction type", "trans type"],
  debit: ["debit"],
  credit: ["credit"],
  mco: ["mco reference", "mco ref", "mco no", "mco number"],
  pnr: ["pnr"],
  paymentDate: ["payment date", "revenue date"],
};

type TicketReportColumnField = "agentId" | "status" | "netFare" | "ticketNo" | "pnr" | "issueDate";

// Calibrated against real "ticket sales report" exports from the shared
// VARS/Videcom connector base (Hitit/VARS again, but a different report
// template): headers are "Passenger Name", "PNR", "Route", "Class",
// "Ticket#", "Date of Issue Local", "Flt#", "Flight Date", "Status",
// "Face-Value", a handful of tax sub-columns that vary by airline (NG/BF/
// BO/JY/PSC/QT/VAT/YQ), "Total Tax", "Comm. Paid", "Comm.", "Net Fare",
// "W/Tax", "Agent ID", "Manual TKT No", "Running Credit Value (NGN)". No
// Payment Type/Debit/Credit at all — direction and amount both come from
// the single (signed) "Net Fare" column, and the transaction type comes
// from "Status" (ETKT/VOID/REFUND/IN01/CF01/CF02/NOSH/NS01/NS02) instead
// of a PT/PM/CL/RT code. Used by UNITED/RANO/ENUGU/XEJET — see
// normalizeTicketReportKind for how each Status maps onto the shared
// TransactionKind vocabulary.
const TICKET_REPORT_COLUMN_ALIASES: Record<TicketReportColumnField, string[]> = {
  agentId: ["agent id"],
  status: ["status"],
  netFare: ["net fare"],
  ticketNo: ["ticket#", "ticket #", "ticket no"],
  pnr: ["pnr"],
  issueDate: ["date of issue local", "date of issue"],
};

function normalizeHeader(h: string): string {
  return h.toString().trim().toLowerCase();
}

function isBlank(cell: unknown): boolean {
  return cell == null || String(cell).trim() === "";
}

function findHeaderRowFor<F extends string>(
  matrix: unknown[][],
  aliases: Record<F, string[]>,
  isComplete: (columns: Partial<Record<F, number>>) => boolean
): { rowIndex: number; columns: Partial<Record<F, number>> } | null {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;
    const columns: Partial<Record<F, number>> = {};
    row.forEach((cell, colIndex) => {
      if (cell == null) return;
      const header = normalizeHeader(String(cell));
      for (const [field, fieldAliases] of Object.entries(aliases) as [F, string[]][]) {
        if (columns[field] != null) continue;
        if (fieldAliases.some((alias) => header === alias || header.includes(alias))) {
          columns[field] = colIndex;
        }
      }
    });
    if (isComplete(columns)) return { rowIndex: i, columns };
  }
  return null;
}

// A usable MCO header row needs at minimum a user, payment type, and at
// least one of debit/credit — everything else (MCO ref, PNR, date) is
// useful but not required for every source layout.
function findMcoHeaderRow(matrix: unknown[][]) {
  return findHeaderRowFor(matrix, MCO_COLUMN_ALIASES, (c) => c.user != null && c.paymentType != null && (c.debit != null || c.credit != null));
}

// A usable ticket-report header row needs at minimum an Agent ID, Status,
// and Net Fare column — the tax sub-columns and Ticket#/PNR/date are
// useful but not required to recognize the layout.
function findTicketReportHeaderRow(matrix: unknown[][]) {
  return findHeaderRowFor(matrix, TICKET_REPORT_COLUMN_ALIASES, (c) => c.agentId != null && c.status != null && c.netFare != null);
}

// Exported so the screenshot parser produces byte-for-byte identical
// RawTransactionRows from the same PT/PM/CL/RT codes and numeric strings
// — the rule engine must not be able to tell which input a row came from.
export function normalizeKind(paymentType: string): TransactionKind {
  const t = paymentType.trim().toUpperCase();
  if (t === "PT" || t === "PM" || t === "CL" || t === "RT") return t;
  return "OTHER";
}

// Maps a ticket-report "Status" value onto the same TransactionKind
// vocabulary the MCO format uses, so both layouts feed the rule engine
// identically. ETKT is a real ticket sale (PT — same conceptual role as
// an MCO PT Debit). VOID and REFUND both cancel a previously issued
// ticket (RT — matched against a same-batch ETKT by Ticket# in
// TicketReportRules.ts, the same role an MCO RT plays against a PT).
// IN01/CF01/CF02/NOSH/NS01/NS02 are ancillary fee/no-show line items, not
// ticket sales (PM — every airline's rules already ignore PM outright).
export function normalizeTicketReportKind(status: string): TransactionKind {
  const s = status.trim().toUpperCase();
  if (s === "ETKT") return "PT";
  if (s === "VOID" || s === "REFUND") return "RT";
  if (s === "IN01" || s === "CF01" || s === "CF02" || s === "NOSH" || s === "NS01" || s === "NS02") return "PM";
  return "OTHER";
}

export function toNumber(cell: unknown): number {
  if (typeof cell === "number") return cell;
  if (cell == null) return 0;
  const n = parseFloat(String(cell).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

// Source dates arrive as "DD/MM/YYYY HH:MM:SS" (sometimes with a
// malformed time portion, e.g. "17:27:3") — only the date portion is
// used for reporting, so a strict time parse isn't needed.
export function extractDate(cell: unknown): string | null {
  if (cell == null) return null;
  const match = String(cell).match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
  return match ? match[1] : null;
}

function parseMcoRows(
  matrix: unknown[][],
  header: { rowIndex: number; columns: Partial<Record<McoColumnField, number>> }
): { rows: RawTransactionRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (header.columns.mco == null) {
    warnings.push("No MCO Reference column found — Air Peace's PT/RT cancellation matching will not work without it.");
  }

  const rows: RawTransactionRow[] = [];
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const cell = (field: McoColumnField): unknown => {
      const idx = header.columns[field];
      return idx != null ? row[idx] : null;
    };

    const user = cell("user");
    const paymentTypeRaw = cell("paymentType");
    const debit = toNumber(cell("debit"));
    const credit = toNumber(cell("credit"));
    if (user == null && paymentTypeRaw == null && debit === 0 && credit === 0) continue; // fully blank row

    if (user == null || paymentTypeRaw == null) {
      warnings.push(`Row ${i + 1}: missing User or Payment Type — skipped.`);
      continue;
    }

    const amount = debit !== 0 ? debit : credit;
    const drCr: DrCr = debit !== 0 ? "DEBIT" : credit !== 0 ? "CREDIT" : null;
    if (drCr == null) {
      warnings.push(`Row ${i + 1}: both Debit and Credit are zero — skipped.`);
      continue;
    }

    const kind = normalizeKind(String(paymentTypeRaw));
    if (kind === "OTHER") {
      warnings.push(`Row ${i + 1}: unrecognized Payment Type "${paymentTypeRaw}" — treated as not-a-sale, please review.`);
    }

    const mcoCell = cell("mco");
    const pnrCell = cell("pnr");

    rows.push({
      rowIndex: i + 1,
      user: String(user).trim(),
      kind,
      drCr,
      paymentTypeLabel: String(paymentTypeRaw).trim(),
      amount,
      mcoReference: mcoCell != null ? String(mcoCell).trim() : null,
      pnr: pnrCell != null ? String(pnrCell).trim() : null,
      date: extractDate(cell("paymentDate")),
      raw: row.map((c) => (c == null ? "" : String(c))).join(" | "),
    });
  }

  return { rows, warnings };
}

function parseTicketReportRows(
  matrix: unknown[][],
  header: { rowIndex: number; columns: Partial<Record<TicketReportColumnField, number>> }
): { rows: RawTransactionRow[]; warnings: string[] } {
  const warnings: string[] = [];

  const rows: RawTransactionRow[] = [];
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const cell = (field: TicketReportColumnField): unknown => {
      const idx = header.columns[field];
      return idx != null ? row[idx] : null;
    };

    const agentIdCell = cell("agentId");
    const statusCell = cell("status");
    const netFareCell = cell("netFare");

    // Covers both the blank "Currency NGN" filler row these exports
    // include right after the header, and any other genuinely empty row.
    if (isBlank(agentIdCell) && isBlank(statusCell) && toNumber(netFareCell) === 0) continue;

    // Also covers the "TOTALS for NGN" footer row: its Status cell lands
    // empty even though Net Fare/Agent ID happen to hold real numbers at
    // that point (the footer's column layout doesn't match the header's),
    // so requiring Status specifically rejects it without a separate
    // "is this the totals row" text check.
    if (isBlank(agentIdCell) || isBlank(statusCell)) {
      warnings.push(`Row ${i + 1}: missing Agent ID or Status — skipped.`);
      continue;
    }

    const netFare = toNumber(netFareCell);
    const drCr: DrCr = netFare >= 0 ? "DEBIT" : "CREDIT";
    const kind = normalizeTicketReportKind(String(statusCell));
    if (kind === "OTHER") {
      warnings.push(`Row ${i + 1}: unrecognized Status "${statusCell}" — treated as not-a-sale, please review.`);
    }

    const ticketCell = cell("ticketNo");
    const pnrCell = cell("pnr");

    rows.push({
      rowIndex: i + 1,
      user: String(agentIdCell).trim(),
      kind,
      drCr,
      paymentTypeLabel: String(statusCell).trim(),
      amount: Math.abs(netFare),
      // Repurposed: this format has no MCO reference at all — Ticket#
      // plays the identical "match a cancellation to the sale it
      // cancels" role (see TicketReportRules.ts).
      mcoReference: isBlank(ticketCell) ? null : String(ticketCell).trim(),
      pnr: isBlank(pnrCell) ? null : String(pnrCell).trim(),
      date: extractDate(cell("issueDate")),
      raw: row.map((c) => (c == null ? "" : String(c))).join(" | "),
    });
  }

  return { rows, warnings };
}

export function parseExcelBuffer(buffer: Buffer): ParsedExcelResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

  const mcoHeader = findMcoHeaderRow(matrix);
  if (mcoHeader) {
    const { rows, warnings } = parseMcoRows(matrix, mcoHeader);
    const detectedColumns: Record<string, string> = {};
    for (const [field, colIndex] of Object.entries(mcoHeader.columns) as [McoColumnField, number][]) {
      const headerCell = matrix[mcoHeader.rowIndex][colIndex];
      if (headerCell != null) detectedColumns[field] = String(headerCell);
    }
    return { rows, warnings, detectedColumns };
  }

  const ticketReportHeader = findTicketReportHeaderRow(matrix);
  if (ticketReportHeader) {
    const { rows, warnings } = parseTicketReportRows(matrix, ticketReportHeader);
    const detectedColumns: Record<string, string> = {};
    for (const [field, colIndex] of Object.entries(ticketReportHeader.columns) as [TicketReportColumnField, number][]) {
      const headerCell = matrix[ticketReportHeader.rowIndex][colIndex];
      if (headerCell != null) detectedColumns[field] = String(headerCell);
    }
    return { rows, warnings, detectedColumns };
  }

  return {
    rows: [],
    warnings: [
      "Couldn't find a recognizable header row (need at least a User, Payment Type, and Debit/Credit column for an MCO invoice report, or an Agent ID, Status, and Net Fare column for a ticket sales report) — this file's layout may need a new column alias added to the parser.",
    ],
    detectedColumns: {},
  };
}
