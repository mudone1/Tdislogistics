import { groqJsonCompletion, type GroqMessage } from "./groqClient";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { STAFF_KNOWLEDGE } from "./staffProfiles";
import { ChatMemoryRepository } from "../storage/ChatMemoryRepository";
import { FlightSearchHistoryRepository } from "../storage/FlightSearchHistoryRepository";
import { NotificationRepository } from "../storage/NotificationRepository";
import { formatLeg, formatRouteHeader } from "../formatting/formatFlightResults";
import { startBookOnHold } from "../booking/startBookOnHold";
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
  // Set when a Book-on-Hold has just been started — the chat polls
  // GET /api/assistant/book-hold/[id] with this until the job is terminal.
  bookingJobId?: string;
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
  passengerTitle: null,
  passengerFirstName: null,
  passengerLastName: null,
  passengerPhone: null,
  passengerEmail: null,
};

const REQUIRED_SEARCH_SLOTS = ["origin", "destination", "date"] as const;

const SEARCH_INTENTS = new Set(["FLIGHT_SEARCH_ONE_WAY", "FLIGHT_SEARCH_ROUND_TRIP", "TICKET_AVAILABILITY"]);

const ALL_AIRLINES = ["ENUGU", "UNITED", "XEJET", "RANO"] as const;

const AIRLINE_NAME_MATCHERS: Record<string, string> = {
  united: "UNITED",
  enugu: "ENUGU",
  xejet: "XEJET",
  "xe jet": "XEJET",
  rano: "RANO",
};

// If the user named a specific airline, narrow to just that one instead of
// querying every implemented carrier. Unrecognized names fall back to
// searching every carrier rather than silently dropping the request.
// Round-trip and one-way both search the same full set now — searches run
// fully concurrently (see searchAllAirlines below), so even a round-trip's
// 8 simultaneous Playwright runs (4 airlines x 2 legs) complete in ~25-31s,
// well under the 60s timeout that made this a real concern before.
function airlinesToQuery(preference: string | null): readonly string[] {
  if (!preference) return ALL_AIRLINES;
  const p = preference.toLowerCase();
  for (const [name, key] of Object.entries(AIRLINE_NAME_MATCHERS)) {
    if (p.includes(name)) return [key];
  }
  return ALL_AIRLINES;
}

const REFERENCE_ID_PATTERN = /^TDIS-\d{8}-\d{3}$/i;

