import type { FlightOption, FareClassOption, FlightSearchResult } from "../core/types";

const NAIRA = "₦";
const SEPARATOR = "-----------------------";

// Shared by both the LLM-backed orchestrator and the legacy deterministic
// fallback, so quote formatting stays identical regardless of which path
// answered the request. Deliberately compact/WhatsApp-friendly — most
// responses get copied straight into a WhatsApp chat, so this omits flight
// numbers, durations, and fare-class detail beyond a short cabin label.
export function formatLeg(result: FlightSearchResult): string {
  if (result.options.length === 0) {
    return `No flights found ${result.query.origin} → ${result.query.destination} on ${result.query.date}.`;
  }

  const byAirline = new Map<string, FlightOption[]>();
  for (const o of result.options) {
    if (!byAirline.has(o.airline)) byAirline.set(o.airline, []);
    byAirline.get(o.airline)!.push(o);
  }

  // Cheapest airline first — the group most likely to be the best deal
  // leads, rather than an arbitrary/API-response order.
  const groups = Array.from(byAirline.entries()).sort((a, b) => cheapestOf(a[1]) - cheapestOf(b[1]));

  return groups
    .map(([airline, opts]) => {
      const sorted = [...opts].sort((a, b) => a.departureTime.localeCompare(b.departureTime));
      const cheapest = cheapestOf(sorted);
      const header = cheapest === Infinity ? airline : `${airline}\nFrom ${formatNaira(cheapest)}`;

      const lines = sorted.flatMap((o) => formatCabinLines(o));

      return `${header}\n\n${lines.join("\n")}`;
    })
    .join(`\n\n${SEPARATOR}\n\n`);
}

export function formatRouteHeader(origin: string, destination: string, date: string): string {
  return `Flights ${origin} → ${destination} on ${date}`;
}

// One flight's worth of the same compact style, for the card view's
// per-card Copy button — a single flight quote rather than the whole
// result set.
export function formatSingleFlight(option: FlightOption, origin: string, destination: string, date: string): string {
  const time = formatTime12h(option.departureTime);
  const priceLine =
    option.fare != null
      ? `${time} @ ${formatNaira(option.fare)} - ${shortCabinClass(cheapestFareClassName(option))}`
      : `${time} @ ${option.seatStatus ?? "unavailable"}`;
  return `${option.airline}\n${priceLine}\n${origin} → ${destination}, ${date}`;
}

export function cheapestOf(options: FlightOption[]): number {
  const fares = options.filter((o) => o.fare != null).map((o) => o.fare as number);
  return fares.length > 0 ? Math.min(...fares) : Infinity;
}

export function cheapestFareClassName(option: FlightOption): string | null {
  const available = option.fareClasses.filter((c: FareClassOption) => !c.soldOut && c.fare != null);
  if (available.length === 0) return null;
  const cheapest = available.reduce((min, c) => ((c.fare as number) < (min.fare as number) ? c : min));
  return cheapest.name;
}

// Same selection as cheapestFareClassName, but returns the full fare-class
// record — baggage/refund policy live there, not on FlightOption itself.
export function cheapestFareClass(option: FlightOption): FareClassOption | null {
  const available = option.fareClasses.filter((c) => !c.soldOut && c.fare != null);
  if (available.length === 0) return null;
  return available.reduce((min, c) => ((c.fare as number) < (min.fare as number) ? c : min));
}

// One row per airline — its cheapest available flight on the leg. Shared by
// the in-chat comparison card and the shareable quote image so both show
// the same set of flights.
export function cheapestPerAirline(options: FlightOption[]): FlightOption[] {
  const byAirline = new Map<string, FlightOption[]>();
  for (const o of options) {
    if (!byAirline.has(o.airline)) byAirline.set(o.airline, []);
    byAirline.get(o.airline)!.push(o);
  }
  return Array.from(byAirline.values())
    .map((opts) => [...opts].sort((a, b) => (a.fare ?? Infinity) - (b.fare ?? Infinity))[0])
    .sort((a, b) => (a.fare ?? Infinity) - (b.fare ?? Infinity));
}

