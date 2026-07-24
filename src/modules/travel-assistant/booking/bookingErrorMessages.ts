import type { BookingErrorCategory } from "@prisma/client";

// User-facing line per failure bucket. Deliberately actionable and blame-free
// where the staff can retry, and honest where they can't. The raw errorMessage
// is kept on the job separately so staff can still relay it to Muhammed.
const MESSAGES: Record<BookingErrorCategory, string> = {
  LOGIN_FAILED: "I couldn't sign in to the Enugu Air agent portal to place the hold — the credentials may need refreshing.",
  SESSION_EXPIRED: "The Enugu Air session expired before the hold went through — please try again.",
  PORTAL_UNAVAILABLE: "The Enugu Air booking portal wasn't reachable just now — please try again in a moment.",
  SEAT_UNAVAILABLE: "There were no seats available in the fare classes I can hold for that flight — try a different date?",
  INVALID_PASSENGER: "The portal rejected the passenger details — double-check the name, email, and phone number.",
  ROUTE_NOT_SERVED: "Enugu Air doesn't appear to fly that route — want me to check a different one?",
  UNKNOWN: "The hold didn't go through this time — please try again.",
};

export function bookingErrorMessage(category: BookingErrorCategory | null | undefined): string {
  return MESSAGES[category ?? "UNKNOWN"] ?? MESSAGES.UNKNOWN;
}
