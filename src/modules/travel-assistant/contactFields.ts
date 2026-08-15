// Shared email/phone extraction & validation — used by the free-text
// deterministic booking parser (ConversationOrchestrator), the structured
// /book command parser, and the browser/WhatsApp early-ack checks.
// Relocated here (2026-08-14, verbatim) so every caller shares one
// implementation instead of maintaining parallel copies that can drift out
// of sync with each other (confirmed live: a stale copy of the phone regex
// missed a fix and briefly caused a WhatsApp "Copy" ack to not fire for a
// message the server-side gate already treated as a booking).

// Non-anchored — finds an email ANYWHERE in raw free text, unlike the
// validate-an-already-extracted-value EMAIL_RE below.
export const EMAIL_SEARCH_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// Anchored — validates a value that's already been extracted/typed as
// "the email field" on its own (e.g. a /book command's `Email:` line).
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Finds a plausible Nigerian phone number anywhere in raw free text —
// a run of digits (allowing spaces/dashes and an optional leading +) that,
// stripped down, is 10-14 digits long (covers local 11-digit numbers like
// "08140962303" and +234-prefixed international form). Deliberately not
// reused for the flight-date portion of a message — a date like "30th jul"
// or "2026-07-30" never produces a long enough contiguous digit run to
// false-positive here.
//
// The middle character class deliberately excludes \s (only literal spaces
// and hyphens) — \s also matches a newline, which on a multi-line message
// where a time field ("21:15") sits on the line right above the phone
// number used to greedily match ACROSS the line break ("15\n08140962303"),
// silently corrupting the extracted phone number with the time's trailing
// digits while still passing normalizePhone's loose length check
// (confirmed live, 2026-08-11).
export function findPhoneInText(text: string): string | null {
  const candidates = text.match(/\+?[\d][\d -]{8,17}\d/g);
  if (!candidates) return null;
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 14) return candidate.trim();
  }
  return null;
}

// Local phone -> digits only; the automation strips the leading 0 and the
// +234 prefix is fixed on the form. Returns null if it isn't plausibly a phone.
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}
