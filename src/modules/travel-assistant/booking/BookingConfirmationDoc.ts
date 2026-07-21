import type { Browser } from "playwright";

// Shared, airline-agnostic confirmation-document generation for Book-on-Hold.
// Kept separate from any single airline's automation so United/XeJet/Rano can
// reuse it verbatim once they have booking automation. The PDF is rendered by
// Playwright's page.pdf() (HTML -> PDF via the Chromium the connector-service
// already runs) rather than pulling in a dedicated PDF dependency.

export interface BookingConfirmationData {
  pnr: string | null;
  passengerName: string;
  airlineDisplayName: string;
  origin: string;
  destination: string;
  departureDate: string; // "YYYY-MM-DD"
  returnDate?: string | null;
  holdExpiresAt?: string | null;
  totalPayable?: number | null;
  currency?: string | null;
  bookedAt: string; // ISO
}

const NAVY = "#184F73";
const GRAY = "#8A98A6";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

// Standalone HTML confirmation. `screenshotDataUri`, when present, is a
// data: URI (base64 PNG) of the airline's own confirmation page, embedded
// as supporting proof beneath the structured details.
export function renderConfirmationHtml(data: BookingConfirmationData, screenshotDataUri?: string): string {
  const rows: [string, string][] = [
    ["Passenger", data.passengerName],
    ["PNR", data.pnr ?? "—"],
    ["Airline", data.airlineDisplayName],
    ["Route", `${data.origin} → ${data.destination}`],
    ["Travel date", data.departureDate],
    ...(data.returnDate ? ([["Return date", data.returnDate]] as [string, string][]) : []),
    ...(data.holdExpiresAt ? ([["Hold expires", data.holdExpiresAt]] as [string, string][]) : []),
    ...(data.totalPayable != null
      ? ([["Total payable", formatMoney(data.totalPayable, data.currency ?? "NGN")]] as [string, string][])
      : []),
    ["Booked", formatDateTime(data.bookedAt)],
  ];

  const rowHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td class="v ${k === "PNR" ? "pnr" : ""}">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const screenshotBlock = screenshotDataUri
    ? `<div class="shot-label">Airline confirmation page</div><img class="shot" src="${screenshotDataUri}" alt="Airline confirmation screenshot" />`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #16232e; margin: 0; padding: 40px; }
  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid ${NAVY}; padding-bottom: 16px; margin-bottom: 8px; }
  .brand { font-size: 26px; font-weight: 800; color: ${NAVY}; }
  .doc-type { font-size: 13px; color: ${GRAY}; text-transform: uppercase; letter-spacing: 1px; }
  .status { display: inline-block; background: #e6f4ea; color: #1e7e45; font-weight: 700; font-size: 14px; padding: 6px 16px; border-radius: 999px; margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td { padding: 10px 4px; border-bottom: 1px solid #eef1f4; font-size: 15px; vertical-align: top; }
  td.k { color: ${GRAY}; width: 40%; }
  td.v { font-weight: 600; color: #16232e; }
  td.v.pnr { font-size: 22px; font-weight: 800; color: ${NAVY}; letter-spacing: 1px; }
  .shot-label { font-size: 12px; color: ${GRAY}; text-transform: uppercase; letter-spacing: 1px; margin: 22px 0 8px; }
  .shot { width: 100%; border: 1px solid #e9ecf1; border-radius: 8px; }
  .footer { margin-top: 24px; font-size: 12px; color: ${GRAY}; }
</style></head>
<body>
  <div class="header">
    <div class="brand">TDIS Logistics</div>
    <div class="doc-type">Booking Confirmation</div>
  </div>
  <div class="status">✓ Booking on Hold — Confirmed</div>
  <table>${rowHtml}</table>
  ${screenshotBlock}
  <div class="footer">This is a Book-on-Hold confirmation. Payment must be completed before the hold expires or the booking will be released automatically.</div>
</body></html>`;
}

// Renders the HTML above into a PDF using a fresh page in the already-running
// Chromium. Never throws into the booking flow — a PDF hiccup shouldn't lose
// an otherwise-successful booking, so callers treat a null return as "PDF
// unavailable" while still delivering the PNR + screenshot.
export async function generateConfirmationPdf(
  browser: Browser,
  data: BookingConfirmationData,
  screenshot?: Buffer
): Promise<Buffer | null> {
  const dataUri = screenshot ? `data:image/png;base64,${screenshot.toString("base64")}` : undefined;
  const html = renderConfirmationHtml(data, dataUri);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    return pdf;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

// Maps a raw automation error to a user-friendly category (item 8) so the
// chat never surfaces a stack trace. Order matters — most specific first.
export function categorizeBookingError(message: string): {
  category: "LOGIN_FAILED" | "SESSION_EXPIRED" | "PORTAL_UNAVAILABLE" | "SEAT_UNAVAILABLE" | "INVALID_PASSENGER" | "ROUTE_NOT_SERVED" | "UNKNOWN";
  friendly: string;
} {
  const m = message.toLowerCase();
  if (/login|sine code|password|authenticat/.test(m)) {
    return { category: "LOGIN_FAILED", friendly: "Couldn't sign in to the airline portal — the stored agent password may have been reset." };
  }
  if (/session|expired|timeout|timed out/.test(m)) {
    return { category: "SESSION_EXPIRED", friendly: "The airline session expired before the booking finished — please try again." };
  }
  if (/sold out|no seats|not available|unavailable fare|neither of/.test(m)) {
    return { category: "SEAT_UNAVAILABLE", friendly: "The seat/fare is no longer available on that flight — try a different date or flight." };
  }
  if (/doesn'?t fly|route|origin|destination.*not/.test(m)) {
    return { category: "ROUTE_NOT_SERVED", friendly: "That airline doesn't appear to fly this route on the selected date." };
  }
  if (/passenger|first ?name|last ?name|email|phone|invalid.*name/.test(m)) {
    return { category: "INVALID_PASSENGER", friendly: "Something about the passenger details was rejected — please double-check the name, phone, and email." };
  }
  if (/net::|econnrefused|enotfound|navigation|goto|502|503|504|gateway/.test(m)) {
    return { category: "PORTAL_UNAVAILABLE", friendly: "The airline website appears to be unavailable right now — please try again shortly." };
  }
  return { category: "UNKNOWN", friendly: "The booking couldn't be completed." };
}
