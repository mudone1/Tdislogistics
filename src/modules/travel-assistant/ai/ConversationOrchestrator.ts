import { groqJsonCompletion, type GroqMessage } from "./groqClient";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { ChatMemoryRepository } from "../storage/ChatMemoryRepository";
import { formatLeg, formatRouteHeader } from "../formatting/formatFlightResults";
import type {
  AssistantTurn,
  ConversationSlots,
  FlightSearchResult,
  FlightOption,
} from "../core/types";

const BASE_URL = process.env.CONNECTOR_SERVICE_URL;
const API_KEY = process.env.CONNECTOR_SERVICE_API_KEY;

export interface OrchestratorInput {
  sessionKey: string;
  displayName: string | null;
  isAuthenticated: boolean;
  message: string;
}

export interface OrchestratorOutput {
  reply: string;
  outbound?: FlightSearchResult;
  return?: FlightSearchResult;
  result?: FlightSearchResult;
}

const EMPTY_SLOTS: ConversationSlots = {
  origin: null,
  destination: null,
  date: null,
  returnDate: null,
  isRoundTrip: false,
  adults: null,
  children: null,
  infants: null,
  airline: null,
  cabinClass: null,
};

const REQUIRED_SEARCH_SLOTS = ["origin", "destination", "date"] as const;

const SEARCH_INTENTS = new Set(["FLIGHT_SEARCH_ONE_WAY", "FLIGHT_SEARCH_ROUND_TRIP", "TICKET_AVAILABILITY"]);

const ALL_AIRLINES = ["ENUGU", "UNITED", "XEJET", "RANO"] as const;

// Round-trip searches run every airline sequentially for BOTH legs (see
// the Railway memory note below) — with all 4 carriers that's 8 Playwright
// runs in one request, well past what fits in a 60s serverless timeout.
// So an unqualified round-trip search only auto-checks the two
// longest-proven carriers; XeJet and Rano Air are still fully searchable
// round-trip, just by naming them explicitly (which narrows to 1 airline,
// i.e. 2 sequential runs — the same safe shape as before).
const ROUND_TRIP_DEFAULT_AIRLINES = ["ENUGU", "UNITED"] as const;

const AIRLINE_NAME_MATCHERS: Record<string, string> = {
  united: "UNITED",
  enugu: "ENUGU",
  xejet: "XEJET",
  "xe jet": "XEJET",
  rano: "RANO",
};

// If the user named a specific airline, narrow to just that one instead of
// querying every implemented carrier. Unrecognized names fall back to
// searching the default set rather than silently dropping the request.
function airlinesToQuery(preference: string | null, isRoundTrip: boolean): readonly string[] {
  const defaults = isRoundTrip ? ROUND_TRIP_DEFAULT_AIRLINES : ALL_AIRLINES;
  if (!preference) return defaults;
  const p = preference.toLowerCase();
  for (const [name, key] of Object.entries(AIRLINE_NAME_MATCHERS)) {
    if (p.includes(name)) return [key];
  }
  return defaults;
}

export async function handleAssistantMessage(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const session = await ChatMemoryRepository.getOrCreateSession(
    input.sessionKey,
    input.displayName,
    input.isAuthenticated
  );

  const priorMessages = await ChatMemoryRepository.getRecentMessages(session.id, 10);
  const slots: ConversationSlots = { ...EMPTY_SLOTS, ...((session.slots as Partial<ConversationSlots>) ?? {}) };

  const turn = await runIntentDetection(input.message, slots, priorMessages);

  await ChatMemoryRepository.appendMessage(session.id, "USER", input.message, turn.intent, turn.entities);

  if (!SEARCH_INTENTS.has(turn.intent)) {
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", turn.reply);
    return { reply: turn.reply };
  }

  mergeEntitiesIntoSlots(slots, turn);
  if (turn.intent === "FLIGHT_SEARCH_ROUND_TRIP") slots.isRoundTrip = true;

  const required = [...REQUIRED_SEARCH_SLOTS, ...(slots.isRoundTrip ? (["returnDate"] as const) : [])];
  const missing = required.filter((key) => !slots[key as keyof ConversationSlots]);

  if (missing.length > 0) {
    await ChatMemoryRepository.updateSlots(session.id, slots);
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", turn.reply);
    return { reply: turn.reply };
  }

  if (!BASE_URL || !API_KEY) {
    const reply = "The search service isn't configured yet — ask an admin to check CONNECTOR_SERVICE_URL.";
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }

  const airlines = airlinesToQuery(slots.airline, slots.isRoundTrip);

  try {
    if (slots.isRoundTrip) {
      // Sequential, not Promise.all — two Chromium instances at once has
      // exceeded Railway's available memory in the past. With multiple
      // airlines this means up to 4 sequential searches (2 legs x 2
      // carriers), which can run close to the API route's timeout for
      // far-out dates that need date-strip paging.
      const outbound = await searchAllAirlines(airlines, slots.origin!, slots.destination!, slots.date!);
      const back = await searchAllAirlines(airlines, slots.destination!, slots.origin!, slots.returnDate!);

      if (outbound.error || back.error) {
        const reply = "I couldn't complete that search just now — mind trying again in a moment?";
        await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
        return { reply };
      }

      const reply =
        `${turn.reply}\n\n` +
        `Outbound — ${formatRouteHeader(slots.origin!, slots.destination!, slots.date!)}\n${formatLeg(outbound)}\n\n` +
        `Return — ${formatRouteHeader(slots.destination!, slots.origin!, slots.returnDate!)}\n${formatLeg(back)}`;

      resetRouteSlots(slots);
      await ChatMemoryRepository.updateSlots(session.id, slots);
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply, outbound, return: back };
    }

    const data = await searchAllAirlines(airlines, slots.origin!, slots.destination!, slots.date!);
    if (data.error) {
      const reply = "I couldn't complete that search just now — mind trying again in a moment?";
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply };
    }

    const reply = `${turn.reply}\n\n${formatRouteHeader(slots.origin!, slots.destination!, slots.date!)}\n${formatLeg(data)}`;
    resetRouteSlots(slots);
    await ChatMemoryRepository.updateSlots(session.id, slots);
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply, result: data };
  } catch (err) {
    console.error("[travel-assistant] orchestrator search failed:", err);
    const reply = "I couldn't complete that search just now — mind trying again in a moment?";
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }
}

