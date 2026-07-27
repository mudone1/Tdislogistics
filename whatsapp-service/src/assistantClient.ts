import { MAIN_APP_URL } from "./config";

export interface QuoteResponse {
  reply: string;
  bookingJobId?: string;
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
  return { reply: data.reply ?? "Sorry, I couldn't process that just now.", bookingJobId: data.bookingJobId };
}

export interface BookingJobStatus {
  jobId: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
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
