// Adapts travelportSearch.ts (Travelport's own richer request/response
// shape — multi-passenger, cabin class, round-trip) down into the generic
// FlightSearchQuery -> FlightSearchResult shape that
// /internal/travel-assistant/search and every domestic connector
// (Enugu/United/XeJet/Rano) already speak. Kept deliberately simple here:
// 1 adult, Economy, one-way — matching what the generic search endpoint's
// query shape can even express. The full multi-passenger/mixed-cabin
// quote flow (see formatQuoteMessage.ts) is a separate, Travelport-specific
// endpoint to be wired in later; this just gets basic search working
// through the existing shared path first.

import type { FlightSearchQuery, FlightSearchResult, FlightOption } from "../../../src/modules/travel-assistant/core/types";
import { searchTravelportFlights } from "./travelportSearch";

export async function searchTravelportForAssistant(
  query: FlightSearchQuery
): Promise<FlightSearchResult> {
  const offers = await searchTravelportFlights({
    from: query.origin,
    to: query.destination,
    departureDate: query.date,
    adults: 1,
    cabinClass: "Economy",
  });

  const options: FlightOption[] = offers.map((offer) => {
    const firstSegment = offer.segments[0];
    const lastSegment = offer.segments[offer.segments.length - 1];
    const adultFare = offer.fareBreakdown.find((fb) => fb.passengerType === "ADT");

    return {
      airline: offer.carrier || "Travelport",
      flightNumber: firstSegment?.flightNumber ?? null,
      departureTime: firstSegment?.departureTime ?? "",
      arrivalTime: lastSegment?.arrivalTime ?? null,
      date: firstSegment?.departureDate ?? query.date,
      durationMinutes: null, // Travelport returns ISO 8601 duration (e.g. "PT3H4M") on
      // ProductAir.totalDuration in the fuller response — not parsed here since the
      // generic FlightOption shape only wants minutes; add a small ISO-8601 parser
      // if/when this field is needed downstream.
      fare: adultFare?.totalPerPax ?? null,
      currency: offer.currency, // "NGN" — already converted in travelportSearch.ts
      seatStatus: null, // Travelport doesn't return a simple seat-count in this response shape
      fareClasses: [], // Cabin-class-per-fare-class breakdown not modeled here; this
      // adapter surfaces one fare (Economy, 1 adult) per offer — see file header note.
      raw: JSON.stringify(offer),
    };
  });

  return {
    query,
    options,
    searchedAt: new Date().toISOString(),
  };
}
