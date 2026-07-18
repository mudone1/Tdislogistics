// Types for the travel-assistant flight-search module. Kept deliberately
// separate from src/modules/airline-connectors/ (the wallet-balance-sync
// framework) - different purpose (no login, will be called from an MCP
// tool later), different lifecycle, no reason to couple them.

export interface FlightSearchQuery {
  origin: string;
  destination: string;
  date: string;
}

export interface FlightOption {
  airline: string;
  departureTime: string;
  date: string;
  durationMinutes: number | null;
  fare: number | null;
  currency: string;
  seatStatus: string | null;
  raw: string;
}

export interface FlightSearchResult {
  query: FlightSearchQuery;
  options: FlightOption[];
  searchedAt: string;
}
