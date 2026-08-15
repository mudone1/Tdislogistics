import { MAIN_APP_URL } from "./config";

// CORRECTED (2026-08-15, live): sendPassportImage/sendDocumentImage used to
// call res.json() directly on a non-ok response — but a genuinely bare
// "HTTP 500" with no reason survived even after that JSON-error-body fix
// shipped, meaning the body wasn't valid JSON at all: an image upload's
// error can come from a platform-level failure (a request-payload-size
// rejection, a function timeout, or a crash before the route's own
// try/catch ever ran) that returns an HTML error page or empty body, not
// the route's own { error: <reason> } shape. Reads the body as TEXT first
// (never throws), then tries to parse it as that JSON shape; falls back to
// the raw text itself (truncated) when it isn't JSON, so the next failure
// always surfaces something real instead of silently producing nothing.
async function describeErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return "";
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (body && typeof body === "object" && "error" in body) {
      return ` — ${String(body.error)}`;
    }
  } catch {
    // Not JSON — fall through to the raw text below.
  }
  return ` — ${text.slice(0, 300)}`;
}

export interface QuoteResponse {
  reply: string;
  bookingJobId?: string;
  balanceUpdateTriggeredAt?: string;
}

// Same endpoint the browser ChatBubble posts to — a WhatsApp chat is just
// another "session", identified by sessionKey. All conversation memory
// (slots, prior messages) is already handled server-side there via
// ChatMemoryRepository, so this service holds no state of its own beyond
// the in-flight Book-on-Hold poll (see bookingPoll.ts).
export async function askAssistant(sessionKey: string, displayName: string | null, message: string): Promise<QuoteResponse> {
  const res = await fetch(`${MAIN_APP_URL}/api/assistant/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionKey, displayName, isAuthenticated: false }),
  });

  if (!res.ok) {
    throw new Error(`Assistant API returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as Partial<QuoteResponse>;
  return {
    reply: data.reply ?? "Sorry, I couldn't process that just now.",
    bookingJobId: data.bookingJobId,
    balanceUpdateTriggeredAt: data.balanceUpdateTriggeredAt,
  };
}

export interface PassportResponse {
  isIdDocument: boolean;
  readable?: boolean;
  reply?: string;
}

// Same endpoint the browser ChatBubble posts an attached image to — see
// PassportParser.ts. Accepts any official photo ID (passport, National ID,
// driver's license, voter's card, ...), not just passports. Node 24 (this
// service's runtime, per its Dockerfile) has native FormData/Blob, so no
// multipart library is needed.
export async function sendPassportImage(
  sessionKey: string,
  displayName: string | null,
  buffer: Buffer,
  mimeType: string
): Promise<PassportResponse> {
  const form = new FormData();
  form.set("sessionKey", sessionKey);
  if (displayName) form.set("displayName", displayName);
  form.set("isAuthenticated", "false");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BlobPart isn't a globally available
  // type name under this tsconfig's ES2022-only lib; `any` avoids depending on a DOM type existing.
  form.append("file", new Blob([buffer as any], { type: mimeType }), "id-document.jpg");

  const res = await fetch(`${MAIN_APP_URL}/api/assistant/passport`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Passport API returned HTTP ${res.status}${await describeErrorBody(res)}`);
  }
  return (await res.json()) as PassportResponse;
}

export interface DocumentResponse {
  kind: "ID" | "TICKET" | "NONE";
  readable?: boolean;
  reply?: string;
}

// Combined ID-card + airline-ticket endpoint — see DocumentParser.ts.
// checkTicket controls whether the server even attempts the (extra) ticket
// vision call, per the private/group gating rules in imageHandler.ts.
export async function sendDocumentImage(
  sessionKey: string,
  displayName: string | null,
  buffer: Buffer,
  mimeType: string,
  checkTicket: boolean
): Promise<DocumentResponse> {
  const form = new FormData();
  form.set("sessionKey", sessionKey);
  if (displayName) form.set("displayName", displayName);
  form.set("isAuthenticated", "false");
  form.set("checkTicket", checkTicket ? "true" : "false");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see sendPassportImage above
  form.append("file", new Blob([buffer as any], { type: mimeType }), "document.jpg");

  const res = await fetch(`${MAIN_APP_URL}/api/assistant/document`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Document API returned HTTP ${res.status}${await describeErrorBody(res)}`);
  }
  return (await res.json()) as DocumentResponse;
}

export interface AdditionalPassenger {
  type?: "ADULT" | "CHILD" | "INFANT";
  title: string;
  firstName: string;
  lastName: string;
}

