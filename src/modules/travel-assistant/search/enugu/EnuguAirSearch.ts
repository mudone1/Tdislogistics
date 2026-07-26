import { searchVarsPlatformFlights } from "../vars-platform/VarsFlightSearch";
import type { FlightSearchQuery, FlightSearchResult } from "../../core/types";

// Was previously a scraper against the public B2C consumer site
// (enuguairlines.com, iframe-based date picker) — a completely separate,
// far more brittle system from the B2B agent-portal engine that booking
// already uses (VarsBookOnHold.ts / VarsFlightSearch.ts). Live-verified
// (2026-07-26) as the root cause of a real "no flights found" false
// negative reported for a route/date that genuinely had flights: this
// consumer-site path silently returns an empty options array (logs a
// diagnostic, doesn't throw) on all sorts of page-state issues, and it's
// what powered both general chat flight-search AND the flight-time
// disambiguation check inside a Book-on-Hold — the same disambiguation
// check whose false negative was reported. Now a thin wrapper around the
// same VARS engine used for booking, matching United/Rano/XeJet's search
// wrappers exactly.
const REQUIREMENTS_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/requirementsBS.aspx";

export async function searchEnuguAirFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  return searchVarsPlatformFlights(query, {
    logTag: "enugu-air",
    requirementsUrl: REQUIREMENTS_URL,
    airlineLabel: "Enugu Air",
  });
}
