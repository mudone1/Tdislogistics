import type { FlightOption, FlightSearchResult } from "../core/types";

const NAIRA = "₦";

// Shared by both the LLM-backed orchestrator and the legacy deterministic
// fallback, so quote formatting stays identical regardless of which path
// answered the request.
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
      const header = cheapest === Infinity ? airline : `${airline} (from ${formatNaira(cheapest)})`;

      const lines = sorted.map((o) => {
        const timeRange = o.arrivalTime ? `${o.departureTime}–${o.arrivalTime}` : o.departureTime;
        const duration = o.durationMinutes != null ? formatDuration(o.durationMinutes) : null;
        const flightNo = o.flightNumber ? `flight ${o.flightNumber}` : null;
        const price = o.fare != null ? formatNaira(o.fare) : (o.seatStatus ?? "unavailable");
        const middle = [duration, flightNo].filter(Boolean).join(" · ");
        return `  ${timeRange}${middle ? ` · ${middle}` : ""} · ${price}`;
      });

      return `${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export function formatRouteHeader(origin: string, destination: string, date: string): string {
  return `Flights ${origin} → ${destination} on ${date}`;
}

function cheapestOf(options: FlightOption[]): number {
  const fares = options.filter((o) => o.fare != null).map((o) => o.fare as number);
  return fares.length > 0 ? Math.min(...fares) : Infinity;
}

function formatNaira(amount: number): string {
  return `${NAIRA}${amount.toLocaleString()}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
