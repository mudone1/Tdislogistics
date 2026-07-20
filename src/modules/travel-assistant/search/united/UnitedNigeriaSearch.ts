import { searchVarsPlatformFlights } from "../vars-platform/VarsFlightSearch";
import type { FlightSearchQuery, FlightSearchResult } from "../../core/types";

const REQUIREMENTS_URL = "https://booking.flyunitednigeria.com/VARS/Public/CustomerPanels/requirementsBS.aspx";

export async function searchUnitedNigeriaFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  return searchVarsPlatformFlights(query, {
    logTag: "united-nigeria",
    requirementsUrl: REQUIREMENTS_URL,
    airlineLabel: "United Nigeria",
  });
}
