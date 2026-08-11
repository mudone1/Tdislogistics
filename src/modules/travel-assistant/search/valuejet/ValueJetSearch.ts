import type { FareClassOption, FlightOption, FlightSearchQuery, FlightSearchResult } from "../../core/types";

// ValueJet runs its own KIU-based booking engine (flyvaluejet.com) — not
// the crane.aero platform AirPeace/Aero/Arik/Ibom share (blocked by
// Cloudflare bot-detection on the results step, live-verified 2026-08-07),
// and not a VARS instance like Enugu/United/Rano/XeJet. No browser
// automation needed at all: its flight-search and fare-catalog endpoints
// are plain public JSON APIs, live-verified (2026-08-07) to work with a
// stateless fetch — no cookies, no referrer, no prior page visit required.
// This makes ValueJet dramatically simpler and more robust than every
// other search module in this codebase: no Playwright, no popups, no
// widget quirks, no bot-detection risk.
const SEARCH_API = "https://api.flyvaluejet.com/ibe/flight/search";
const FARES_API = "https://api.flyvaluejet.com/ibe/fares";
const AIRLINE_LABEL = "ValueJet";
const FLIGHT_NUMBER_PREFIX = "VK";
const CURRENCY = "NGN";
const REQUEST_TIMEOUT_MS = 12000;

interface ValueJetFareTier {
  label: string; // "ValueLite" | "ValueSaver" | "ValueXtra" | "ValuePlus" | "ValuePremium" | "ValueBusiness"
  rbds: { code: string }[];
  rules: { label: string; amount: number }[];
  default_ancillaries: { label: string }[];
}

interface ValueJetCombination {
  code: string; // booking-class (RBD) code, e.g. "N", "M", "K" — maps to a fare tier via getFareTiers()
  count: number; // seats available at this price
  number: string; // flight number without the "VK" prefix, e.g. "201"
  departure: { date: string; time: string }; // time as "08:40:00"
  arrival: { time: string };
  duration: string; // "01:15:00"
  amount: { total: number };
}

interface ValueJetJourney {
  journey_key: string;
  combinations: ValueJetCombination[];
}

// Static reference data (tier names, baggage, refund rules) — cheap to
// cache for the process lifetime rather than re-fetching on every search.
let fareTierCache: Record<string, ValueJetFareTier> | null = null;

async function getFareTiers(): Promise<Record<string, ValueJetFareTier>> {
  if (fareTierCache) return fareTierCache;
  const res = await fetchWithTimeout(FARES_API);
  if (!res.ok) throw new Error(`ValueJet fares catalog request failed: ${res.status} ${res.statusText}`);
  fareTierCache = (await res.json()) as Record<string, ValueJetFareTier>;
  return fareTierCache;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchValueJetFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  const logTag = "valuejet";
  const searchedAt = new Date().toISOString();

  const [tiers, journeys] = await Promise.all([getFareTiers(), fetchJourneys(query, logTag)]);

  // Every RBD/fare-tier combination for the same physical flight arrives as
  // its own journey entry — group them back into one FlightOption per
  // flight number, with each tier's price folded into fareClasses.
  const byFlightNumber = new Map<string, ValueJetCombination[]>();
  for (const journey of journeys) {
    for (const combo of journey.combinations) {
      if (!byFlightNumber.has(combo.number)) byFlightNumber.set(combo.number, []);
      byFlightNumber.get(combo.number)!.push(combo);
    }
  }

  const options: FlightOption[] = Array.from(byFlightNumber.entries())
    .map(([number, combos]) => buildFlightOption(number, combos, tiers, query.date))
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  console.log(`[${logTag}] ${query.origin} -> ${query.destination} on ${query.date}: ${options.length} flight(s)`);

  return { query, options, searchedAt };
}

