import { searchVarsPlatformFlights } from "../vars-platform/VarsFlightSearch";
import type { FlightSearchQuery, FlightSearchResult } from "../../core/types";

const REQUIREMENTS_URL = "https://booking.xejet.com/VARS/public/CustomerPanels/requirementsBS.aspx";

export async function searchXeJetFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  return searchVarsPlatformFlights(query, {
    logTag: "xejet",
    requirementsUrl: REQUIREMENTS_URL,
    airlineLabel: "XeJet",
  });
}
