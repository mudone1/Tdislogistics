import * as XLSX from "xlsx";
import type { DrCr, RawTransactionRow, TransactionKind } from "../core/types";

export interface ParsedExcelResult {
  rows: RawTransactionRow[];
  warnings: string[];
  detectedColumns: Partial<Record<ColumnField, string>>;
}

type ColumnField = "user" | "paymentType" | "debit" | "credit" | "mco" | "pnr" | "paymentDate";

// Calibrated against real "MCO INVOICE REPORT" exports (Hitit/VARS
// booking-engine style): headers are "Payment Date", "Payment Type",
// "Debit", "Credit", "MCO Reference", "MCO Definition", "User", "User
// Name", "Revenue Date", "PNR", "Ticket No", "Passengers Name And
// Surname", "Balance". Debit/Credit are separate numeric columns, not a
// combined "PT Debit"-style label — direction comes from whichever one
// is non-zero. Matched by exact name first, then a keyword fallback in
// case a different export tool uses different headers.
const COLUMN_ALIASES: Record<ColumnField, string[]> = {
  user: ["user"],
  paymentType: ["payment type", "tran type", "transaction type", "trans type"],
  debit: ["debit"],
  credit: ["credit"],
  mco: ["mco reference", "mco ref", "mco no", "mco number"],
  pnr: ["pnr"],
  paymentDate: ["payment date", "revenue date"],
};

function normalizeHeader(h: string): string {
  return h.toString().trim().toLowerCase();
}

function findHeaderRow(matrix: unknown[][]): { rowIndex: number; columns: Partial<Record<ColumnField, number>> } | null {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;
    const columns: Partial<Record<ColumnField, number>> = {};
    row.forEach((cell, colIndex) => {
      if (cell == null) return;
      const header = normalizeHeader(String(cell));
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [ColumnField, string[]][]) {
        if (columns[field] != null) continue;
        if (aliases.some((alias) => header === alias || header.includes(alias))) {
          columns[field] = colIndex;
        }
      }
    });
    // A usable header row needs at minimum a user, payment type, and at
    // least one of debit/credit — everything else (MCO ref, PNR, date)
    // is useful but not required for every source layout.
    if (columns.user != null && columns.paymentType != null && (columns.debit != null || columns.credit != null)) {
      return { rowIndex: i, columns };
    }
  }
  return null;
}

// Exported so the screenshot parser produces byte-for-byte identical
// RawTransactionRows from the same PT/PM/CL/RT codes and numeric strings
// — the rule engine must not be able to tell which input a row came from.
export function normalizeKind(paymentType: string): TransactionKind {
  const t = paymentType.trim().toUpperCase();
  if (t === "PT" || t === "PM" || t === "CL" || t === "RT") return t;
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

export function parseExcelBuffer(buffer: Buffer): ParsedExcelResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

  const warnings: string[] = [];
  const header = findHeaderRow(matrix);
  if (!header) {
    return {
      rows: [],
      warnings: [
        "Couldn't find a recognizable header row (need at least a User, Payment Type, and Debit/Credit column) — this file's layout may need a new column alias added to the parser.",
      ],
      detectedColumns: {},
    };
  }

  const detectedColumns: Partial<Record<ColumnField, string>> = {};
  for (const [field, colIndex] of Object.entries(header.columns) as [ColumnField, number][]) {
    const headerCell = matrix[header.rowIndex][colIndex];
    detectedColumns[field] = headerCell != null ? String(headerCell) : undefined;
  }
  if (header.columns.mco == null) {
    warnings.push("No MCO Reference column found — Air Peace's PT/RT cancellation matching will not work without it.");
  }

  const rows: RawTransactionRow[] = [];
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const cell = (field: ColumnField): unknown => {
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

  return { rows, warnings, detectedColumns };
}