async function fetchJourneys(query: FlightSearchQuery, logTag: string): Promise<ValueJetJourney[]> {
  const url = `${SEARCH_API}?from=${encodeURIComponent(query.origin)}&to=${encodeURIComponent(query.destination)}&on=${encodeURIComponent(query.date)}&adult=1&child=0&infant=0`;
  console.log(`[${logTag}] GET ${url}`);
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    // CORRECTED (2026-08-11, live): a bare "400 Bad Request" gave zero
    // indication of WHY, unlike every other airline's own graceful
    // "doesn't fly from X" message for the same unsupported-origin
    // scenario (e.g. BNI-ABV) — confirmed live via a real 400 on that
    // exact route. Capture and surface the real response body so the
    // next failure (if this really is just an unsupported route, not a
    // bug) reads as informatively as the other four airlines' answers.
    const body = await res.text().catch(() => "");

    // CORRECTED (2026-08-11, live, QOW-ABV): this endpoint tries to price
    // an itinerary as part of "search", and returns this specific
    // "CreatedItineraryException" / "Can not create an itinerary" body
    // when it simply has nothing to offer for the route/date — not a
    // bug on our side. Phrase it like the other four airlines'
    // "doesn't fly this route" answers (same "doesn't fly" wording, so
    // it also qualifies for the grouped all-airlines-don't-fly-it reply)
    // instead of dumping ValueJet's raw internal exception JSON.
    if (/can ?not create an itinerary/i.test(body)) {
      throw new Error(`ValueJet doesn't fly ${query.origin} to ${query.destination} (no fares available for this route)`);
    }

    throw new Error(`ValueJet search request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  const body = (await res.json()) as { data?: { _?: ValueJetJourney[] } };
  return body.data?._ ?? [];
}

function buildFlightOption(
  flightNumber: string,
  combos: ValueJetCombination[],
  tiers: Record<string, ValueJetFareTier>,
  queryDate: string
): FlightOption {
  // Departure/arrival/duration are identical across every combo for the
  // same flight number — only price/RBD/seat-count differ per fare tier.
  const first = combos[0];

  const fareClasses: FareClassOption[] = Object.values(tiers).map((tier) => {
    // A tier can in principle have more than one RBD bucket open on the
    // same flight — take the cheapest if so.
    const matches = combos.filter((c) => tier.rbds.some((r) => r.code === c.code));
    if (matches.length === 0) {
      return {
        name: tier.label,
        fare: null,
        currency: CURRENCY,
        soldOut: true,
        seatsLeft: null,
        refundPolicy: describeRefundPolicy(tier.rules),
        baggage: describeBaggage(tier.default_ancillaries),
      };
    }
    const cheapest = matches.reduce((min, c) => (c.amount.total < min.amount.total ? c : min));
    return {
      name: tier.label,
      fare: cheapest.amount.total,
      currency: CURRENCY,
      // CORRECTED (2026-08-11, live): this was hardcoded to `false` for any
      // matching RBD/fare-tier combo, even when its seat count was 0 — KIU
      // still returns a priced combo for a fully sold-out class, it just
      // has `count: 0`. That produced "— 0 seats left" fare rows instead
      // of the class being excluded like every other airline's sold-out
      // classes are.
      soldOut: cheapest.count <= 0,
      seatsLeft: cheapest.count,
      refundPolicy: describeRefundPolicy(tier.rules),
      baggage: describeBaggage(tier.default_ancillaries),
    };
  });

  // Same availability bug applies to the overall "cheapest" figure used for
  // sorting/display elsewhere — prefer the cheapest combo that actually has
  // seats, only falling back to a sold-out one if literally nothing on this
  // flight is available (so `fare` is never left without a number).
  const available = combos.filter((c) => c.count > 0);
  const cheapestOverall = (available.length > 0 ? available : combos).reduce((min, c) =>
    c.amount.total < min.amount.total ? c : min
  );

  return {
    airline: AIRLINE_LABEL,
    flightNumber: `${FLIGHT_NUMBER_PREFIX}${flightNumber}`,
    departureTime: toHHMM(first.departure.time),
    arrivalTime: toHHMM(first.arrival.time),
    date: first.departure.date || queryDate,
    durationMinutes: durationToMinutes(first.duration),
    fare: cheapestOverall.amount.total,
    currency: CURRENCY,
    seatStatus: null,
    fareClasses,
    raw: `${FLIGHT_NUMBER_PREFIX}${flightNumber} ${toHHMM(first.departure.time)}-${toHHMM(first.arrival.time)}`,
  };
}

// "08:40:00" -> "08:40" — matches the "HH:MM" 24h format formatTime12h()
// expects everywhere else in the codebase.
function toHHMM(time: string): string {
  return time.slice(0, 5);
}

// "01:15:00" -> 75
function durationToMinutes(duration: string): number | null {
  const match = duration.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function describeRefundPolicy(rules: { label: string; amount: number }[]): string {
  const refundRule = rules.find((r) => /refund/i.test(r.label));
  if (!refundRule) return "See fare rules";
  if (/non-refundable/i.test(refundRule.label)) return "Non-refundable";
  if (refundRule.amount === 0) return "Free cancellation & refund";
  return `Refundable (₦${refundRule.amount.toLocaleString()} fee)`;
}

function describeBaggage(ancillaries: { label: string }[]): string {
  return ancillaries.map((a) => a.label).join(", ") || "See fare rules";
}
