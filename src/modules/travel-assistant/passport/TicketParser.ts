import { museVisionJsonCompletion } from "../ai/museClient";

export interface TicketParseResult {
  isTicket: boolean;
  readable: boolean;
  passengerNames: string[]; // every passenger listed, in printed order — a booking can hold several
  pnr: string | null; // validated 5-6 alphanumeric — never a 13-digit ticket number, see validatePnr
  ticketNumber: string | null; // validated ~10-14 digit ticket/e-ticket number, when a real PNR isn't shown
}

// A ticket counts here when it has at least one passenger name AND at
// least one real identifier (PNR or ticket number) — a PNR alone was the
// original bar, but a real ticket often shows only a 13-digit ticket
// number with no separate PNR visible at all, and that's still a valid,
// useful extraction (see the worked example this prompt is calibrated
// against). Anything short of a name + an identifier falls through as
// "not a ticket" rather than a half-filled result.
const EXTRACTION_PROMPT = `You are looking at a photo, most likely a screenshot of an airline booking/ticket confirmation.

Determine whether it is an ISSUED AIRLINE TICKET or BOOKING/RESERVATION CONFIRMATION belonging to a passenger — it must clearly show at least one full passenger name, AND at least one of: a PNR/booking reference, or a ticket number.

This includes NOT JUST a classic e-ticket/boarding-pass design — it very often looks like a screenshot of a booking engine's own webpage, e.g. a green-branded "Manage My Booking" page (Enugu Air and similar carriers on the shared VARS/Videcom booking platform) showing the PNR in large text near the top, a "Manage My Booking" heading with the PNR repeated beside it, flight route/date/time, one or more passenger rows (name, "Adult"/"Child", check-in status), and possibly a "TTL Payment Instructions" / "Outstanding payment" / "Payment Summary" section below — that whole page counts as a ticket/booking confirmation for this purpose (it doesn't need to already be paid/issued — a held booking with a visible PNR and passenger name(s) still counts).

A single booking/PNR very often covers MULTIPLE passengers travelling together — list every one shown, not just the first.

CAREFULLY DISTINGUISH these two DIFFERENT identifiers — do not confuse one for the other:
- PNR / Booking Reference / Record Locator: SHORT — normally 5 or 6 characters, letters and/or digits (e.g. "AB12CD", "LQ8R2P", "F3J6LK").
- Ticket Number / E-Ticket Number: LONG — usually 13 digits, all-numeric (e.g. "7252108185858"). If the only reference-looking value on the page is a long digit string like this, it is the TICKET NUMBER, not the PNR — a 13-digit number must never be returned as "pnr".
- IGNORE and do not return as either: invoice number, receipt number, transaction ID, barcode number, QR code data, payment reference, tax number — none of these are a PNR or a ticket number.

It is NOT a ticket for this purpose if:
- It's a government-issued photo ID card (passport, National ID, driver's license, voter's card) — that's a different document type, handled elsewhere.
- It's a payment/bank transfer receipt, invoice, or transaction confirmation.
- It's a flight SEARCH RESULTS page (flight times/prices being compared, no confirmed booking/PNR yet).
- No passenger name is legible, or neither a PNR nor a ticket number is legible.
- Any other unrelated image.

If it is NOT a ticket (by this strict definition), return exactly: {"isTicket": false}

If it IS a ticket, extract:
- "readable": true only if at least one passenger name AND at least one of (pnr, ticketNumber) are clearly legible, false otherwise.
- "passengerNames": an array of every passenger's full name exactly as printed, in the order they're listed on the page. A single-passenger booking still returns a one-element array.
- "pnr": the PNR/booking reference exactly as printed, ONLY if it matches the short 5-6 character shape above — otherwise null. Do not guess or force-fit a longer value into this field.
- "ticketNumber": the ticket/e-ticket number exactly as printed, ONLY if it matches the long all-digit shape above — otherwise null.

Rules:
- Never invent or guess a value. If you are not genuinely confident a field is correct and clearly legible, return null for it rather than a low-confidence guess — accuracy matters more than filling every field.
- If no name at all is legible, use an empty array for passengerNames.
- Return ONLY a JSON object, e.g.: {"isTicket": true, "readable": true, "passengerNames": ["John Michael Doe"], "pnr": null, "ticketNumber": "7252108185858"}`;

interface VisionResult {
  isTicket?: unknown;
  readable?: unknown;
  passengerNames?: unknown;
  pnr?: unknown;
  ticketNumber?: unknown;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// A round-trip (or multi-leg) booking lists the SAME passenger once per
// leg — confirmed live: a 2-leg round trip returned "SEYI ADEKUNLE" twice.
// Dedupe case/whitespace-insensitively so a shared PNR with one traveller
// on multiple legs still returns just the one name, while a booking with
// genuinely different passengers keeps every distinct one.
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const names = v.map((item) => str(item)).filter((s): s is string => s != null);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(name);
  }
  return deduped;
}

// Deterministic validation, not just prompt guidance — same reasoning as
// every other extraction rule in this codebase: the model can still return
// a value in the wrong shape, so the format itself is the real check.
const PNR_PATTERN = /^[A-Z0-9]{5,6}$/;
const TICKET_NUMBER_PATTERN = /^\d{10,14}$/;

function validatePnr(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  return PNR_PATTERN.test(cleaned) ? cleaned : null;
}

function validateTicketNumber(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s-]+/g, "");
  return TICKET_NUMBER_PATTERN.test(cleaned) ? cleaned : null;
}

const NOT_A_TICKET: TicketParseResult = {
  isTicket: false,
  readable: false,
  passengerNames: [],
  pnr: null,
  ticketNumber: null,
};

export async function parseTicketImage(buffer: Buffer, mimeType: string): Promise<TicketParseResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  // CORRECTED (2026-08-15, live): same fix as PassportParser.ts's identical
  // pattern — swallowing a genuine museVisionJsonCompletion failure (Groq
  // rate-limited/unreachable) into the same silent "not a ticket" path a
  // malformed-JSON response gets below made a real service outage
  // indistinguishable from "this just isn't a ticket," and DocumentParser.ts
  // runs this concurrently with parseIdDocumentImage — so a vision-API
  // outage produced a WhatsApp ID/ticket upload with NO reply at all. A
  // genuine API/network failure now propagates instead, so the caller's own
  // catch block (imageHandler.ts) sends an honest error instead of silence.
  const raw = await museVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NOT_A_TICKET;
  }

  if (parsed.isTicket !== true) return NOT_A_TICKET;

  const passengerNames = strArray(parsed.passengerNames);
  let pnr = validatePnr(str(parsed.pnr));
  let ticketNumber = validateTicketNumber(str(parsed.ticketNumber));

  // Intelligent correction: a 13-digit ticket number sitting in "pnr"
  // fails validatePnr's shape check above and would otherwise just be
  // dropped — but it's real data, so re-check it against the ticket-number
  // shape instead of discarding it (this is the exact live-confirmed bug:
  // "7252108185858" returned as PNR).
  if (!pnr && !ticketNumber) {
    ticketNumber = validateTicketNumber(str(parsed.pnr));
  }

  const hasIdentifier = pnr != null || ticketNumber != null;
  const readable = parsed.readable === true && passengerNames.length > 0 && hasIdentifier;

  if (passengerNames.length === 0 || !hasIdentifier) return NOT_A_TICKET;

  return {
    isTicket: true,
    readable,
    passengerNames,
    pnr,
    ticketNumber,
  };
}