export async function handleAssistantMessage(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const session = await ChatMemoryRepository.getOrCreateSession(
    input.sessionKey,
    input.displayName,
    input.isAuthenticated
  );

  // A bare reference ID is a lookup, not a new search — short-circuit
  // before intent detection/LLM entirely.
  const trimmed = input.message.trim();
  if (REFERENCE_ID_PATTERN.test(trimmed)) {
    const record = await FlightSearchHistoryRepository.getByReferenceId(trimmed);
    await ChatMemoryRepository.appendMessage(session.id, "USER", input.message);
    if (!record) {
      const reply = `I couldn't find a search with reference ${trimmed.toUpperCase()} — double-check the ID?`;
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply };
    }
    const result = record.resultsJson as unknown as FlightSearchResult;
    const reply =
      `${record.referenceId} — ${formatRouteHeader(record.origin, record.destination, record.date)}\n${formatLeg(result)}`;
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply, result };
  }

  const priorMessages = await ChatMemoryRepository.getRecentMessages(session.id, 10);
  const slots: ConversationSlots = { ...EMPTY_SLOTS, ...((session.slots as Partial<ConversationSlots>) ?? {}) };

  const turn = await runIntentDetection(input.message, slots, priorMessages);

  await ChatMemoryRepository.appendMessage(session.id, "USER", input.message, turn.intent, turn.entities);

  if (turn.intent === "BOOK_ON_HOLD") {
    return handleBookOnHold(session.id, input.sessionKey, slots, turn, input.message);
  }

  if (!SEARCH_INTENTS.has(turn.intent)) {
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", turn.reply);
    return { reply: turn.reply };
  }

  mergeEntitiesIntoSlots(slots, turn, input.message);
  if (turn.intent === "FLIGHT_SEARCH_ROUND_TRIP") slots.isRoundTrip = true;

  const required = [...REQUIRED_SEARCH_SLOTS, ...(slots.isRoundTrip ? (["returnDate"] as const) : [])];
  const missing = required.filter((key) => !slots[key as keyof ConversationSlots]);

  if (missing.length > 0) {
    // Reproduced bug: the LLM sometimes claims a search "couldn't find
    // any flights" or "couldn't reach any airline" even though no search
    // ran at all (confirmed via response time — under 2s, impossible for
    // a real Playwright search) because required slots are still missing.
    // Don't blindly trust it here — if the reply reads like a failure
    // claim rather than a clarifying question, replace it with a
    // deterministic one built from the actual missing slots.
    const reply = looksLikeFalseFailureClaim(turn.reply) ? buildClarifyingQuestion(missing) : turn.reply;
    await ChatMemoryRepository.updateSlots(session.id, slots);
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }

  if (!BASE_URL || !API_KEY) {
    const reply = "The search service isn't configured yet — ask an admin to check CONNECTOR_SERVICE_URL.";
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }

  const airlines = airlinesToQuery(slots.airline);
  const searchStartedAt = Date.now();
  // Unscoped searches (no airline named, or an explicit "cheapest" ask)
  // query every carrier and take longest — the LLM's own lead-in tends to
  // be chattier than needed here, and per spec this exact request wants
  // nothing more than a plain "still working" line until results land.
  const leadIn = slots.airline ? turn.reply : "Let me check that for you.";

  try {
    if (slots.isRoundTrip) {
      // Both legs across every airline run fully concurrently — measured
      // against the real deployed connector-service: 8 simultaneous
      // Playwright searches (4 airlines x 2 legs) all succeeded in ~25-31s
      // total, vs. sequential summing to 150s+ and blowing the 60s
      // Vercel function timeout (the actual root cause of the "Something
      // went wrong" failures this replaces). The old "Railway can't
      // handle concurrent Chromium" assumption was tested and found false
      // with current resources.
      const [outbound, back] = await Promise.all([
        searchAllAirlines(airlines, slots.origin!, slots.destination!, slots.date!),
        searchAllAirlines(airlines, slots.destination!, slots.origin!, slots.returnDate!),
      ]);
      logSearchTiming("round-trip", airlines, searchStartedAt, [outbound, back]);

      if (outbound.failedAirlines.length + back.failedAirlines.length > 0) {
        console.warn(
          `[travel-assistant] partial airline failures — outbound: [${outbound.failedAirlines.map((f) => f.airline).join(", ")}], return: [${back.failedAirlines.map((f) => f.airline).join(", ")}]`
        );
      }

      if (outbound.options.length === 0 && back.options.length === 0) {
        const reply = describeAllFailed([...outbound.failedAirlines, ...back.failedAirlines]);
        await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
        return { reply };
      }

      const [outboundRecord, backRecord] = await Promise.all([
        outbound.options.length > 0 ? FlightSearchHistoryRepository.saveSearch(session.id, outbound, airlines) : null,
        back.options.length > 0 ? FlightSearchHistoryRepository.saveSearch(session.id, back, airlines) : null,
      ]);

      const reply =
        `${leadIn}\n\n` +
        `Outbound — ${formatRouteHeader(slots.origin!, slots.destination!, slots.date!)}\n${formatLeg(outbound)}` +
        (outboundRecord ? `\nRef: ${outboundRecord.referenceId}` : "") +
        `\n\n` +
        `Return — ${formatRouteHeader(slots.destination!, slots.origin!, slots.returnDate!)}\n${formatLeg(back)}` +
        (backRecord ? `\nRef: ${backRecord.referenceId}` : "");

      await NotificationRepository.create(
        session.id,
        "QUOTE_GENERATED",
        "Flight quote ready",
        `${slots.origin} ⇄ ${slots.destination} round-trip results are ready`,
        { referenceIds: [outboundRecord?.referenceId, backRecord?.referenceId].filter(Boolean) }
      );

      resetRouteSlots(slots);
      await ChatMemoryRepository.updateSlots(session.id, slots);
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply, outbound, return: back };
    }

    const data = await searchAllAirlines(airlines, slots.origin!, slots.destination!, slots.date!);
    logSearchTiming("one-way", airlines, searchStartedAt, [data]);

    if (data.failedAirlines.length > 0) {
      console.warn(`[travel-assistant] partial airline failures: [${data.failedAirlines.map((f) => f.airline).join(", ")}]`);
    }

    if (data.options.length === 0) {
      const reply = describeAllFailed(data.failedAirlines);
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply };
    }

    const record = await FlightSearchHistoryRepository.saveSearch(session.id, data, airlines);
    const reply = `${leadIn}\n\n${formatRouteHeader(slots.origin!, slots.destination!, slots.date!)}\n${formatLeg(data)}\nRef: ${record.referenceId}`;
    await NotificationRepository.create(
      session.id,
      "QUOTE_GENERATED",
      "Flight quote ready",
      `${slots.origin} → ${slots.destination} results are ready`,
      { referenceId: record.referenceId }
    );
    resetRouteSlots(slots);
    await ChatMemoryRepository.updateSlots(session.id, slots);
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply, result: data };
  } catch (err) {
    console.error("[travel-assistant] orchestrator search failed:", err);
    const reason = err instanceof Error ? err.message : String(err);
    // Users of this chat are TDIS staff, not the public — surfacing the
    // actual reason is deliberate, per explicit product direction, so it
    // can be relayed to Muhammed (the developer) to fix.
    const reply = `I couldn't complete that search just now — mind trying again in a moment? Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }
}

interface FailedAirline {
  airline: string;
  error: string;
}

function describeAllFailed(failedAirlines: FailedAirline[]): string {
  if (failedAirlines.length === 0) {
    return "I couldn't find any flights for that search — try a different date or route?";
  }

  // "doesn't fly from/to X" is a permanent routing fact, not a transient
  // reachability problem — telling the user to "try again in a moment"
  // for a route that will never exist is actively misleading. Distinguish
  // it from real connector/network failures.
  const routeIssues = failedAirlines.filter((f) => /doesn'?t fly/i.test(f.error));
  if (routeIssues.length === failedAirlines.length) {
    const names = failedAirlines.map((f) => f.airline).join(", ");
    return `${names} ${failedAirlines.length === 1 ? "doesn't" : "don't"} fly that route — want me to try a different airline or route?`;
  }

  const names = failedAirlines.map((f) => f.airline).join(", ");
  const reasons = failedAirlines.map((f) => `${f.airline}: ${f.error}`).join("; ");
  // Real connector/network failures, unlike a route an airline simply
  // doesn't fly — per explicit product direction, TDIS staff using this
  // chat should relay the actual reason to Muhammed (the developer) so
  // he can fix it, not have it hidden the way it would from a customer.
  return `I couldn't reach any airline for that search just now (tried ${names}) — mind trying again in a moment? Please tell Muhammed the reason for the error, and he'll fix it: "${reasons}"`;
}

const FAILURE_CLAIM_PATTERNS = [/couldn'?t find/i, /couldn'?t reach/i, /no flights/i, /search failed/i, /didn'?t find/i];

// Heuristic, not perfect — but a reply that reads like it's reporting a
// failed search while no search has even started is worse than a
// heuristic false positive occasionally swapping in a plain clarifying
// question instead.
function looksLikeFalseFailureClaim(reply: string): boolean {
  return FAILURE_CLAIM_PATTERNS.some((p) => p.test(reply));
}

const SLOT_LABELS: Record<string, string> = {
  origin: "departure city",
  destination: "destination",
  date: "travel date",
  returnDate: "return date",
};

function buildClarifyingQuestion(missing: readonly string[]): string {
  const labels = missing.map((m) => SLOT_LABELS[m] ?? m);
  const joined =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Sure — what ${labels.length === 1 ? "is" : "are"} the ${joined} you'd like me to check?`;
}

