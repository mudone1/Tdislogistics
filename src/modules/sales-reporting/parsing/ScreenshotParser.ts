import { groqVisionJsonCompletion } from "../../travel-assistant/ai/groqClient";
import { normalizeKind, toNumber, extractDate } from "./ExcelParser";
import type { DrCr, RawTransactionRow } from "../core/types";

export interface ParsedScreenshotResult {
  rows: RawTransactionRow[];
  warnings: string[];
}

// The vision model is asked for exactly the same fields the Excel header
// detection produces (see ExcelParser's COLUMN_ALIASES) so both inputs
// converge on the identical RawTransactionRow shape. Deliberately does NOT
// ask the model to apply any airline rules, filter anything, or compute
// totals — that stays in the deterministic rule engine. Its only job is
// faithful transcription of what's visible, "like a data-entry clerk, not
// an accountant".
const EXTRACTION_PROMPT = `You are transcribing a Nigerian airline "MCO Invoice Report" screenshot into structured data. This is an accounting report with one row per transaction.

Extract EVERY transaction row you can see. For each row return these fields exactly:
- "user": the reservation-software user code, verbatim (e.g. "TDISLOGIST-FLORENCE AINA", "TA0051-KATE GODWIN", "Hitit Admin-SYSTEM"). Never abbreviate or "correct" it.
- "paymentType": the bare transaction-type code only — one of "PT", "PM", "CL", "RT". If the cell shows anything else, put it verbatim.
- "debit": the Debit column amount as a plain number (no commas/currency). Use 0 if the debit cell is empty.
- "credit": the Credit column amount as a plain number. Use 0 if the credit cell is empty.
- "mcoReference": the MCO Reference value, or null if absent.
- "pnr": the PNR value, or null if absent.
- "paymentDate": the payment/revenue date as "DD/MM/YYYY", or null if absent.

Rules:
- Transcribe faithfully. Do NOT skip refunds, credits, deposits, or PM rows — include everything; filtering happens later.
- Never invent rows or values. If a number is unreadable, use 0 and it will be flagged.
- A row has EITHER a debit OR a credit, not both — whichever column the amount is in.
- Return ONLY a JSON object of the form: {"rows": [ {"user": "...", "paymentType": "PT", "debit": 439588, "credit": 0, "mcoReference": "...", "pnr": "...", "paymentDate": "19/07/2026"}, ... ]}`;

interface VisionRow {
  user?: unknown;
  paymentType?: unknown;
  debit?: unknown;
  credit?: unknown;
  mcoReference?: unknown;
  pnr?: unknown;
  paymentDate?: unknown;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// One or more screenshots of ONE report (long/split screenshots of the
// same report are passed together and merged into a single row list, in
// the order given — matching the spec's "merge them into one report
// before processing").
export async function parseScreenshotBuffers(
  images: { name: string; buffer: Buffer; mimeType: string }[]
): Promise<ParsedScreenshotResult> {
  const dataUrls = images.map((img) => `data:${img.mimeType};base64,${img.buffer.toString("base64")}`);

  const raw = await groqVisionJsonCompletion(EXTRACTION_PROMPT, dataUrls);

  let parsed: { rows?: VisionRow[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The vision model returned unreadable output for that screenshot — try a clearer image or use the Excel export.");
  }

  const visionRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const warnings: string[] = [];
  const rows: RawTransactionRow[] = [];

  visionRows.forEach((vr, i) => {
    const user = str(vr.user);
    const paymentTypeRaw = str(vr.paymentType);
    const debit = toNumber(vr.debit);
    const credit = toNumber(vr.credit);

    if (!user && !paymentTypeRaw && debit === 0 && credit === 0) return; // blank/hallucinated-empty row

    if (!user || !paymentTypeRaw) {
      warnings.push(`Screenshot row ${i + 1}: missing user or payment type — skipped.`);
      return;
    }

    const amount = debit !== 0 ? debit : credit;
    const drCr: DrCr = debit !== 0 ? "DEBIT" : credit !== 0 ? "CREDIT" : null;
    if (drCr == null) {
      warnings.push(`Screenshot row ${i + 1}: no debit or credit amount — skipped.`);
      return;
    }

    const kind = normalizeKind(paymentTypeRaw);
    if (kind === "OTHER") {
      warnings.push(`Screenshot row ${i + 1}: unrecognized payment type "${paymentTypeRaw}" — treated as not-a-sale, please review.`);
    }

    rows.push({
      rowIndex: i + 1,
      user,
      kind,
      drCr,
      paymentTypeLabel: paymentTypeRaw,
      amount,
      mcoReference: str(vr.mcoReference),
      pnr: str(vr.pnr),
      date: extractDate(str(vr.paymentDate)),
      raw: `${user} | ${paymentTypeRaw} | ${debit || credit} | ${str(vr.mcoReference) ?? ""} | ${str(vr.pnr) ?? ""}`,
    });
  });

  if (rows.length === 0) {
    warnings.push("No transaction rows could be read from the screenshot(s).");
  }

  return { rows, warnings };
}
