import { openaiJsonCompletion, type OpenAIMessage } from "./openaiClient";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { STAFF_KNOWLEDGE } from "./staffProfiles";
import { ChatMemoryRepository } from "../storage/ChatMemoryRepository";
import { FlightSearchHistoryRepository } from "../storage/FlightSearchHistoryRepository";
import { NotificationRepository } from "../storage/NotificationRepository";
import { formatLeg, formatRouteHeader } from "../formatting/formatFlightResults";
import { startBookOnHold } from "../booking/startBookOnHold";
import { ENUGU_SUPPORTED_TITLES } from "../booking/vars-platform/VarsBookOnHold";
import { handleQuery as handleSalesReportQuery } from "../orchestration/SalesReportAssistant";
import { AirlineAIService } from "../../airline-connectors/services/AirlineAIService";
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
  // Set when a "balance update" was just triggered — the caller polls
  // GET /api/assistant/balance-update/status?since=<this> until every
  // airline's balance has synced more recently than this instant, then
  // formats and sends the final figures itself (see whatsapp-service's
  // balanceUpdatePoll.ts for the reference implementation).
  balanceUpdateTriggeredAt?: string;
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
  pendingDepartureTimeOptions: null,
  pendingReturnTimeOptions: null,
  selectedDepartureTime: null,
  selectedReturnTime: null,
  pendingTitleConfirmation: null,
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

