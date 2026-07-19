export interface FlightSearchQuery {
  origin: string;
  destination: string;
  date: string;
}

export interface FareClassOption {
  name: string;
  fare: number | null;
  currency: string;
  soldOut: boolean;
  seatsLeft: number | null;
  refundPolicy: string | null;
  baggage: string | null;
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
  fareClasses: FareClassOption[];
  raw: string;
}

export interface FlightSearchResult {
  query: FlightSearchQuery;
  options: FlightOption[];
  searchedAt: string;
}
