import { MAIN_APP_URL } from "./config";

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
    throw new Error(`Passport API returned HTTP ${res.status}`);
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
    throw new Error(`Document API returned HTTP ${res.status}`);
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
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
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