export interface BookingJobStatus {
  jobId: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  airline: string;
  route: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate: string | null;
    departureTime: string | null;
    returnTime: string | null;
  };
  passenger: { title: string; firstName: string; lastName: string };
  additionalPassengers: AdditionalPassenger[] | null;
  // Worker-pool progress — see BookingStage in schema.prisma. stage is
  // QUEUED (with queuePosition/estimatedWaitSeconds set) while waiting on a
  // free Enugu account, then an automation milestone once picked up; all
  // null before either has happened, or once the job is terminal.
  stage: "QUEUED" | "SEARCHING" | "FLIGHT_FOUND" | "FILLING_PASSENGER_DETAILS" | "REVIEWING_ITINERARY" | "CREATING_HOLD" | null;
  queuePosition: number | null;
  estimatedWaitSeconds: number | null;
  result?: {
    pnr: string | null;
    holdExpiresAt: string | null;
    totalPayable: number | null;
    currency: string | null;
    hasScreenshot: boolean;
    screenshotUrl: string | null; // relative path, e.g. "/api/assistant/book-hold/{id}/screenshot" — resolve against MAIN_APP_URL
  };
  error?: {
    message: string;
    detail: string | null;
  };
  // Best-effort user cancel — pnr is set only in the rare edge case where
  // the automation had already placed a real hold on the airline's own
  // portal before the cancellation was noticed (see
  // BookingJobRepository.recordCancelledButCompleted).
  cancelled?: {
    pnr: string | null;
    needsManualReview: boolean;
    detail: string | null;
  };
}

export async function getBookingJobStatus(jobId: string): Promise<BookingJobStatus> {
  // Plain external HTTP call from a Node process, not a Next.js server
  // component — {cache: "no-store"} is a Next.js fetch extension with no
  // effect (and, depending on the Node/undici version's RequestInit
  // types, not even a valid property) here.
  const res = await fetch(`${MAIN_APP_URL}/api/assistant/book-hold/${jobId}`);
  if (!res.ok) {
    throw new Error(`Booking status API returned HTTP ${res.status}`);
  }
  return (await res.json()) as BookingJobStatus;
}

// The screenshot itself is served separately (kept out of the poll
// response so that stays small — same reasoning as ChatBubble's <img src>
// pointing at it directly rather than embedding the bytes).
export async function getBookingScreenshot(screenshotUrl: string): Promise<Buffer> {
  const res = await fetch(`${MAIN_APP_URL}${screenshotUrl}`);
  if (!res.ok) {
    throw new Error(`Screenshot fetch returned HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface BalanceUpdateStatus {
  ready: boolean;
  balances: { airline: string; displayName: string; balance: number }[];
}

export async function getBalanceUpdateStatus(triggeredAt: string): Promise<BalanceUpdateStatus> {
  const res = await fetch(`${MAIN_APP_URL}/api/assistant/balance-update/status?since=${encodeURIComponent(triggeredAt)}`);
  if (!res.ok) {
    throw new Error(`Balance update status API returned HTTP ${res.status}`);
  }
  return (await res.json()) as BalanceUpdateStatus;
}

// --- Airline deposit tracking (manual-testing phase — see depositTracking.ts) ---

export interface PaymentReceiptExtraction {
  isPaymentReceipt: boolean;
  readable: boolean;
  amount: number | null;
  paymentDate: string | null;
  paymentTime: string | null;
  referenceNumber: string | null;
  narration: string | null;
  bankChannel: string | null;
}

// Detection-only, no DB write — see /api/assistant/deposits/screenshot.
// Same FormData/Blob pattern as sendPassportImage above.
export async function checkPaymentScreenshot(buffer: Buffer, mimeType: string): Promise<PaymentReceiptExtraction> {
  const form = new FormData();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see sendPassportImage above
  form.append("file", new Blob([buffer as any], { type: mimeType }), "receipt.jpg");

  const res = await fetch(`${MAIN_APP_URL}/api/assistant/deposits/screenshot`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Deposit screenshot API returned HTTP ${res.status}`);
  }
  return (await res.json()) as PaymentReceiptExtraction;
}

export interface DepositAirlineMenuOption {
  num: number;
  airline: string;
  label: string;
}

export type TagDepositResponse =
  | { status: "ignored" }
  | { status: "unreadable"; message: string }
  | { status: "needs_airline"; menu: DepositAirlineMenuOption[] }
  | { status: "recorded"; airline: string; amount: number }
  | { status: "duplicate"; airline: string };

// Server holds no memory of pending payments — the whole extraction is
// sent back on every call (whatsapp-service is the one holding the
// pending-payment cache, keyed by WhatsApp message ID). See
// /api/assistant/deposits/tag.
export async function tagDeposit(
  chatId: string,
  screenshotMessageId: string | null,
  decision: "CREDITED" | "NOT_CREDITED",
  extraction: PaymentReceiptExtraction,
  airlineOverride?: string
): Promise<TagDepositResponse> {
  const res = await fetch(`${MAIN_APP_URL}/api/assistant/deposits/tag`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId, screenshotMessageId, decision, extraction, airlineOverride }),
  });
  if (!res.ok) {
    throw new Error(`Deposit tag API returned HTTP ${res.status}`);
  }
  return (await res.json()) as TagDepositResponse;
}

export interface DepositReportResponse {
  date: string;
  count: number;
  report: string;
}

export async function getDepositReport(chatId: string, date?: string): Promise<DepositReportResponse> {
  const params = new URLSearchParams({ chatId });
  if (date) params.set("date", date);
  const res = await fetch(`${MAIN_APP_URL}/api/assistant/deposits/report?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Deposit report API returned HTTP ${res.status}`);
  }
  return (await res.json()) as DepositReportResponse;
}
