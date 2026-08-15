import { parseFlightQuery } from "../parser/parseFlightQuery";
import { extractLeadingTitle, guessGenderFromFirstName } from "../nameFormat";
import { EMAIL_RE, normalizePhone } from "../contactFields";
import { resolveNamedAirline, BOOKABLE_AIRLINE_KEYS } from "../core/airlines";
import { emptyChatEntities, type AssistantTurn } from "../core/types";

// Deterministic, zero-LLM parser for the structured /book command — the
// explicit alternative to the free-text booking path in
// ConversationOrchestrator.ts for anyone who wants full control over every
// field in one message (in particular: passenger TYPE, which the free-text
// path has no way to express at all — it can only ever default every
// passenger to ADULT).
//
// Grammar — one field per line, labels case-insensitive:
//
//   /book
//   Airline: <name>
//   Route: <ORIGIN>-<DEST>        (or "Origin to Destination")
//   Date: <date>
//   Return: <date>                (omit for one-way)
//   A1: <Title?> <First> <Last>
//   A2: <Title?> <First> <Last>
//   C1: <Title?> <First> <Last>, DOB <date>
//   I1: <Title?> <First> <Last>, DOB <date>
//   Phone: <number>
//   Email: <address>
//
// A bare "A"/"C"/"I" (no number) is only accepted when there's exactly one
// passenger of that type — two or more of the same type must each carry a
// distinct number. The first adult (A, or A1 when numbered) is always the
// lead/contact passenger. Every required field is validated up front;
// nothing here silently guesses or defers to an LLM — a malformed command
// gets back one itemized reply listing everything wrong, never a partial
// guess.
export interface ParseBookCommandResult {
  ok: boolean;
  // Present when ok === false — an itemized list of everything wrong,
  // ready to send straight back to the user.
  reply?: string;
  // Present when ok === true — flows into handleBookOnHold exactly the
  // same way tryDeterministicIntentDetection's own BOOK_ON_HOLD turns do.
  turn?: AssistantTurn;
}

const BOOK_COMMAND_PATTERN = /^\/book\b/i;

export function isBookCommand(rawMessage: string): boolean {
  return BOOK_COMMAND_PATTERN.test(rawMessage.trim());
}

type PassengerTypeLetter = "A" | "C" | "I";

const TYPE_LETTER_TO_NAME: Record<PassengerTypeLetter, "ADULT" | "CHILD" | "INFANT"> = {
  A: "ADULT",
  C: "CHILD",
  I: "INFANT",
};

interface RawPassengerLine {
  typeLetter: PassengerTypeLetter;
  number: number | null;
  valueRaw: string;
}

// "Label: value" — label is letters/spaces only (so "A1"/"Route"/"Return
// Date" all match, but a stray line with a URL or a colon-containing
// sentence doesn't get mistaken for a field).
const FIELD_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9 ]*?)\s*:\s*(.*)$/;
const PASSENGER_LABEL_PATTERN = /^([ACI])(\d*)$/i;

const AIRLINE_LABELS = new Set(["airline"]);
const ROUTE_LABELS = new Set(["route", "itinerary", "from/to"]);
const DATE_LABELS = new Set(["date", "travel date", "departure", "departure date"]);
const RETURN_LABELS = new Set(["return", "return date"]);
const PHONE_LABELS = new Set(["phone", "phone number", "contact", "contact number"]);
const EMAIL_LABELS = new Set(["email", "email address"]);

interface BuiltPassenger {
  type: "ADULT" | "CHILD" | "INFANT";
  title: string | null;
  fullName: string;
  genderGuess: "male" | "female" | "unsure" | null;
  dateOfBirth: string | null;
}