function logSearchTiming(
  kind: string,
  airlines: readonly string[],
  startedAt: number,
  results: Array<FlightSearchResult & { failedAirlines: FailedAirline[] }>
): void {
  const totalMs = Date.now() - startedAt;
  const totalOptions = results.reduce((sum, r) => sum + r.options.length, 0);
  const failed = [...new Set(results.flatMap((r) => r.failedAirlines.map((f) => f.airline)))];
  console.log(
    `[travel-assistant] TIMING kind=${kind} airlines=[${airlines.join(",")}] totalMs=${totalMs} options=${totalOptions} failed=[${failed.join(",")}]`
  );
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
    { role: "system", content: STAFF_KNOWLEDGE },
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
      passengerTitle: parsed.entities?.passengerTitle ?? null,
      passengerFirstName: parsed.entities?.passengerFirstName ?? null,
      passengerLastName: parsed.entities?.passengerLastName ?? null,
      passengerPhone: parsed.entities?.passengerPhone ?? null,
      passengerEmail: parsed.entities?.passengerEmail ?? null,
    },
    missingRequiredSlots: parsed.missingRequiredSlots ?? [],
    reply: parsed.reply ?? "Sorry, could you rephrase that?",
  };
}

function mergeEntitiesIntoSlots(slots: ConversationSlots, turn: AssistantTurn, rawMessage: string): void {
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
  // Reproduced bug (two rounds): the LLM would re-extract an airline
  // entity on a totally unrelated later turn just because that airline
  // was mentioned earlier in conversation HISTORY, not because the
  // current message names it — silently narrowing an unrelated search to
  // one carrier. Prompt-tuning alone isn't reliable enough here (the
  // model isn't perfectly deterministic), so this is checked directly
  // against the raw current message text instead of trusting the LLM's
  // entity extraction on faith.
  if (e.airline && messageActuallyNamesAirline(rawMessage, e.airline)) {
    slots.airline = e.airline;
  }
  if (e.cabinClass) slots.cabinClass = e.cabinClass;
  // Passenger details (only ever populated on a Book-on-Hold turn). Trimmed;
  // blanks are ignored so a later turn can fill a gap without clobbering.
  if (e.passengerTitle?.trim()) slots.passengerTitle = e.passengerTitle.trim();
  if (e.passengerFirstName?.trim()) slots.passengerFirstName = e.passengerFirstName.trim();
  if (e.passengerLastName?.trim()) slots.passengerLastName = e.passengerLastName.trim();
  if (e.passengerPhone?.trim()) slots.passengerPhone = e.passengerPhone.trim();
  if (e.passengerEmail?.trim()) slots.passengerEmail = e.passengerEmail.trim();
}

