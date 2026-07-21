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

export type ChatIntent =
  | "GREETING"
  | "SMALL_TALK"
  | "FLIGHT_SEARCH_ONE_WAY"
  | "FLIGHT_SEARCH_ROUND_TRIP"
  | "BOOK_ON_HOLD"
  | "BOOKING_ASSISTANCE"
  | "TICKET_AVAILABILITY"
  | "AIRLINE_INFO"
  | "GENERAL_QUESTION"
  | "UNKNOWN";

// Short-term memory the orchestrator fills in turn by turn. Anything the
// user has already told the assistant stays here so we only ask about
// what's still missing.
export interface ConversationSlots {
  origin: string | null;
  destination: string | null;
  date: string | null;
  returnDate: string | null;
  isRoundTrip: boolean;
  adults: number | null;
  children: number | null;
  infants: number | null;
  airline: string | null;
  cabinClass: string | null;
  // Passenger details, only gathered for a Book-on-Hold. Kept alongside the
  // route slots so the assistant asks only for what's still missing.
  passengerTitle: string | null; // Mr | Mrs | Ms | Dr | Miss | ...
  passengerFirstName: string | null;
  passengerLastName: string | null;
  passengerPhone: string | null;
  passengerEmail: string | null;
}

export interface ChatEntities {
  origin: string | null;
  destination: string | null;
  date: string | null;
  returnDate: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  airline: string | null;
  cabinClass: string | null;
  passengerTitle: string | null;
  passengerFirstName: string | null;
  passengerLastName: string | null;
  passengerPhone: string | null;
  passengerEmail: string | null;
}

export interface AssistantTurn {
  intent: ChatIntent;
  entities: ChatEntities;
  missingRequiredSlots: string[];
  reply: string;
}
