import { searchVarsPlatformFlights } from "../vars-platform/VarsFlightSearch";
import type { FlightSearchQuery, FlightSearchResult } from "../../core/types";

// Rano Air's VARS instance is hosted on Videcom's shared multi-tenant
// platform rather than the airline's own domain (confirmed by live
// investigation) — different host shape, same booking engine.
const REQUIREMENTS_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/requirementsBS.aspx";

export async function searchRanoAirFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  return searchVarsPlatformFlights(query, {
    logTag: "rano",
    requirementsUrl: REQUIREMENTS_URL,
    airlineLabel: "Rano Air",
  });
}