// A deterministic command phrase, not a natural-language question —
// matched directly rather than routed through the LLM classifier, so it
// behaves identically every single time regardless of classification
// variance. Fires a real sync across every airline connector (not just a
// read of whatever's currently stored) — see AirlineAIService.
const BALANCE_UPDATE_PATTERN = /\bbalance\s*update\b/i;

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

  if (BALANCE_UPDATE_PATTERN.test(trimmed)) {
    await ChatMemoryRepository.appendMessage(session.id, "USER", input.message);
    try {
      const { triggeredAt } = await AirlineAIService.triggerBalanceUpdate();
      const reply = "🔄 Syncing every airline now — I'll have fresh balances for you in a moment.";
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply, balanceUpdateTriggeredAt: triggeredAt };
    } catch (err) {
      console.error("[travel-assistant] balance update trigger failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      const reply = `I couldn't start that sync just now — mind trying again in a moment? Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
      await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
      return { reply };
    }
  }

  const priorMessages = await ChatMemoryRepository.getRecentMessages(session.id, 10);
  const slots: ConversationSlots = { ...EMPTY_SLOTS, ...((session.slots as Partial<ConversationSlots>) ?? {}) };

  const turn = await runIntentDetection(input.message, slots, priorMessages);

  await ChatMemoryRepository.appendMessage(session.id, "USER", input.message, turn.intent, turn.entities);

  if (turn.intent === "BOOK_ON_HOLD") {
    return handleBookOnHold(session.id, input.sessionKey, slots, turn, input.message);
  }

  if (turn.intent === "SALES_REPORT_QUERY") {
    let reply: string;
    try {
      reply = (await handleSalesReportQuery(input.message)).reply;
    } catch (err) {
      console.error("[travel-assistant] sales report query failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      // Same "surface the real reason" policy as the flight-search catch
      // below — these users are TDIS staff, not the public.
      reply = `I couldn't pull that up just now — mind trying again in a moment? Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
    }
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
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
  const history: OpenAIMessage[] = priorMessages.map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.text,
  }));

  const messages: OpenAIMessage[] = [
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

  const raw = await openaiJsonCompletion(messages);
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
      passengerGenderGuess: parsed.entities?.passengerGenderGuess ?? null,
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

  // Reproduced live: the LLM occasionally comes back with route/date
  // extracted but passenger email/phone left null even though the raw
  // message plainly contains both — same class of "don't trust the LLM's
  // extraction on faith" issue messageActuallyNamesAirline already exists
  // for. Unlike a name, an email or phone number has a simple, reliable
  // pattern that doesn't need an LLM at all — check the raw text directly
  // as a safety net whenever the LLM didn't already provide one, so a
  // clearly-present contact detail can never get silently dropped into a
  // "please give me your email/phone" re-ask the user just answered.
  if (!slots.passengerEmail) {
    const emailMatch = rawMessage.match(EMAIL_SEARCH_RE);
    if (emailMatch) slots.passengerEmail = emailMatch[0];
  }
  if (!slots.passengerPhone) {
    const phoneFound = findPhoneInText(rawMessage);
    if (phoneFound) slots.passengerPhone = phoneFound;
  }
}

// Non-anchored — finds an email ANYWHERE in raw free text, unlike the
// validate-an-already-extracted-value EMAIL_RE further down this file.
const EMAIL_SEARCH_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// Finds a plausible Nigerian phone number anywhere in raw free text —
// a run of digits (allowing spaces/dashes and an optional leading +) that,
// stripped down, is 10-14 digits long (covers local 11-digit numbers like
// "08140962303" and +234-prefixed international form). Deliberately not
// reused for the flight-date portion of a message — a date like "30th jul"
// or "2026-07-30" never produces a long enough contiguous digit run to
// false-positive here.
function findPhoneInText(text: string): string | null {
  const candidates = text.match(/\+?[\d][\d\s-]{8,17}\d/g);
  if (!candidates) return null;
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 14) return candidate.trim();
  }
  return null;
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
  slots.pendingDepartureTimeOptions = null;
  slots.pendingReturnTimeOptions = null;
  slots.selectedDepartureTime = null;
  slots.selectedReturnTime = null;
  slots.pendingTitleConfirmation = null;
}

// Resolves a raw passenger title/first-name pair into a title Enugu Air's
// booking form actually accepts, without ever discarding what the customer
// gave or silently guessing wrong on a passenger's travel document. Three
// cases:
// 1. A supported title (Mr/Mrs/Ms/Dr/Miss/Mstr/Prof/Rev) was given — done,
//    no-op (this also makes the function safe to call on every turn: once
//    resolved, it stays resolved).
// 2. No title, or an UNSUPPORTED honorific (Chief/Honourable/Barrister/
//    Pastor/etc.) was given — fold it into firstName to preserve the
//    customer's identity (e.g. "Honourable John Brian" -> firstName
//    "Honourable John", lastName "Brian"), then pick Mr/Miss from the
//    gender guess IF confident.
// 3. Not confident (name is unisex/uncommon/ambiguous, or no guess was
//    supplied) — never guess. Set pendingTitleConfirmation so
//    handleBookOnHold asks and waits, same pattern as flight-time
//    disambiguation.
function resolvePendingPassengerTitle(
  slots: ConversationSlots,
  genderGuess: "male" | "female" | "unsure" | null
): void {
  if (!slots.passengerFirstName || slots.pendingTitleConfirmation) return;

  const rawTitle = slots.passengerTitle;
  if (rawTitle && (ENUGU_SUPPORTED_TITLES as readonly string[]).some((t) => t.toLowerCase() === rawTitle.toLowerCase())) {
    return; // already a real, usable title
  }

  const effectiveFirstName = rawTitle ? `${rawTitle} ${slots.passengerFirstName}`.trim() : slots.passengerFirstName;

  if (genderGuess === "male") {
    slots.passengerTitle = "Mr";
    slots.passengerFirstName = effectiveFirstName;
  } else if (genderGuess === "female") {
    slots.passengerTitle = "Miss";
    slots.passengerFirstName = effectiveFirstName;
  } else {
    slots.passengerTitle = null;
    slots.pendingTitleConfirmation = { firstName: effectiveFirstName, lastName: slots.passengerLastName ?? "" };
  }
}

const TITLE_CONFIRMATION_WORDS: Record<string, (typeof ENUGU_SUPPORTED_TITLES)[number]> = {
  mr: "Mr",
  mrs: "Mrs",
  ms: "Ms",
  miss: "Miss",
  dr: "Dr",
  doctor: "Dr",
  prof: "Prof",
  professor: "Prof",
  rev: "Rev",
  reverend: "Rev",
  mstr: "Mstr",
  master: "Mstr",
  male: "Mr",
  man: "Mr",
  he: "Mr",
  him: "Mr",
  female: "Miss",
  woman: "Miss",
  she: "Miss",
  her: "Miss",
};

// Parses the customer's answer to "please confirm the passenger's preferred
// title or gender" into one of Enugu's supported titles. Returns null if the
// reply doesn't clearly say — the caller re-asks rather than guessing.
function matchTitleConfirmation(rawMessage: string): (typeof ENUGU_SUPPORTED_TITLES)[number] | null {
  const words = rawMessage.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (TITLE_CONFIRMATION_WORDS[word]) return TITLE_CONFIRMATION_WORDS[word];
  }
  return null;
}

// Matches a free-text reply against a list of candidate departure times
// (e.g. "08:45"). Tries, in order: an exact/substring time match after
// stripping non-digit noise (so "8:45am", "the 08:45 one" both match
// "08:45"), then an ordinal/position word ("first", "second", "1", "2").
// Returns null if nothing in the message plausibly picks one option.
function matchTimeSelection(message: string, options: string[]): string | null {
  const normalized = (s: string) => s.replace(/[^\d:]/g, "");
  const msgNormalized = normalized(message);
  const byTime = options.find((opt) => msgNormalized.includes(normalized(opt)));
  if (byTime) return byTime;

  const ordinalWords = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const lower = message.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    if (lower.includes(ordinalWords[i]) || lower.includes(`${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}`)) {
      return options[i];
    }
    // Bare digit only when unambiguous — a lone "1"/"2" etc. surrounded by
    // word boundaries, not part of a longer number (which would more likely
    // be a mistyped time).
    if (new RegExp(`(?<!\\d)${i + 1}(?!\\d)`).test(message) && options.length <= 9) {
      return options[i];
    }
  }
  return null;
}

interface ShownFlightReferenceOutcome {
  // The single flight the message unambiguously resolved to, or null if
  // either nothing matched or more than one candidate remains (see
  // ambiguousCandidates in that case).
  matched: FlightOption | null;
  // Non-null only when more than one option could plausibly be meant —
  // their departure times, to ask the user to pick one via the same
  // pendingDepartureTimeOptions mechanism used elsewhere. Never silently
  // pick between tied/ambiguous candidates.
  ambiguousCandidates: string[] | null;
}

// Resolves a follow-up like "book the 10:50 one", "book the cheapest",
// "book that flight" against the Enugu Air options from the user's most
// recent search this session. Tries, in order: explicit time or ordinal/
// position (reusing matchTimeSelection), then "cheapest"/"lowest fare",
// then — only when nothing more specific matched — falls back to "the
// only option" (safe, no ambiguity) or "ask which one" (more than one
// option and nothing narrowed it down; never guess).
function resolveShownFlightReference(rawMessage: string, options: FlightOption[]): ShownFlightReferenceOutcome {
  const times = options.map((o) => o.departureTime).filter((t): t is string => !!t);

  const byTimeOrOrdinal = matchTimeSelection(rawMessage, times);
  if (byTimeOrOrdinal) {
    const match = options.find((o) => o.departureTime === byTimeOrOrdinal);
    if (match) return { matched: match, ambiguousCandidates: null };
  }

  if (/\bcheap|lowest fare|lowest price/i.test(rawMessage)) {
    const priced = options.filter((o) => o.fare != null);
    if (priced.length > 0) {
      const minFare = Math.min(...priced.map((o) => o.fare!));
      const cheapest = priced.filter((o) => o.fare === minFare);
      if (cheapest.length === 1) return { matched: cheapest[0], ambiguousCandidates: null };
      return { matched: null, ambiguousCandidates: cheapest.map((o) => o.departureTime).filter(Boolean) };
    }
  }

  if (options.length === 1) {
    return { matched: options[0], ambiguousCandidates: null };
  }
  if (options.length > 1) {
    return { matched: null, ambiguousCandidates: times };
  }
  return { matched: null, ambiguousCandidates: null };
}

interface LegFlightChoiceOutcome {
  // Non-null when the caller should respond with this instead of
  // proceeding — either an error/no-flights message, or an ambiguity
  // question (pendingOptions will be set in that case).
  reply: string | null;
  pendingOptions: string[] | null;
  // The resolved departure time when exactly one flight was found. Also
  // legitimately null (with reply also null) when the disambiguation
  // search itself failed — see the comment at the call site for why that
  // proceeds rather than blocks.
  time: string | null;
}

// Turns a leg's flight-count into the right outcome: exactly one flight ->
// use it silently, zero -> tell the user, more than one -> ask which. A
// search failure returns "nothing to ask, nothing resolved" rather than
// blocking the booking on a check that itself errored.
function resolveLegFlightChoice(
  search: FlightSearchResult & { error?: string },
  leg: "outbound" | "return"
): LegFlightChoiceOutcome {
  if (search.error) {
    console.warn(`[travel-assistant] ${leg} disambiguation search failed, proceeding without a preferred time: ${search.error}`);
    return { reply: null, pendingOptions: null, time: null };
  }

  const times = search.options.map((o) => o.departureTime).filter((t): t is string => !!t);
  if (times.length === 0) {
    const legNote = leg === "return" ? " for the return leg" : "";
    return {
      reply: `I couldn't find any Enugu Air flights${legNote} for that route and date. Want to try a different date?`,
      pendingOptions: null,
      time: null,
    };
  }
  if (times.length === 1) {
    return { reply: null, pendingOptions: null, time: times[0] };
  }

  const legNote = leg === "return" ? "the return leg" : "your journey";
  return {
    reply: `I found multiple flights for ${legNote}.\nAvailable departure times are:\n${times.map((t) => `• ${t}`).join("\n")}\nWhich departure time would you prefer?`,
    pendingOptions: times,
    time: null,
  };
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

  // Passenger title/gender resolution — must happen (and block progress,
  // same as flight-time disambiguation below) BEFORE collectBookingGaps,
  // since that check doesn't look at title at all and would otherwise let
  // an unresolved/ambiguous title silently fall through to a hardcoded
  // "Mr" default at booking time.
  if (slots.pendingTitleConfirmation) {
    const resolved = matchTitleConfirmation(rawMessage);
    if (!resolved) {
      const reply = "Please confirm the passenger's preferred title or gender.";
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
    slots.passengerTitle = resolved;
    slots.passengerFirstName = slots.pendingTitleConfirmation.firstName;
    slots.pendingTitleConfirmation = null;
  } else {
    resolvePendingPassengerTitle(slots, turn.entities.passengerGenderGuess);
    if (slots.pendingTitleConfirmation) {
      const reply = "Please confirm the passenger's preferred title or gender.";
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
  }

  // If a previous turn asked which departure time the user wants, this
  // message is most likely answering that — try to resolve it before
  // falling through to the general gap-collection below (departure time
  // isn't one of collectBookingGaps' fields, so that check alone would
  // never notice we're still waiting on an answer here).
  if (slots.pendingDepartureTimeOptions && !slots.selectedDepartureTime) {
    const matched = matchTimeSelection(rawMessage, slots.pendingDepartureTimeOptions);
    if (!matched) {
      const reply = `I didn't catch which one — available departure times are:\n${slots.pendingDepartureTimeOptions.map((t) => `• ${t}`).join("\n")}\nWhich would you like?`;
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
    slots.selectedDepartureTime = matched;
    slots.pendingDepartureTimeOptions = null;
  }
  if (slots.isRoundTrip && slots.pendingReturnTimeOptions && !slots.selectedReturnTime) {
    const matched = matchTimeSelection(rawMessage, slots.pendingReturnTimeOptions);
    if (!matched) {
      const reply = `And for the return leg — available departure times are:\n${slots.pendingReturnTimeOptions.map((t) => `• ${t}`).join("\n")}\nWhich would you like?`;
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
    slots.selectedReturnTime = matched;
    slots.pendingReturnTimeOptions = null;
  }

  // No route/date at all — rather than immediately asking for them, check
  // whether this message is referencing a flight from the most recent
  // search shown this session ("book the 10:50 one", "book the cheapest",
  // "book that flight"). A plain search deliberately clears origin/
  // destination/date/airline (see resetRouteSlots) precisely so a later
  // unrelated message doesn't silently reuse a stale route — so this has
  // to pull the route from the SAVED SEARCH RECORD, not slots.
  if (!slots.origin && !slots.destination && !slots.date) {
    const recent = await FlightSearchHistoryRepository.getRecentForSession(sessionId, 1);
    const record = recent[0];
    // Only treat this as "referencing what I just showed you" if that
    // search genuinely happened moments ago — a long-lived session could
    // have a search from hours or days back as its "most recent" one, and
    // a vague new booking request ("I want to book a flight") shouldn't
    // get silently hijacked into disambiguating against a stale list the
    // user has long forgotten about.
    const isRecent = record ? Date.now() - record.createdAt.getTime() < 15 * 60 * 1000 : false;
    if (record && isRecent) {
      const results = record.resultsJson as unknown as FlightSearchResult;
      // Scoped to Enugu Air only, matching the current booking
      // restriction — a shown United/Rano/XeJet option can never actually
      // be held right now, so resolving a reference to one of those would
      // just be setting the user up for the "not wired up yet" message
      // moments later instead of now.
      const enuguOptions = results.options.filter((o) => o.airline === "Enugu Air");
      if (enuguOptions.length > 0) {
        const outcome = resolveShownFlightReference(rawMessage, enuguOptions);
        if (outcome.matched || outcome.ambiguousCandidates) {
          slots.airline = "ENUGU";
          slots.origin = record.origin;
          slots.destination = record.destination;
          slots.date = record.date;
          if (outcome.matched) {
            slots.selectedDepartureTime = outcome.matched.departureTime;
          } else {
            const reply = `I found more than one Enugu Air option from that search — which one?\n${outcome.ambiguousCandidates!.map((t) => `• ${t}`).join("\n")}`;
            slots.pendingDepartureTimeOptions = outcome.ambiguousCandidates!;
            await ChatMemoryRepository.updateSlots(sessionId, slots);
            await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
            return { reply };
          }
        }
        // No match at all falls through to the normal clarifying question
        // below — the reference didn't resolve to anything, so asking for
        // the route plainly is the right fallback, same as if there'd been
        // no prior search to check.
      }
    }
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

  // Every route/date/passenger slot is filled, but we don't yet know which
  // specific flight to book on each leg — check before triggering the
  // multi-minute automation, rather than letting it silently pick whatever
  // panel happens to be first. Uses the same public search connector-service
  // already exposes for regular flight-search chat queries (callSearch,
  // below) — no separate mechanism needed for this.
  if (!slots.selectedDepartureTime) {
    const outbound = await callSearch("ENUGU", slots.origin!, slots.destination!, slots.date!);
    const outcome = resolveLegFlightChoice(outbound, "outbound");
    if (outcome.reply) {
      if (outcome.pendingOptions) slots.pendingDepartureTimeOptions = outcome.pendingOptions;
      else resetBookingSlots(slots);
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", outcome.reply);
      return { reply: outcome.reply };
    }
    // outcome.time is null either when exactly one flight was found (use
    // it) or when the disambiguation search itself failed (proceed without
    // a preference rather than blocking the booking on a check that erred).
    if (outcome.time) slots.selectedDepartureTime = outcome.time;
  }
  if (slots.isRoundTrip && !slots.selectedReturnTime) {
    const inbound = await callSearch("ENUGU", slots.destination!, slots.origin!, slots.returnDate!);
    const outcome = resolveLegFlightChoice(inbound, "return");
    if (outcome.reply) {
      if (outcome.pendingOptions) slots.pendingReturnTimeOptions = outcome.pendingOptions;
      else resetBookingSlots(slots);
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", outcome.reply);
      return { reply: outcome.reply };
    }
    if (outcome.time) slots.selectedReturnTime = outcome.time;
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
    preferredDepartureTime: slots.selectedDepartureTime,
    preferredReturnTime: slots.selectedReturnTime,
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