export function parseBookCommand(rawMessage: string): ParseBookCommandResult {
  const withoutCommand = rawMessage.trim().replace(BOOK_COMMAND_PATTERN, "").trim();
  const lines = withoutCommand
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let airlineRaw: string | null = null;
  let routeRaw: string | null = null;
  let dateRaw: string | null = null;
  let returnRaw: string | null = null;
  let phoneRaw: string | null = null;
  let emailRaw: string | null = null;
  const passengerLines: RawPassengerLine[] = [];
  const unrecognizedLines: string[] = [];

  for (const line of lines) {
    const match = line.match(FIELD_LINE_PATTERN);
    if (!match) {
      unrecognizedLines.push(line);
      continue;
    }
    const label = match[1].trim();
    const value = match[2].trim();

    const passengerMatch = label.match(PASSENGER_LABEL_PATTERN);
    if (passengerMatch) {
      passengerLines.push({
        typeLetter: passengerMatch[1].toUpperCase() as PassengerTypeLetter,
        number: passengerMatch[2] ? parseInt(passengerMatch[2], 10) : null,
        valueRaw: value,
      });
      continue;
    }

    const normalizedLabel = label.toLowerCase();
    if (AIRLINE_LABELS.has(normalizedLabel)) airlineRaw = value;
    else if (ROUTE_LABELS.has(normalizedLabel)) routeRaw = value;
    else if (DATE_LABELS.has(normalizedLabel)) dateRaw = value;
    else if (RETURN_LABELS.has(normalizedLabel)) returnRaw = value;
    else if (PHONE_LABELS.has(normalizedLabel)) phoneRaw = value;
    else if (EMAIL_LABELS.has(normalizedLabel)) emailRaw = value;
    else unrecognizedLines.push(line);
  }

  const errors: string[] = [];

  // Airline
  const airlineKey = airlineRaw ? resolveNamedAirline(airlineRaw) : null;
  if (!airlineRaw) {
    errors.push('Airline is missing (e.g. "Airline: Enugu")');
  } else if (!airlineKey || !BOOKABLE_AIRLINE_KEYS.has(airlineKey)) {
    errors.push(`"${airlineRaw}" isn't an airline I can book — try Enugu, United, XeJet, Rano, or ValueJet`);
  }

  // Route
  let origin: string | null = null;
  let destination: string | null = null;
  if (!routeRaw) {
    errors.push('Route is missing (e.g. "Route: LOS-ABV" or "Route: Lagos to Abuja")');
  } else {
    const parsedRoute = parseFlightQuery(routeRaw);
    if (parsedRoute.confidence !== "high" || !parsedRoute.origin || !parsedRoute.destination) {
      errors.push(`I couldn't recognize a route in "Route: ${routeRaw}" — try "Route: LOS-ABV" or "Route: Lagos to Abuja"`);
    } else {
      origin = parsedRoute.origin;
      destination = parsedRoute.destination;
    }
  }

  // Date
  let date: string | null = null;
  if (!dateRaw) {
    errors.push('Date is missing (e.g. "Date: 20 Aug")');
  } else {
    date = parseFlightQuery(dateRaw).date;
    if (!date) errors.push(`"Date: ${dateRaw}" doesn't look like a date I recognize — try "Date: 20 Aug"`);
  }

  // Return (optional — omitting it means one-way)
  let returnDate: string | null = null;
  if (returnRaw) {
    returnDate = parseFlightQuery(returnRaw).date;
    if (!returnDate) errors.push(`"Return: ${returnRaw}" doesn't look like a date I recognize — try "Return: 25 Aug"`);
  }

  // Phone
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (!phoneRaw) errors.push('Phone is missing (e.g. "Phone: 08012345678")');
  else if (!phone) errors.push(`"Phone: ${phoneRaw}" doesn't look valid — try a full local number, e.g. "08012345678"`);

  // Email
  if (!emailRaw) errors.push('Email is missing (e.g. "Email: name@example.com")');
  else if (!EMAIL_RE.test(emailRaw)) errors.push(`"Email: ${emailRaw}" doesn't look like a valid email`);

  // Passengers — validate numbering per type before building anything
  if (passengerLines.length === 0) {
    errors.push('At least one adult passenger is required (e.g. "A: Mr John Doe" or "A1: Mr John Doe")');
  }

  const byType: Record<PassengerTypeLetter, RawPassengerLine[]> = { A: [], C: [], I: [] };
  for (const p of passengerLines) byType[p.typeLetter].push(p);

  for (const type of ["A", "C", "I"] as const) {
    const entries = byType[type];
    if (entries.length <= 1) continue;
    const unnumbered = entries.filter((e) => e.number === null);
    if (unnumbered.length > 0) {
      errors.push(
        `More than one ${type} passenger given — each needs its own number (${type}1, ${type}2, ...); found an unnumbered "${type}"`
      );
    }
    const numbers = entries.map((e) => e.number).filter((n): n is number => n !== null);
    const seen = new Set<number>();
    for (const n of numbers) {
      if (seen.has(n)) errors.push(`Duplicate passenger number "${type}${n}" — each ${type} passenger needs a distinct number`);
      seen.add(n);
    }
  }

  // Build the ordered passenger list — adults first (by number), then
  // children, then infants — extracting title/DOB per line. Errors here
  // are collected alongside the field-level ones above so a single reply
  // lists everything wrong at once.
  const built: BuiltPassenger[] = [];
  const sortByNumber = (entries: RawPassengerLine[]) => [...entries].sort((a, b) => (a.number ?? 1) - (b.number ?? 1));

  for (const type of ["A", "C", "I"] as const) {
    for (const entry of sortByNumber(byType[type])) {
      const label = `${type}${entry.number ?? ""}`;
      let nameValue = entry.valueRaw;
      let dobRaw: string | null = null;
      const dobMatch = nameValue.match(/,?\s*DOB\s+(.+)$/i);
      if (dobMatch && dobMatch.index !== undefined) {
        dobRaw = dobMatch[1].trim();
        nameValue = nameValue.slice(0, dobMatch.index).trim().replace(/,\s*$/, "");
      }

      if (!nameValue) {
        errors.push(`${label} is missing a name (e.g. "${label}: Mr John Doe")`);
        continue;
      }

      const passengerType = TYPE_LETTER_TO_NAME[type];
      let dateOfBirth: string | null = null;
      if (passengerType !== "ADULT") {
        if (!dobRaw) {
          errors.push(`${label} needs a date of birth — add ", DOB <date>" (e.g. "${label}: Miss Amaka Doe, DOB 12 Jan 2019")`);
        } else {
          dateOfBirth = parseFlightQuery(dobRaw).date;
          if (!dateOfBirth) errors.push(`${label}'s date of birth ("${dobRaw}") doesn't look like a date I recognize`);
        }
      }

      const extracted = extractLeadingTitle(nameValue);
      const fullName = extracted.rest.trim();
      if (!fullName) {
        errors.push(`${label} needs a name I can use (e.g. "${label}: Mr John Doe")`);
        continue;
      }
      const genderGuess = extracted.title ? null : guessGenderFromFirstName(fullName);
      built.push({ type: passengerType, title: extracted.title, fullName, genderGuess, dateOfBirth });
    }
  }

  if (built.length > 0 && built[0].type !== "ADULT") {
    errors.push("The first passenger (A, or A1 when numbered) must be an adult — a child or infant needs an adult on the booking");
  }

  // A line that isn't blank but also isn't a recognized "Label: value" or
  // passenger line is very likely a typo'd field label (e.g. "Rout:" instead
  // of "Route:") — surfacing it explains an otherwise-confusing "missing"
  // error on the field it was probably meant to fill, instead of the line
  // just silently vanishing.
  for (const line of unrecognizedLines) {
    errors.push(`I didn't recognize this line and ignored it: "${line}"`);
  }

  if (errors.length > 0) {
    return { ok: false, reply: `I couldn't process that /book command:\n${errors.map((e) => `- ${e}`).join("\n")}` };
  }

  const lead = built[0];
  const entities = emptyChatEntities();
  entities.origin = origin;
  entities.destination = destination;
  entities.date = date;
  if (returnDate) entities.returnDate = returnDate;
  entities.airline = airlineKey;
  entities.passengerTitle = lead.title;
  entities.passengerFullName = lead.fullName;
  entities.passengerGenderGuess = lead.genderGuess;
  entities.passengerPhone = phone;
  entities.passengerEmail = emailRaw ? emailRaw.trim() : null;
  if (built.length > 1) {
    entities.additionalPassengers = built.slice(1).map((p) => ({
      fullName: p.fullName,
      title: p.title,
      genderGuess: p.genderGuess,
      type: p.type,
      dateOfBirth: p.dateOfBirth,
    }));
  }

  return {
    ok: true,
    turn: {
      intent: "BOOK_ON_HOLD",
      entities,
      missingRequiredSlots: [],
      reply: "Got it — let me get that hold started.",
    },
  };
}
