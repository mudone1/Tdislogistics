// Formats one or more priced fare line items into the WhatsApp-style quote
// message used across the business (see project notes for the exact target
// format). Deliberately decoupled from travelportSearch.ts — a "quote" here
// is just a route + cabin + passenger-group + price, however it was
// sourced (one Travelport search, several combined, or even a manually
// entered fare), so this same formatter can be reused for domestic
// airlines (UNITED/ENUGU/XEJET/RANO/future Tiqwa content) later too.

export interface QuoteLeg {
  date: string; // display string, e.g. "23 Dec" or "10 Jan 2027"
  from: string; // display name, e.g. "Lagos"
  to: string; // display name, e.g. "Medina"
  via?: string; // optional layover, e.g. "Doha"
  arrivalDate?: string; // display string, e.g. "24 Dec" — omit if same-day
}

export interface QuotePassengerGroup {
  count: number;
  passengerType: "Adults" | "Children" | "Infants";
  cabinClass: "Economy" | "Premium Economy" | "Business" | "First Class";
  farePerPax: number; // in NGN, already converted/rounded
}

export interface FlightQuote {
  airlineName: string;
  legs: QuoteLeg[];
  passengerGroups: QuotePassengerGroup[];
}

function formatNaira(amount: number): string {
  return "₦" + Math.round(amount).toLocaleString("en-NG");
}

function formatLeg(leg: QuoteLeg): string {
  const route = leg.via ? `${leg.from} → ${leg.to} via ${leg.via}` : `${leg.from} → ${leg.to}`;
  const arrival = leg.arrivalDate ? `, arriving ${leg.arrivalDate}` : "";
  return `${leg.date}: ${route}${arrival}`;
}

export function formatQuoteMessage(quote: FlightQuote): string {
  const lines: string[] = [];

  lines.push(`*${quote.airlineName}*`);
  for (const leg of quote.legs) {
    lines.push(formatLeg(leg));
  }

  lines.push("Passengers:");
  let grandTotal = 0;
  quote.passengerGroups.forEach((group) => {
    const subtotal = group.count * group.farePerPax;
    grandTotal += subtotal;
    // For a single passenger, just show the one price — the "× N =" math
    // only earns its place once there's an actual multiplication to show.
    const priceText =
      group.count === 1
        ? formatNaira(group.farePerPax)
        : `${formatNaira(group.farePerPax)} × ${group.count} = ${formatNaira(subtotal)}`;
    // Singularize the label when there's exactly one passenger — "1 Infant",
    // not "1 Infants" — while multi-passenger groups keep the plural form.
    const label = group.count === 1 ? group.passengerType.replace(/s$/, "") : group.passengerType;
    lines.push(`${group.count} ${label} — ${group.cabinClass}: ${priceText}`);
  });

  lines.push(`*TOTAL: ${formatNaira(grandTotal)}*`);

  return lines.join("\n");
}

// Convenience: build a FlightQuote from one or more raw travelportSearch.ts
// offers that share the same itinerary but were priced separately per
// cabin/passenger-group (e.g. business for 2 adults + economy for 2 adults
// + economy for 1 infant, all on the same routing). Caller is responsible
// for grouping offers that belong to the same itinerary before calling this.
import type { TravelportFlightOffer, PassengerFareBreakdown } from "./travelportSearch";

const PAX_LABEL: Record<PassengerFareBreakdown["passengerType"], QuotePassengerGroup["passengerType"]> = {
  ADT: "Adults",
  CNN: "Children",
  INF: "Infants",
};

export function buildQuoteFromOffers(
  airlineName: string,
  legs: QuoteLeg[],
  offers: { offer: TravelportFlightOffer; cabinClass: QuotePassengerGroup["cabinClass"] }[]
): FlightQuote {
  const passengerGroups: QuotePassengerGroup[] = [];

  for (const { offer, cabinClass } of offers) {
    for (const fb of offer.fareBreakdown) {
      passengerGroups.push({
        count: fb.count,
        passengerType: PAX_LABEL[fb.passengerType],
        cabinClass,
        farePerPax: fb.totalPerPax,
      });
    }
  }

  return { airlineName, legs, passengerGroups };
}
