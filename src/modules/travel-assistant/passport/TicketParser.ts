import { openaiVisionJsonCompletion } from "../ai/openaiClient";

export interface TicketParseResult {
  isTicket: boolean;
  readable: boolean;
  passengerFullName: string | null;
  pnr: string | null;
}

// Strict on purpose — per product spec, an image only counts as a ticket
// when BOTH a full passenger name AND a PNR are present and legible.
// Anything short of that (a bare search-results page, a name-only receipt)
// must fall through as "not a ticket" rather than a half-filled result, so
// callers can cleanly distinguish "nothing to extract" from "extraction
// failed" the same way PassportParser's readable flag does for IDs.
const EXTRACTION_PROMPT = `You are looking at a photo, most likely a screenshot of an airline booking/ticket confirmation.

Determine whether it is an ISSUED AIRLINE TICKET or BOOKING/RESERVATION CONFIRMATION belonging to a passenger — it must clearly show BOTH a full passenger name AND a PNR / booking reference / record locator (a short alphanumeric code, typically 5-8 characters, sometimes labeled "PNR", "Booking Reference", "Reservation Code", or similar).

This includes NOT JUST a classic e-ticket/boarding-pass design — it very often looks like a screenshot of a booking engine's own webpage, e.g. a green-branded "Manage My Booking" page (Enugu Air and similar carriers on the shared VARS/Videcom booking platform) showing the PNR in large text near the top, a "Manage My Booking" heading with the PNR repeated beside it, flight route/date/time, a passenger row (name, "Adult"/"Child", check-in status), and possibly a "TTL Payment Instructions" / "Outstanding payment" / "Payment Summary" section below — that whole page counts as a ticket/booking confirmation for this purpose (it doesn't need to already be paid/issued — a held booking with a visible PNR and passenger name still counts).

It is NOT a ticket for this purpose if:
- It's a government-issued photo ID card (passport, National ID, driver's license, voter's card) — that's a different document type, handled elsewhere.
- It's a payment/bank transfer receipt, invoice, or transaction confirmation.
- It's a flight SEARCH RESULTS page (flight times/prices being compared, no confirmed booking/PNR yet).
- Either the passenger name or the PNR is missing or not legible.
- Any other unrelated image.

If it is NOT a ticket (by this strict definition), return exactly: {"isTicket": false}

If it IS a ticket, extract:
- "readable": true only if BOTH the passenger's full name and the PNR are clearly legible, false otherwise.
- "passengerFullName": the passenger's full name exactly as printed. If there are multiple passengers, use the first/primary one listed.
- "pnr": the booking reference / PNR / record locator exactly as printed.

Rules:
- Never invent or guess a value — if either field can't be read, use null for it and set "readable" to false.
- Return ONLY a JSON object, e.g.: {"isTicket": true, "readable": true, "passengerFullName": "John Michael Doe", "pnr": "AB12CD"}`;

interface VisionResult {
  isTicket?: unknown;
  readable?: unknown;
  passengerFullName?: unknown;
  pnr?: unknown;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

const NOT_A_TICKET: TicketParseResult = {
  isTicket: false,
  readable: false,
  passengerFullName: null,
  pnr: null,
};

export async function parseTicketImage(buffer: Buffer, mimeType: string): Promise<TicketParseResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  let raw: string;
  try {
    raw = await openaiVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);
  } catch {
    return NOT_A_TICKET;
  }

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NOT_A_TICKET;
  }

  if (parsed.isTicket !== true) return NOT_A_TICKET;

  const passengerFullName = str(parsed.passengerFullName);
  const pnr = str(parsed.pnr);
  const readable = parsed.readable === true && !!passengerFullName && !!pnr;

  return {
    isTicket: true,
    readable,
    passengerFullName,
    pnr,
  };
}
