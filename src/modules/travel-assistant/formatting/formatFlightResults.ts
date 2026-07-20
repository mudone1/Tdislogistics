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

      const lines = sorted.map((o) => {
        const time = formatTime12h(o.departureTime);
        if (o.fare == null) return `${time} @ ${o.seatStatus ?? "unavailable"}`;
        const cabin = shortCabinClass(cheapestFareClassName(o));
        return `${time} @ ${formatNaira(o.fare)} - ${cabin}`;
      });

      return `${header}\n\n${lines.join("\n")}`;
    })
    .join(`\n\n${SEPARATOR}\n\n`);
}

export function formatRouteHeader(origin: string, destination: string, date: string): string {
  return `Flights ${origin} → ${destination} on ${date}`;
}

function cheapestOf(options: FlightOption[]): number {
  const fares = options.filter((o) => o.fare != null).map((o) => o.fare as number);
  return fares.length > 0 ? Math.min(...fares) : Infinity;
}

function cheapestFareClassName(option: FlightOption): string | null {
  const available = option.fareClasses.filter((c: FareClassOption) => !c.soldOut && c.fare != null);
  if (available.length === 0) return null;
  const cheapest = available.reduce((min, c) => ((c.fare as number) < (min.fare as number) ? c : min));
  return cheapest.name;
}

// Fare class names vary a lot in the raw data ("Economy Promo", "Economy
// Saver", "Premium Economy Flex", "Business Flex", ...) — collapse to the
// three short labels the default view is allowed to show.
function shortCabinClass(rawName: string | null): string {
  if (!rawName) return "Economy";
  const n = rawName.toLowerCase();
  if (n.includes("business")) return "Business";
  if (n.includes("premium")) return "Premium Eco";
  return "Economy";
}

function formatTime12h(time24: string): string {
  const match = time24.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time24;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${period}`;
}

function formatNaira(amount: number): string {
  return `${NAIRA}${amount.toLocaleString()}`;
}
