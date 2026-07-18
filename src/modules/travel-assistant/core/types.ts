export interface FlightSearchQuery {
  origin: string;
  destination: string;
  date: string;
}

export interface FlightOption {
  airline: string;
  flightNumber: string | null;
  departureTime: string;
  arrivalTime: string | null;
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
