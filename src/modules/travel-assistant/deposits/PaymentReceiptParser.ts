import { groqVisionJsonCompletion } from "../ai/groqClient";

export interface PaymentReceiptParseResult {
  isPaymentReceipt: boolean;
  readable: boolean;
  amount: number | null;
  paymentDate: string | null; // "YYYY-MM-DD" if legible, else null — NOT used as the deposit's own date (see depositDateLagos in the repository), just for display/audit
  paymentTime: string | null; // raw time text as printed, e.g. "06:21:55 AM"
  referenceNumber: string | null;
  narration: string | null;
  bankChannel: string | null;
}

// One combined classify+extract vision call, same cost/latency reasoning
// as PassportParser.ts. Deliberately does NOT attempt to determine
// credited/not-credited status here — a receipt's own "Successful"/
// "Status: Success" only means the TRANSFER itself succeeded, not that the
// receiving airline has reconciled/credited the deposit internally. That
// distinction is a human judgment call made via a chat reply (see
// depositTracking.ts), never inferred from the image.
const EXTRACTION_PROMPT = `You are looking at a photo. Determine whether it is a bank transfer receipt, payment confirmation, transaction receipt, or mobile-money/fintech receipt (e.g. Zenith Bank, First Bank, GTBank, Access Bank, Paystack, OPay, or any other bank/payment provider) — the kind of screenshot someone shares to prove a payment was made.

It is NOT a payment receipt if it's an ID card, passport, ticket, boarding pass, or unrelated photo. If it is NOT a payment receipt, return exactly: {"isPaymentReceipt": false}

If it IS a payment receipt, extract using the receipt's own LABELED FIELDS — read exactly what's printed, never estimate or invent a value. If a field genuinely isn't shown on this particular receipt, use null for it — different banks/providers show different fields, and that's expected.
- "readable": true if the amount is clearly legible (the single most important field), false otherwise.
- "amount": the transaction amount as a plain number, no currency symbol, no commas — e.g. "₦2,000,000.00" -> 2000000. Use the amount actually transferred/paid, not a balance or fee.
- "paymentDate": the transaction date as "YYYY-MM-DD" if shown and legible (e.g. "13-08-2026" or "August 14, 2026" -> "2026-08-14"), else null.
- "paymentTime": the transaction time exactly as printed (e.g. "06:21:55 AM"), else null.
- "referenceNumber": the transaction reference, session ID, or reference ID if shown (e.g. "EXTTRF|1786771315484781" or a Session ID), else null.
- "narration": the narration/description/remark field exactly as printed (e.g. "TRF TO FLYFORVALUE AVIATION LTD-COLLECTION ACCOUNT//TDIS DEPOSIT", "Top up", "TDIS"), else null. This is usually the most important field for figuring out which airline the payment is for, so copy it in full and exactly as shown, do not summarize or shorten it.
- "bankChannel": the bank or payment channel name shown on the receipt (e.g. "Zenith Bank", "FirstBank", "PAYSTACK TITAN", "GTBank"), else null.

Never invent or guess a value — if a field cannot be read, use null for it. Return ONLY a JSON object, e.g.: {"isPaymentReceipt": true, "readable": true, "amount": 2000000, "paymentDate": "2026-08-14", "paymentTime": "22:09:05", "referenceNumber": "0000162608142209060025423145I5", "narration": "Top up", "bankChannel": "FirstBank"}`;

interface VisionResult {
  isPaymentReceipt?: unknown;
  readable?: unknown;
  amount?: unknown;
  paymentDate?: unknown;
  paymentTime?: unknown;
  referenceNumber?: unknown;
  narration?: unknown;
  bankChannel?: unknown;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NOT_A_RECEIPT: PaymentReceiptParseResult = {
  isPaymentReceipt: false,
  readable: false,
  amount: null,
  paymentDate: null,
  paymentTime: null,
  referenceNumber: null,
  narration: null,
  bankChannel: null,
};

export async function parsePaymentReceiptImage(buffer: Buffer, mimeType: string): Promise<PaymentReceiptParseResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  // Same reasoning as PassportParser.ts's 2026-08-15 fix: a genuine
  // vision-API failure must propagate (not fail closed into "not a
  // receipt"), so a real service outage is diagnosable rather than
  // indistinguishable from "this photo genuinely isn't a receipt".
  const raw = await groqVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NOT_A_RECEIPT;
  }

  if (parsed.isPaymentReceipt !== true) return NOT_A_RECEIPT;

  const amount = num(parsed.amount);
  const paymentDateRaw = str(parsed.paymentDate);
  const paymentDate = paymentDateRaw && ISO_DATE_RE.test(paymentDateRaw) ? paymentDateRaw : null;

  // Readability hinges on the amount alone — the one field a deposit
  // record is useless without; every other field is best-effort.
  const readable = parsed.readable === true && amount != null;

  return {
    isPaymentReceipt: true,
    readable,
    amount,
    paymentDate,
    paymentTime: str(parsed.paymentTime),
    referenceNumber: str(parsed.referenceNumber),
    narration: str(parsed.narration),
    bankChannel: str(parsed.bankChannel),
  };
}
