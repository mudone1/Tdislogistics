import { searchVarsPlatformFlights } from "../vars-platform/VarsFlightSearch";
import type { FlightSearchQuery, FlightSearchResult } from "../../core/types";

const REQUIREMENTS_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/requirementsBS.aspx";

export async function searchEnuguAirFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  return searchVarsPlatformFlights(query, {
    logTag: "enugu",
    requirementsUrl: REQUIREMENTS_URL,
    airlineLabel: "Enugu Air",
  });
}
