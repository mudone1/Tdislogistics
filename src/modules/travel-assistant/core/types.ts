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
  | "SALES_REPORT_QUERY"
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
  // Set only via passport-photo OCR upload (never LLM-extracted from free
  // text) — see PassportParser.ts / POST /api/assistant/passport. ISO
  // YYYY-MM-DD, matching every other date field in this interface; only
  // formatted DD/MM/YYYY at the point of display.
  passengerDateOfBirth: string | null;
  // Book-on-Hold flight disambiguation: set when a leg's search turned up
  // more than one flight and the assistant is waiting on the user to pick
  // one. Cleared once resolved into selectedDepartureTime/selectedReturnTime.
  pendingDepartureTimeOptions: string[] | null;
  pendingReturnTimeOptions: string[] | null;
  selectedDepartureTime: string | null;
  selectedReturnTime: string | null;
  // Set when the passenger's title couldn't be confidently resolved (no
  // title given and the first name's gender is ambiguous/unisex/uncommon,
  // or an unsupported honorific like "Chief"/"Honourable" was given and
  // folded into firstName) — the assistant is waiting on the user to
  // confirm title/gender before booking can proceed. firstName here is
  // already the resolved value (with any unsupported honorific merged in);
  // cleared once resolved into passengerTitle.
  pendingTitleConfirmation: { firstName: string; lastName: string } | null;
  // Passengers beyond the lead one, same PNR — same trip, same hold, sharing
  // the lead passenger's phone/email (only title/name differ per passenger).
  // Populated when the booking request names more than one passenger.
  // "type" defaults to ADULT when not explicitly a child/infant; CHILD and
  // INFANT passengers need dateOfBirth (the portal's own form requires it —
  // see VarsBookOnHold.ts) instead of sharing the lead's phone/email.
  additionalPassengers:
    | { type: "ADULT" | "CHILD" | "INFANT"; firstName: string; lastName: string; title: string | null; dateOfBirth: string | null }[]
    | null;
  // Same purpose as pendingTitleConfirmation above, but for an additional
  // passenger whose title/gender couldn't be confidently resolved — "index"
  // is the position into additionalPassengers being confirmed. Resolved one
  // at a time (first entry in this list first) so as not to pile up several
  // clarifying questions in a single turn.
  pendingAdditionalTitleConfirmations: { index: number; firstName: string; lastName: string }[] | null;
  // Same purpose again, but for a CHILD/INFANT additional passenger whose
  // date of birth wasn't given (or wasn't extractable) when they were
  // named — resolved one at a time, after any pending title confirmations.
  pendingAdditionalDateOfBirthConfirmations: { index: number; firstName: string; lastName: string }[] | null;
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
  // The passenger's full name AS GIVEN, title already excluded — splitting
  // this into firstName/lastName is deliberately NOT the LLM's job (see
  // splitPassengerName in ConversationOrchestrator.ts): a fixed word-count
  // rule needs to apply 100% reliably, which a written prompt instruction
  // can't guarantee as consistently as code can.
  passengerFullName: string | null;
  passengerPhone: string | null;
  passengerEmail: string | null;
  // Only meaningful when passengerTitle is null (no title/honorific was
  // given at all) — the LLM's best guess at the passenger's gender from
  // their first name, used to pick a title without asking. "unsure" (or
  // null) means the name is ambiguous/unisex/uncommon enough that the
  // assistant must ask rather than guess.
  passengerGenderGuess: "male" | "female" | "unsure" | null;
  // Any passengers named IN ADDITION to the lead one above, for a
  // multi-passenger Book-on-Hold on the same PNR (e.g. "book for John Doe
  // and Mary Smith ...", or "... plus my son Emeka, age 7"). fullName is
  // split the same deterministic way as the lead passenger's. type defaults
  // to ADULT when nothing marks the passenger as a child/infant. dateOfBirth
  // is "YYYY-MM-DD" — required for CHILD/INFANT (the app asks for it if
  // missing), meaningless for ADULT. Empty/null when only one passenger was
  // named.
  additionalPassengers:
    | {
        fullName: string;
        title: string | null;
        genderGuess: "male" | "female" | "unsure" | null;
        type: "ADULT" | "CHILD" | "INFANT" | null;
        dateOfBirth: string | null;
      }[]
    | null;
}

// Shared starting point for any deterministic turn-builder (the free-text
// parser in ConversationOrchestrator.ts, and the structured /book command
// parser) — every field defaults to null so a builder only has to set what
// it actually extracted.
export function emptyChatEntities(): ChatEntities {
  return {
    origin: null,
    destination: null,
    date: null,
    returnDate: null,
    adults: null,
    children: null,
    infants: null,
    airline: null,
    cabinClass: null,
    passengerTitle: null,
    passengerFullName: null,
    passengerPhone: null,
    passengerEmail: null,
    passengerGenderGuess: null,
    additionalPassengers: null,
  };
}

export interface AssistantTurn {
  intent: ChatIntent;
  entities: ChatEntities;
  missingRequiredSlots: string[];
  reply: string;
}