// Fare class names vary a lot in the raw data ("Economy Promo", "Economy
// Saver", "Premium Economy Flex", "Business Flex", "FIRST CLASS",
// "ValuePlus", "ValueBusiness", ...) — collapse to the three short labels
// the default view shows. Live-verified bug this fixes (2026-08-08,
// XeJet ABV-LOS): a genuine "FIRST CLASS" fare (₦260,501) silently fell
// through to "Economy" because the old check only looked for the literal
// substrings "business"/"premium" — first-class fares, and ValueJet's
// "ValuePlus" tier (a premium-cabin tier that doesn't contain the word
// "premium" at all), both slipped through unclassified. Normalizing
// whitespace out before matching so "Value Plus"/"ValuePlus" match the
// same way regardless of the source's exact spacing.
export function shortCabinClass(rawName: string | null): string {
  if (!rawName) return "Economy";
  const n = rawName.toLowerCase().replace(/\s+/g, "");
  // First class has no dedicated bucket in this 3-tier view — folding it
  // into "Business" is still far more honest than "Economy" and needs no
  // new UI category to support it.
  if (n.includes("business") || n.includes("first") || n.includes("executive")) return "Business";
  if (n.includes("premium") || n.includes("valueplus")) return "Premium Eco";
  return "Economy";
}

// Groups a flight's available fare classes by cabin bucket (Economy /
// Premium Eco / Business) and returns the cheapest fare within EACH
// present bucket — not just the single overall-cheapest fare. Fixes the
// reported bug where a flight offering both Economy and Business showed
// only the Economy line, silently hiding the Business option from the
// comparison. Bucket order in the output always leads with the cheapest
// bucket first (almost always Economy, but not assumed).
function cabinBucketsForFlight(option: FlightOption): { bucket: string; fareClass: FareClassOption }[] {
  const available = option.fareClasses.filter((c) => !c.soldOut && c.fare != null);
  const cheapestPerBucket = new Map<string, FareClassOption>();
  for (const fc of available) {
    const bucket = shortCabinClass(fc.name);
    const existing = cheapestPerBucket.get(bucket);
    if (!existing || (fc.fare as number) < (existing.fare as number)) {
      cheapestPerBucket.set(bucket, fc);
    }
  }
  return Array.from(cheapestPerBucket.entries())
    .map(([bucket, fareClass]) => ({ bucket, fareClass }))
    .sort((a, b) => (a.fareClass.fare as number) - (b.fareClass.fare as number));
}

// One line per distinct cabin bucket available on this flight departure —
// e.g. a flight with both Economy and Premium availability produces two
// lines at the same departure time, so neither gets hidden behind the
// other. Appends the exact remaining-seat count only when it's below 5
// AND the source actually reported a number (never invented/estimated).
function formatCabinLines(option: FlightOption): string[] {
  const time = formatTime12h(option.departureTime);
  const buckets = cabinBucketsForFlight(option);
  if (buckets.length === 0) {
    return [`${time} @ ${option.seatStatus ?? "unavailable"}`];
  }
  return buckets.map(({ bucket, fareClass }) => {
    const seatsSuffix =
      fareClass.seatsLeft != null && fareClass.seatsLeft < 5
        ? ` — ${fareClass.seatsLeft} seat${fareClass.seatsLeft === 1 ? "" : "s"} left`
        : "";
    return `${time} @ ${formatNaira(fareClass.fare as number)} - ${bucket}${seatsSuffix}`;
  });
}

export function formatTime12h(time24: string): string {
  const match = time24.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time24;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${period}`;
}

export function formatNaira(amount: number): string {
  return `${NAIRA}${amount.toLocaleString()}`;
}