function messageActuallyNamesAirline(rawMessage: string, airline: string): boolean {
  const m = rawMessage.toLowerCase();
  // Direct substring match covers the common case (LLM echoes back
  // roughly what the user typed, e.g. "xejet" -> "xejet"). If that
  // doesn't match (LLM normalized/renamed it), fall back to checking
  // whether the message mentions ANY known airline alias at all — if it
  // mentions none, whatever the LLM put in entities.airline can only have
  // come from conversation history, not this message, so it's rejected.
  if (m.includes(airline.toLowerCase())) return true;
  return Object.keys(AIRLINE_NAME_MATCHERS).some((alias) => m.includes(alias));
}

function resetRouteSlots(slots: ConversationSlots): void {
  slots.origin = null;
  slots.destination = null;
  slots.date = null;
  slots.returnDate = null;
  slots.isRoundTrip = false;
  slots.airline = null;
}

// ─── Book-on-Hold ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Resolve a named carrier to its key, or null if the user didn't name a known
// airline. Reuses the same alias table the search path uses.
function resolveNamedAirline(pref: string | null): string | null {
  if (!pref) return null;
  const p = pref.toLowerCase();
  for (const [name, key] of Object.entries(AIRLINE_NAME_MATCHERS)) {
    if (p.includes(name)) return key;
  }
  return null;
}

