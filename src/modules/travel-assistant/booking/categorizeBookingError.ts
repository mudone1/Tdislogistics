import type { BookingErrorCategory } from "@prisma/client";

// Maps a raw automation failure into one of the user-facing buckets stored on
// BookingJob.errorCategory. The chat renders a friendly line per category; the
// raw errorMessage is kept separately for staff to relay to Muhammed. Order
// matters — first match wins, so put the more specific patterns first.
const RULES: Array<{ category: BookingErrorCategory; test: RegExp }> = [
  // Login step: "Logged in as:" marker never appeared, or the Sine/password
  // postback timed out on AgentLoginBS.aspx.
  { category: "LOGIN_FAILED", test: /logged in as|AgentLoginBS|txtSineCode|txtPassword|#btnOk|no credentials configured/i },
  // Fare/seat: neither preferred classband was available (all sold out) on a leg.
  { category: "SEAT_UNAVAILABLE", test: /neither of|sold out|seats-none|select element is missing|available on leg/i },
  // Passenger form rejected the details we submitted.
  { category: "INVALID_PASSENGER", test: /passenger|email|mobile|firstname|lastname|title/i },
  // Portal itself unreachable / navigation failed — network, DNS, gateway,
  // Playwright navigation/timeout errors that aren't tied to a specific step.
  { category: "PORTAL_UNAVAILABLE", test: /net::ERR|ERR_|navigation|Timeout|timed out|ECONNREFUSED|ENOTFOUND|browser has been closed|target page/i },
];

export function categorizeBookingError(message: string): BookingErrorCategory {
  for (const rule of RULES) {
    if (rule.test.test(message)) return rule.category;
  }
  return "UNKNOWN";
}