async function runIntentDetection(
  message: string,
  slots: ConversationSlots,
  priorMessages: { role: string; text: string }[]
): Promise<AssistantTurn> {
  const history: GroqMessage[] = priorMessages.map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.text,
  }));

  const messages: GroqMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Today's date: ${new Date().toISOString().slice(0, 10)}. Remembered slots so far: ${JSON.stringify(
        slots
      )}.`,
    },
    ...history,
    { role: "user", content: message },
  ];

  const raw = await groqJsonCompletion(messages);
  const parsed = JSON.parse(raw) as Partial<AssistantTurn>;

  return {
    intent: parsed.intent ?? "UNKNOWN",
    entities: {
      origin: parsed.entities?.origin ?? null,
      destination: parsed.entities?.destination ?? null,
      date: parsed.entities?.date ?? null,
      returnDate: parsed.entities?.returnDate ?? null,
      adults: parsed.entities?.adults ?? null,
      children: parsed.entities?.children ?? null,
      infants: parsed.entities?.infants ?? null,
      airline: parsed.entities?.airline ?? null,
      cabinClass: parsed.entities?.cabinClass ?? null,
    },
    missingRequiredSlots: parsed.missingRequiredSlots ?? [],
    reply: parsed.reply ?? "Sorry, could you rephrase that?",
  };
}

function mergeEntitiesIntoSlots(slots: ConversationSlots, turn: AssistantTurn): void {
  const e = turn.entities;
  if (e.origin) slots.origin = e.origin.toUpperCase();
  if (e.destination) slots.destination = e.destination.toUpperCase();
  if (e.date) slots.date = e.date;
  if (e.returnDate) {
    slots.returnDate = e.returnDate;
    slots.isRoundTrip = true;
  }
  if (e.adults != null) slots.adults = e.adults;
  if (e.children != null) slots.children = e.children;
  if (e.infants != null) slots.infants = e.infants;
  if (e.airline) slots.airline = e.airline;
  if (e.cabinClass) slots.cabinClass = e.cabinClass;
}

function resetRouteSlots(slots: ConversationSlots): void {
  slots.origin = null;
  slots.destination = null;
  slots.date = null;
  slots.returnDate = null;
  slots.isRoundTrip = false;
}

// Queries each requested airline in turn (never concurrently — see the
// Railway memory note above) and merges their flight options into one
// result. Only fails if every airline errored; a single carrier's outage
// just means fewer options rather than no answer at all.
async function searchAllAirlines(
  airlines: readonly string[],
  origin: string,
  destination: string,
  date: string
): Promise<FlightSearchResult & { error?: string }> {
  const options: FlightOption[] = [];
  let successCount = 0;

  for (const airline of airlines) {
    const result = await callSearch(airline, origin, destination, date);
    if (result.error) {
      console.error(`[travel-assistant] ${airline} search failed:`, result.error);
      continue;
    }
    successCount++;
    options.push(...result.options);
  }

  if (successCount === 0) {
    return {
      query: { origin, destination, date },
      options: [],
      searchedAt: new Date().toISOString(),
      error: "all airline searches failed",
    };
  }

  return { query: { origin, destination, date }, options, searchedAt: new Date().toISOString() };
}

async function callSearch(
  airline: string,
  origin: string,
  destination: string,
  date: string
): Promise<FlightSearchResult & { error?: string }> {
  const res = await fetch(`${BASE_URL}/internal/travel-assistant/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": API_KEY! },
    body: JSON.stringify({ origin, destination, date, airline }),
    cache: "no-store",
  });
  const data = (await res.json()) as FlightSearchResult & { error?: string };
  if (!res.ok && !data.error) return { ...data, error: `HTTP ${res.status}` };
  return data;
}