// Local phone -> digits only; the automation strips the leading 0 and the
// +234 prefix is fixed on the form. Returns null if it isn't plausibly a phone.
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

interface BookingGap {
  label: string;
}

// What's still needed before a hold can be placed — missing route/date slots
// plus passenger details, and email/phone that were given but don't validate.
function collectBookingGaps(slots: ConversationSlots): BookingGap[] {
  const gaps: BookingGap[] = [];
  if (!slots.origin) gaps.push({ label: "departure city" });
  if (!slots.destination) gaps.push({ label: "destination" });
  if (!slots.date) gaps.push({ label: "travel date" });
  if (slots.isRoundTrip && !slots.returnDate) gaps.push({ label: "return date" });
  if (!slots.passengerFirstName) gaps.push({ label: "passenger's first name" });
  if (!slots.passengerLastName) gaps.push({ label: "passenger's last name" });
  if (!slots.passengerPhone) gaps.push({ label: "passenger's phone number" });
  else if (!normalizePhone(slots.passengerPhone)) gaps.push({ label: "a valid phone number (that one didn't look right)" });
  if (!slots.passengerEmail) gaps.push({ label: "passenger's email" });
  else if (!EMAIL_RE.test(slots.passengerEmail)) gaps.push({ label: "a valid email address (that one didn't look right)" });
  return gaps;
}

function buildBookingClarifyingQuestion(gaps: BookingGap[]): string {
  const labels = gaps.map((g) => g.label);
  const joined =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Happy to place that hold. Could you give me the ${joined}?`;
}

function resetBookingSlots(slots: ConversationSlots): void {
  resetRouteSlots(slots);
  slots.passengerTitle = null;
  slots.passengerFirstName = null;
  slots.passengerLastName = null;
  slots.passengerPhone = null;
  slots.passengerEmail = null;
}

// Drives the Book-on-Hold conversation: gather route + passenger details over
// as many turns as needed, then create the job and hand its id back for the
// chat to poll. Enugu Air only for now — a named other carrier is declined
// rather than silently swapped.
async function handleBookOnHold(
  sessionId: string,
  sessionKey: string,
  slots: ConversationSlots,
  turn: AssistantTurn,
  rawMessage: string
): Promise<OrchestratorOutput> {
  mergeEntitiesIntoSlots(slots, turn, rawMessage);

  const named = resolveNamedAirline(slots.airline);
  if (named && named !== "ENUGU") {
    const reply = `Right now I can only place a Book-on-Hold with Enugu Air — ${named} isn't wired up for holds yet. Want me to hold an Enugu Air flight instead?`;
    await ChatMemoryRepository.updateSlots(sessionId, slots);
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }

  const gaps = collectBookingGaps(slots);
  if (gaps.length > 0) {
    const reply = buildBookingClarifyingQuestion(gaps);
    await ChatMemoryRepository.updateSlots(sessionId, slots);
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }

  if (!BASE_URL || !API_KEY) {
    const reply = "The booking service isn't configured yet — ask an admin to check CONNECTOR_SERVICE_URL.";
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }

  const paxName = [slots.passengerTitle, slots.passengerFirstName, slots.passengerLastName]
    .filter(Boolean)
    .join(" ");
  const routeLine = `${slots.origin}→${slots.destination} on ${slots.date}${
    slots.isRoundTrip && slots.returnDate ? `, returning ${slots.returnDate}` : ""
  }`;

  const result = await startBookOnHold({
    airline: "ENUGU",
    sessionKey,
    origin: slots.origin!,
    destination: slots.destination!,
    departureDate: slots.date!,
    returnDate: slots.isRoundTrip ? slots.returnDate : null,
    title: slots.passengerTitle ?? "Mr",
    firstName: slots.passengerFirstName!,
    lastName: slots.passengerLastName!,
    phone: normalizePhone(slots.passengerPhone!)!, // validated non-null by collectBookingGaps
    email: slots.passengerEmail!,
    createdBy: sessionKey,
  });

  // Clear route + passenger slots so the next hold or search starts clean,
  // whether or not the trigger succeeded (a retry re-gathers details).
  resetBookingSlots(slots);
  await ChatMemoryRepository.updateSlots(sessionId, slots);

  if (result.status === "FAILED") {
    const reply = `I couldn't start the Enugu Air hold just now — mind trying again in a moment? Please tell Muhammed the reason, and he'll fix it: "${result.error ?? "unknown error"}"`;
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }

  const reply = `Got it — I'm placing an Enugu Air hold for ${paxName}, ${routeLine}. This takes a minute or two; I'll show the PNR right here as soon as it's done.`;
  await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
  return { reply, bookingJobId: result.jobId };
}

