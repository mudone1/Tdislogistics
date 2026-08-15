// Aero Contractors and Arik Air both run their public flight search on the
// same crane.aero platform, and both were confirmed LIVE (2026-08-14) to
// hand an automated browser a Cloudflare "Just a moment..." bot-detection
// challenge the instant it reaches the results step — reproduced by
// actually clicking each site's own search widget (not a cold deep-link),
// so it isn't a referrer/session-header problem a smarter scraper could
// route around. No Playwright automation for either airline as a result.
//
// A real agent's own browser hits no such wall (the reference videos show
// a human completing the exact same flow cleanly) — Cloudflare's challenge
// specifically targets automation signals, not this URL shape itself. So
// instead of searching, the assistant hands back a pre-filled deep link
// straight to the results page, built from the exact query-string shape
// each site's own widget produces (captured live, same date), for the
// agent to open in their own browser for a one-click quote.

export type CraneQuoteAirline = "AERO" | "ARIK";

// "2026-08-20" -> "20.08.2026" — both sites' widgets emit dot-separated
// DD.MM.YYYY, confirmed live via the actual URL each produced.
function isoToDotDDMMYYYY(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d}.${m}.${y}`;
}

export function buildCraneQuoteLink(
  airline: CraneQuoteAirline,
  origin: string,
  destination: string,
  dateISO: string,
  isRoundTrip: boolean,
  returnDateISO: string | null
): string {
  const departureDate = isoToDotDDMMYYYY(dateISO);
  const tripType = isRoundTrip ? "ROUND_TRIP" : "ONE_WAY";
  const returnDate = isRoundTrip && returnDateISO ? isoToDotDDMMYYYY(returnDateISO) : "";

  if (airline === "AERO") {
    // Captured live from flyaero.com's own "Search Flights" submit —
    // https://book-flyaero.crane.aero/ibe/availability/?depPort=LOS&arrPort=ABV&departureDate=15.08.2026&returnDate=&adult=1&child=0&infant=0&tripType=ONE_WAY&currency=NGN&lang=en
    const params = new URLSearchParams({
      depPort: origin,
      arrPort: destination,
      departureDate,
      returnDate,
      adult: "1",
      child: "0",
      infant: "0",
      tripType,
      currency: "NGN",
      lang: "en",
    });
    return `https://book-flyaero.crane.aero/ibe/availability/?${params.toString()}`;
  }

  // ARIK — captured live from arikair.com's own "Search Flights" submit —
  // https://arikair.crane.aero/ibe/availability?tripType=ONE_WAY&depPort=LOS&arrPort=ABV&departureDate=20.08.2026&returnDate=15.08.2026&passengerQuantities[0][passengerType]=ADULT&...
  // Bracketed passengerQuantities keys are exactly what the site's own form
  // submits — URLSearchParams percent-encodes the brackets automatically,
  // matching the captured URL's own %5B%5D encoding.
  const params = new URLSearchParams({
    tripType,
    depPort: origin,
    arrPort: destination,
    departureDate,
    returnDate,
    "passengerQuantities[0][passengerType]": "ADULT",
    "passengerQuantities[0][passengerSubType]": "",
    "passengerQuantities[0][quantity]": "1",
    "passengerQuantities[1][passengerType]": "CHILD",
    "passengerQuantities[1][passengerSubType]": "",
    "passengerQuantities[1][quantity]": "0",
    "passengerQuantities[2][passengerType]": "INFANT",
    "passengerQuantities[2][passengerSubType]": "",
    "passengerQuantities[2][quantity]": "0",
    currency: "",
    cabinClass: "",
    lang: "EN",
    nationality: "",
    promoCode: "",
    accountCode: "",
    affiliateCode: "",
    clickId: "",
    withCalendar: "",
    isMobileCalendar: "",
    market: "",
    isFFPoint: "",
  });
  return `https://arikair.crane.aero/ibe/availability?${params.toString()}`;
}

// Matches "aero"/"arik" as a whole word, case-insensitive — word-boundary
// (not a bare substring test) so this can't false-positive inside an
// unrelated word. Checked against both the free-text message and whatever
// the LLM's entity extraction put in slots.airline (Aero/Arik were never
// added to AIRLINE_NAME_MATCHERS since they're not real searchable keys).
export function matchCraneQuoteAirline(text: string | null): CraneQuoteAirline | null {
  if (!text) return null;
  if (/\barik\b/i.test(text)) return "ARIK";
  if (/\baero\b/i.test(text)) return "AERO";
  return null;
}