// Queries every requested airline CONCURRENTLY (Promise.allSettled — never
// rejects, so one slow/broken carrier can't take the others down with it)
// and merges their flight options into one result. Verified against the
// real deployed connector-service: 4-way and even 8-way concurrent
// Playwright searches both completed reliably in ~20-31s total, vs.
// sequential summing past the 60s Vercel function timeout — that timeout
// (not a code exception) was the actual cause of "Something went wrong"
// on unscoped searches like "Kano to Lagos tomorrow".
async function searchAllAirlines(
  airlines: readonly string[],
  origin: string,
  destination: string,
  date: string
): Promise<FlightSearchResult & { failedAirlines: FailedAirline[] }> {
  const settled = await Promise.allSettled(
    airlines.map((airline) => callSearch(airline, origin, destination, date))
  );

  const options: FlightOption[] = [];
  const failedAirlines: FailedAirline[] = [];

  settled.forEach((outcome, i) => {
    const airline = airlines[i];
    if (outcome.status === "rejected") {
      const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.error(`[travel-assistant] ${airline} search threw:`, outcome.reason);
      failedAirlines.push({ airline, error });
      return;
    }
    if (outcome.value.error) {
      console.error(`[travel-assistant] ${airline} search failed:`, outcome.value.error);
      failedAirlines.push({ airline, error: outcome.value.error });
      return;
    }
    options.push(...outcome.value.options);
  });

  return { query: { origin, destination, date }, options, searchedAt: new Date().toISOString(), failedAirlines };
}

async function callSearch(
  airline: string,
  origin: string,
  destination: string,
  date: string
): Promise<FlightSearchResult & { error?: string }> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/internal/travel-assistant/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-api-key": API_KEY! },
      body: JSON.stringify({ origin, destination, date, airline }),
      cache: "no-store",
    });

    let data: (FlightSearchResult & { error?: string; stage?: string }) | null = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON body — e.g. a platform-level error page (timeout,
      // gateway error) rather than a structured response from our own code.
      return {
        query: { origin, destination, date },
        options: [],
        searchedAt: new Date().toISOString(),
        error: `HTTP ${res.status}: non-JSON response (likely upstream timeout/gateway error)`,
      };
    }

    if (!res.ok && data && !data.error) return { ...data, error: `HTTP ${res.status}` };
    return data as FlightSearchResult & { error?: string };
  } catch (err) {
    // fetch() itself threw — network failure, DNS, connector-service down, etc.
    const durationMs = Date.now() - startedAt;
    console.error(`[travel-assistant] ${airline} fetch failed after ${durationMs}ms:`, err);
    return {
      query: { origin, destination, date },
      options: [],
      searchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
