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
import { triggerBalanceUpdate } from "../../../lib/balanceUpdateService";
import { toSurnameCase, toTitleCase } from "../nameFormat";
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

export const EMPTY_SLOTS: ConversationSlots = {
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
  passengerDateOfBirth: null,
  pendingDepartureTimeOptions: null,
  pendingReturnTimeOptions: null,
  selectedDepartureTime: null,
  selectedReturnTime: null,
  pendingTitleConfirmation: null,
  additionalPassengers: null,
  pendingAdditionalTitleConfirmations: null,
  pendingAdditionalDateOfBirthConfirmations: null,
};

// Same defaulting logic used by handleAssistantMessage below — exported so
// callers outside this module (e.g. the passport-OCR route) merge session
// slots the same way instead of a second copy that drifts.
export function loadSlots(session: { slots: unknown }): ConversationSlots {
  return { ...EMPTY_SLOTS, ...((session.slots as Partial<ConversationSlots>) ?? {}) };
}

const REQUIRED_SEARCH_SLOTS = ["origin", "destination", "date"] as const;

const SEARCH_INTENTS = new Set(["FLIGHT_SEARCH_ONE_WAY", "FLIGHT_SEARCH_ROUND_TRIP", "TICKET_AVAILABILITY"]);

const ALL_AIRLINES = ["ENUGU", "UNITED", "XEJET", "RANO", "VALUEJET"] as const;

const AIRLINE_NAME_MATCHERS: Record<string, string> = {
  united: "UNITED",
  enugu: "ENUGU",
  xejet: "XEJET",
  "xe jet": "XEJET",
  rano: "RANO",
  valuejet: "VALUEJET",
  "value jet": "VALUEJET",
  vk: "VALUEJET", // ValueJet's actual IATA code — flight numbers read "VK201" etc.
};

// Airlines the Book-on-Hold flow can actually place a hold with — kept in
// sync with BOOKABLE_AIRLINES in startBookOnHold.ts. UNITED/XEJET/RANO opened
// up for live testing at explicit product request — their booking-flow
// selectors (fare classband names, passenger form field ids, payment
// options) share Enugu's exact mechanism but aren't independently verified
// end-to-end yet, so expect the same iterate-from-real-errors cycle Enugu
// went through.
const BOOKABLE_AIRLINE_KEYS = new Set(["ENUGU", "VALUEJET", "UNITED", "XEJET", "RANO"]);

// Display names matching each search module's FlightOption.airline field
// (EnuguAirSearch/ValueJetSearch/UnitedNigeriaSearch/XeJetSearch/
// RanoAirSearch's own AIRLINE_LABEL constants) — used to match a "book that
// flight" reference against a shown search result.
const AIRLINE_KEY_TO_DISPLAY_NAME: Record<string, string> = {
  ENUGU: "Enugu Air",
  VALUEJET: "ValueJet",
  UNITED: "United Nigeria",
  XEJET: "XeJet",
  RANO: "Rano Air",
};

// These 5 are real airlines the assistant knows about (their balances sync,
// and 4 of them have sales-report data) but have NO flight-search automation
// built — a completely different platform (Crane) from the VARS-platform
// carriers above, and confirmed Cloudflare-blocked on the results step even
// via their own public sites (live-verified 2026-08-07, Arik). Live-confirmed
// bug this fixes: asking for one of these by name (e.g. "quote AirPeace
// ABV-LOS") silently searched all other carriers instead and said nothing
// about AirPeace — confusing, since the user gets a real-looking answer to a
// question they didn't ask. Checked against the raw message text (not
// slots.airline) so it fires regardless of whether the LLM happened to
// populate that entity for a name outside its known searchable set.
const UNSUPPORTED_SEARCH_AIRLINES: Record<string, string> = {
  airpeace: "Air Peace",
  "air peace": "Air Peace",
  aero: "Aero",
  arik: "Arik Air",
  "arik air": "Arik Air",
  ibom: "Ibom Air",
  "ibom air": "Ibom Air",
  ngeagle: "NG Eagle",
  "ng eagle": "NG Eagle",
};

function matchUnsupportedSearchAirline(rawMessage: string): string | null {
  const m = rawMessage.toLowerCase();
  for (const [alias, displayName] of Object.entries(UNSUPPORTED_SEARCH_AIRLINES)) {
    if (m.includes(alias)) return displayName;
  }
  return null;
}

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
// read of whatever's currently stored) — see lib/balanceUpdateService.
// Requires "update" alongside "bal"/"balance" — bare "balance" (e.g. "what's
// my balance") must NOT trigger a sync, per explicit product direction.
const BALANCE_UPDATE_PATTERN = /\bbal(?:ance)?\s*update\b/i;

// Deterministic "abandon this booking" command — matched directly (never
// through the LLM) so it behaves identically every time regardless of
// classification variance, same reasoning as BALANCE_UPDATE_PATTERN above.
// Clears every route/passenger slot so the next message starts a
// completely fresh booking, no leftover info carried over.
// "reset" alone must trigger this too, not just "reset booking" — confirmed
// live: a user typed bare "Reset" expecting it to clear stuck state, but it
// fell through to a generic conversational reply instead (the pattern
// required the "booking" suffix), leaving the actual stale slots untouched
// and the same error repeating on their very next message. "cancel" already
// had this same optional-suffix shape; "reset" now matches it.
const CLOSE_SESSION_PATTERN = /\b(?:close\s+session|cancel(?:\s+booking)?|start\s+over|reset(?:\s+booking)?)\b/i;

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
      const { triggeredAt } = await triggerBalanceUpdate();
      const reply = "Copy";
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

  const closeSessionMatch = CLOSE_SESSION_PATTERN.test(trimmed);
  if (closeSessionMatch) {
    await ChatMemoryRepository.appendMessage(session.id, "USER", input.message);
    const slots: ConversationSlots = loadSlots(session);
    resetBookingSlots(slots);
    await ChatMemoryRepository.updateSlots(session.id, slots);
    const reply = "Session closed — cleared, ready for a fresh booking whenever you are.";
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }

  const priorMessages = await ChatMemoryRepository.getRecentMessages(session.id, 10);
  const slots: ConversationSlots = loadSlots(session);

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
  // Same reproduced-bug guard as mergeEntitiesIntoSlots' own returnDate
  // handling — the LLM's INTENT classification itself (not just entities)
  // can misclassify a plain one-way request as FLIGHT_SEARCH_ROUND_TRIP,
  // which used to set isRoundTrip unconditionally here, completely
  // bypassing the date-count/return-wording check. Confirmed live: a
  // one-way booking with a single date still got asked for a return date.
  if (
    turn.intent === "FLIGHT_SEARCH_ROUND_TRIP" &&
    (ROUND_TRIP_KEYWORD_PATTERN.test(input.message) || countDateExpressions(input.message) >= 2)
  ) {
    slots.isRoundTrip = true;
  }

  // Check before asking for any missing route/date — no point collecting
  // details for a search that can never run. Doesn't touch/clear slots, so
  // a genuinely supported follow-up in the same conversation isn't affected.
  const unsupportedAirline = matchUnsupportedSearchAirline(input.message);
  if (unsupportedAirline) {
    const reply = `I don't have flight search for ${unsupportedAirline} yet — I can currently search Enugu Air, United Nigeria, XeJet, and Rano Air. Want me to check one of those instead?`;
    await ChatMemoryRepository.appendMessage(session.id, "ASSISTANT", reply);
    return { reply };
  }

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
      passengerFullName: parsed.entities?.passengerFullName ?? null,
      passengerPhone: parsed.entities?.passengerPhone ?? null,
      passengerEmail: parsed.entities?.passengerEmail ?? null,
      passengerGenderGuess: parsed.entities?.passengerGenderGuess ?? null,
      additionalPassengers: parsed.entities?.additionalPassengers ?? null,
    },
    missingRequiredSlots: parsed.missingRequiredSlots ?? [],
    reply: parsed.reply ?? "Sorry, could you rephrase that?",
  };
}

// Splits a raw full name into firstName/lastName: the LAST word is always
// the surname, and every word before it (however many — middle names
// included) joins the first name. Per explicit product direction (e.g.
// "aliyu ibrea mohammed" -> firstName "aliyu ibrea", lastName "mohammed") —
// this reverses an earlier floor(n/2)/ceil(n/2) split that combined middle
// names into the surname instead; that was the wrong direction for this
// airline's real passenger data. Never done by the LLM (see
// systemPrompt.ts) — this needs to apply identically every single time,
// which only code can guarantee.
// A word typed/spoken back in ALL CAPS (e.g. "ABDULWAHAB Muhammad") is
// treated as an explicit surname marker — mirrors how the airline's own ID
// documents print the surname, and lets a user flag the surname regardless
// of where it falls in the name. Only fires when exactly one such word
// exists; two or more is ambiguous, so it falls back to the default rule.
function findCapsSurnameHint(words: string[]): number | null {
  const capsIndexes = words
    .map((w, i) => (/^[A-Z]+$/.test(w) && w.length > 1 ? i : -1))
    .filter((i) => i !== -1);
  return capsIndexes.length === 1 ? capsIndexes[0] : null;
}

function splitPassengerName(fullName: string): { firstName: string; lastName: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: "", lastName: "" };
  if (words.length === 1) return { firstName: toTitleCase(words[0]), lastName: "" };

  const capsIndex = findCapsSurnameHint(words);
  const lastName = capsIndex != null ? words[capsIndex] : words[words.length - 1];
  const firstWords = capsIndex != null ? words.filter((_, i) => i !== capsIndex) : words.slice(0, -1);
  return {
    firstName: toTitleCase(firstWords.join(" ")),
    lastName: toSurnameCase(lastName),
  };
}

const TITLE_PREFIX_WORDS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "rev", "mstr",
  "chief", "honourable", "honorable", "barrister", "pastor", "apostle",
  "elder", "alhaji", "alhaja", "otunba", "engineer", "architect",
]);

// The LLM is asked to extract a title separately from the name (see
// systemPrompt.ts), but sometimes folds it into the name field instead —
// confirmed live: "Dr. Godfrey emomidue Ibrahim" came back with
// passengerTitle=null and "Dr." stuck inside passengerFullName, so the
// code's own gender-based title default (resolvePendingPassengerTitle)
// then added "Mr" on top of it, producing "Mr Dr. Godfrey emomidue
// Ibrahim". Deterministic safety net, same "don't trust the LLM's
// extraction on faith" reasoning already applied to email/phone below:
// only fires when the LLM didn't already give a separate title, so a
// genuinely single-word first name is never mistaken for one.
function extractLeadingTitle(fullName: string): { title: string | null; rest: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { title: null, rest: fullName };
  const bare = words[0].replace(/\.$/, "").toLowerCase();
  if (!TITLE_PREFIX_WORDS.has(bare)) return { title: null, rest: fullName };
  const supported = (ENUGU_SUPPORTED_TITLES as readonly string[]).find((t) => t.toLowerCase() === bare);
  const title = supported ?? bare.charAt(0).toUpperCase() + bare.slice(1);
  return { title, rest: words.slice(1).join(" ") };
}

function mergeEntitiesIntoSlots(slots: ConversationSlots, turn: AssistantTurn, rawMessage: string): void {
  const e = turn.entities;
  // Captured BEFORE the overwrites below, purely to detect "this message
  // describes a different flight than whatever was already in slots" —
  // see the cabinClass reset this drives further down.
  const priorOrigin = slots.origin;
  const priorDestination = slots.destination;
  const priorDate = slots.date;
  if (e.origin) slots.origin = e.origin.toUpperCase();
  if (e.destination) slots.destination = e.destination.toUpperCase();
  if (e.date) slots.date = e.date;
  // A message that restates origin/destination/date and any of them
  // actually DIFFER from what was already stored reads as a fresh, distinct
  // booking spec, not a single-field answer to a still-pending gap
  // question (those never restate the full route). Used below to decide
  // whether a leftover cabinClass from an abandoned earlier attempt should
  // still apply to THIS one.
  const describesADifferentFlight =
    Boolean(e.origin) &&
    Boolean(e.destination) &&
    Boolean(e.date) &&
    (e.origin!.toUpperCase() !== priorOrigin || e.destination!.toUpperCase() !== priorDestination || e.date !== priorDate);
  if (describesADifferentFlight) {
    // A leftover flight-time selection (or the options list it was chosen
    // from) is scoped to whichever route/date it was picked for — carrying
    // it into a different flight would silently skip asking which departure
    // time to use on THIS route, or worse, apply a choice that was never
    // actually offered for it.
    slots.selectedDepartureTime = null;
    slots.selectedReturnTime = null;
    slots.pendingDepartureTimeOptions = null;
    slots.pendingReturnTimeOptions = null;
  }
  // Trip-type is decided by what's actually IN this message, never by
  // field order or the LLM's own returnDate claim on faith — see
  // countDateExpressions/ROUND_TRIP_KEYWORD_PATTERN above. Rules (product
  // spec): 1 date ⇒ one-way, 2+ dates ⇒ round trip, explicit
  // return/round-trip wording ⇒ round trip even before a return date is
  // known.
  const messageHasReturnKeyword = ROUND_TRIP_KEYWORD_PATTERN.test(rawMessage);
  const roundTripSupported = messageHasReturnKeyword || countDateExpressions(rawMessage) >= 2;
  if (e.returnDate) {
    if (roundTripSupported) {
      slots.returnDate = e.returnDate;
      slots.isRoundTrip = true;
    } else if (!slots.date && !e.date) {
      // Rule 5 safety net: this message only ever gave ONE date and no
      // return wording, so the LLM's "returnDate" is really just the
      // outbound date that got misfiled (the exact field-order bug this
      // guard exists for) — use it as the date rather than discard real
      // information the user gave, and don't mark this a round trip.
      slots.date = e.returnDate;
    }
    // else: a lone stray returnDate with an outbound date already known
    // some other way — drop it rather than guess at a round trip.
  } else if (messageHasReturnKeyword) {
    // Round trip stated explicitly but no return date given yet (e.g.
    // "round trip LOS to ABV on 6 August") — mark it so the app asks for
    // the return date, without inventing one.
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
  } else {
    // Reproduced bug, opposite direction from the one above: the LLM's
    // BOOK_ON_HOLD-specific extraction checklist never explicitly called
    // out "airline" (only route/date/passenger fields were), so it
    // sometimes just skipped extracting it even when the message plainly
    // named one — confirmed live: "United Nigeria ABV-LOS tomorrow for
    // John Doe..." booked Enugu Air instead. Same "don't trust the LLM
    // alone for a field that decides WHICH AIRLINE gets booked" caution,
    // just checked directly against the raw text as a fallback rather
    // than only as a guard on the LLM's own claim.
    const namedInRawText = resolveNamedAirline(rawMessage);
    if (namedInRawText) slots.airline = namedInRawText;
  }
  // Normalized to a controlled value — never stores the LLM's raw free
  // text verbatim. "Premium Class"/"Premium"/"Business Class"/"Business"
  // all collapse to the same "PREMIUM" cabin-class preference (see
  // selectCheapestFare's category mode in VarsBookOnHold.ts, which
  // compares every Premium Economy/Premium Economy Flex/Business/Business
  // Flex fare and books the cheapest available one).
  if (e.cabinClass && /premium|business/i.test(e.cabinClass) && messageActuallyRequestsPremiumCabin(rawMessage)) {
    slots.cabinClass = "PREMIUM";
  } else if (describesADifferentFlight && !messageActuallyRequestsPremiumCabin(rawMessage)) {
    // Reproduced live: a booking that asked for Business class hit a
    // transient "trouble checking available times" error, which is
    // deliberately left retryable — every slot untouched — so a plain
    // "try again" doesn't force re-supplying the whole request (see the
    // retryable branch in handleAssistantMessage). Instead of retrying,
    // the user sent an entirely different booking (different airline/route)
    // that never mentioned cabin class at all, and the stale Business-class
    // preference silently carried into it, rejecting every Economy fare on
    // the new flight. cabinClass must default back to Economy whenever the
    // route it was set for is no longer the route being booked, same as
    // every other "don't trust carried-over state for a field that decides
    // WHICH FARE gets booked" guard in this function.
    slots.cabinClass = null;
  }
  // Passenger details (only ever populated on a Book-on-Hold turn). Trimmed;
  // blanks are ignored so a later turn can fill a gap without clobbering.
  if (e.passengerTitle?.trim()) slots.passengerTitle = e.passengerTitle.trim();
  if (e.passengerFullName?.trim()) {
    // ALWAYS attempt to strip a leading title word from the name, even when
    // the LLM ALSO gave a separate passengerTitle — confirmed live (e.g.
    // "Mr TestB emomidue Ibrahim") that the LLM can redundantly leave the
    // title as the first word of passengerFullName despite already
    // extracting it into passengerTitle too, otherwise polluting the
    // firstName with a leftover "Mr " prefix that the airline portal
    // rejects outright ("Please specify a valid firstname").
    const extracted = extractLeadingTitle(e.passengerFullName);
    const effectiveFullName = extracted.title ? extracted.rest : e.passengerFullName;
    if (!e.passengerTitle?.trim() && extracted.title) {
      slots.passengerTitle = extracted.title;
    }
    const words = effectiveFullName.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1 && slots.passengerFirstName && !slots.passengerLastName) {
      // A single word arriving once the first name is already known reads as
      // answering "what's the last name?" specifically — filling that one
      // gap, not re-deriving the whole name from a single word.
      slots.passengerLastName = words[0];
    } else {
      const { firstName, lastName } = splitPassengerName(effectiveFullName);
      slots.passengerFirstName = firstName;
      slots.passengerLastName = lastName;
    }
  }
  if (e.passengerPhone?.trim()) slots.passengerPhone = e.passengerPhone.trim();
  if (e.passengerEmail?.trim()) slots.passengerEmail = e.passengerEmail.trim();
  // Additional passengers (multi-passenger PNR) — only ever populated once,
  // from the same message that named the lead passenger; not merged
  // incrementally field-by-field like the lead passenger's own slots above.
  // Title is resolved right here (same logic as the lead passenger's
  // resolvePendingPassengerTitle below): a supported title is kept as-is; no
  // title/an unsupported one is folded into the first name and defaulted
  // from a confident gender guess; anything still ambiguous is queued into
  // pendingAdditionalTitleConfirmations for handleBookOnHold to ask about,
  // one at a time, rather than ever guessing.
  if (!slots.additionalPassengers && e.additionalPassengers?.length) {
    const resolved: { type: "ADULT" | "CHILD" | "INFANT"; firstName: string; lastName: string; title: string | null; dateOfBirth: string | null }[] = [];
    const titlePending: { index: number; firstName: string; lastName: string }[] = [];
    const dobPending: { index: number; firstName: string; lastName: string }[] = [];
    e.additionalPassengers
      .filter((p) => p.fullName?.trim())
      .forEach((p, index) => {
        const type = p.type ?? "ADULT";
        const dateOfBirth = p.dateOfBirth?.trim() || null;
        let rawTitle = p.title?.trim() || null;
        // ALWAYS strip a leading title word from the name, same reasoning
        // as the lead passenger above — the LLM can redundantly leave it
        // there even when it also gave a separate title.
        const extracted = extractLeadingTitle(p.fullName);
        const effectiveFullName = extracted.title ? extracted.rest : p.fullName;
        if (!rawTitle && extracted.title) rawTitle = extracted.title;
        const { firstName, lastName } = splitPassengerName(effectiveFullName);

        const queueDobIfNeeded = (name: { firstName: string; lastName: string }) => {
          if (type !== "ADULT" && !dateOfBirth) dobPending.push({ index, ...name });
        };

        // Mstr/Mr/Miss/Ms (the child/infant-eligible titles) are already a
        // subset of ENUGU_SUPPORTED_TITLES, so this same check validates a
        // given title correctly for every passenger type — only the
        // gender-based DEFAULT below needs to differ for a child (Mstr, not
        // Mr, per the portal's own title dropdown for that passenger type).
        if (rawTitle && (ENUGU_SUPPORTED_TITLES as readonly string[]).some((t) => t.toLowerCase() === rawTitle.toLowerCase())) {
          resolved.push({ type, firstName, lastName, title: rawTitle, dateOfBirth });
          queueDobIfNeeded({ firstName, lastName });
          return;
        }
        const effectiveFirstName = rawTitle ? `${rawTitle} ${firstName}`.trim() : firstName;
        const maleTitle = type === "CHILD" ? "Mstr" : "Mr";
        if (p.genderGuess === "male") {
          resolved.push({ type, firstName: effectiveFirstName, lastName, title: maleTitle, dateOfBirth });
          queueDobIfNeeded({ firstName: effectiveFirstName, lastName });
        } else if (p.genderGuess === "female") {
          resolved.push({ type, firstName: effectiveFirstName, lastName, title: "Miss", dateOfBirth });
          queueDobIfNeeded({ firstName: effectiveFirstName, lastName });
        } else {
          resolved.push({ type, firstName: effectiveFirstName, lastName, title: null, dateOfBirth });
          titlePending.push({ index, firstName: effectiveFirstName, lastName });
          // Title unresolved takes priority — DOB is asked about afterward
          // (see the resolution order in handleBookOnHold), still queued
          // here so it isn't lost once title resolves.
          queueDobIfNeeded({ firstName: effectiveFirstName, lastName });
        }
      });
    slots.additionalPassengers = resolved;
    if (titlePending.length) slots.pendingAdditionalTitleConfirmations = titlePending;
    if (dobPending.length) slots.pendingAdditionalDateOfBirthConfirmations = dobPending;
  }

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

// Same reproduced-bug shape as messageActuallyNamesAirline above: the LLM
// set entities.cabinClass to "Premium" on a turn that never mentioned
// premium/business at all, apparently pulled from earlier conversation
// context rather than the current message — confirmed live (a plain
// Economy request got booked into Premium/Business unprompted). Cabin
// class must default to Economy unless the CURRENT message explicitly
// asks for it, so this is checked directly against the raw text instead
// of trusting the LLM's extraction on faith.
function messageActuallyRequestsPremiumCabin(rawMessage: string): boolean {
  return /\b(premium|business)\b/i.test(rawMessage);
}

// Same reproduced-bug shape again: the LLM sometimes set entities.returnDate
// on a message that only ever gave ONE travel date — e.g. a date arriving
// before the route instead of after apparently got misread as a return
// date rather than the outbound one, silently turning a one-way request
// into a round trip. Per explicit product rules: trip type is decided by
// counting actual dates/routes in the message and checking for explicit
// return wording, never by field order or trusting the LLM's own claim.
const ROUND_TRIP_KEYWORD_PATTERN = /\b(return(?:ing)?|round[\s-]?trip)\b/i;

const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_EXPRESSION_PATTERN = new RegExp(
  `\\b(?:${MONTH_NAMES})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b` + // "August 6th"
    `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES})\\b` + // "6th August"
    `|\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b` + // ISO "2026-08-06"
    `|\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b` + // "06/08/2026"
    `|\\btomorrow\\b|\\btoday\\b|\\btonight\\b` +
    `|\\b(?:next|this)\\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\b`,
  "gi"
);

// Counts distinct DATE-LIKE EXPRESSIONS in the message, not distinct
// calendar dates — "6 August" and "August 6" mentioned once each still
// count as 2 if both literally appear, which is fine: the rule this backs
// (Rule 5 — one date ⇒ never a round trip) only needs to distinguish "one
// date phrase given" from "two or more given", not de-duplicate values.
function countDateExpressions(rawMessage: string): number {
  return (rawMessage.match(DATE_EXPRESSION_PATTERN) ?? []).length;
}

function resetRouteSlots(slots: ConversationSlots): void {
  slots.origin = null;
  slots.destination = null;
  slots.date = null;
  slots.returnDate = null;
  slots.isRoundTrip = false;
  slots.airline = null;
  slots.cabinClass = null;
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
  slots.passengerDateOfBirth = null;
  slots.pendingDepartureTimeOptions = null;
  slots.pendingReturnTimeOptions = null;
  slots.selectedDepartureTime = null;
  slots.selectedReturnTime = null;
  slots.pendingTitleConfirmation = null;
  slots.additionalPassengers = null;
  slots.pendingAdditionalTitleConfirmations = null;
  slots.pendingAdditionalDateOfBirthConfirmations = null;
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

// Parses a reply answering "what's <child>'s date of birth?" — an explicit
// date, or a stated age converted to an approximate date of birth (today
// minus that many years/months). Returns "YYYY-MM-DD" or null if nothing
// recognizable is present. Deliberately only used against a message already
// known (via pendingAdditionalDateOfBirthConfirmations) to be answering
// exactly this question — a bare "7" is too ambiguous to scan out of
// arbitrary free text otherwise.
function parseDateOfBirthReply(text: string): string | null {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  const monthsMatch = text.match(/\b(\d{1,2})\s*(?:months?|mo)\b/i);
  if (monthsMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(monthsMatch[1], 10));
    return d.toISOString().slice(0, 10);
  }

  const yearsMatch = text.match(/\b(\d{1,2})\s*(?:years?|yrs?)?\s*(?:old)?\b/i);
  if (yearsMatch) {
    const age = parseInt(yearsMatch[1], 10);
    if (age >= 0 && age <= 17) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - age);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

// Parses a single explicit clock time out of free text into a canonical
// 24-hour "HH:MM" string — 12-hour with am/pm ("4 PM", "4:00 PM", "4pm") or
// 24-hour with a colon ("16:00"). Bare 4-digit 24-hour ("1600") is only
// recognized when the WHOLE (trimmed) text is just that number — safe for a
// standalone reply to "what time?", but scanning it out of arbitrary free
// text risks false positives (e.g. a 4-digit year like "2026" is also a
// valid-looking HHMM). Returns null if no unambiguous time is present —
// never guesses.
// minute === null means only an HOUR was stated (e.g. "7pm", "7 o'clock") —
// per explicit product direction, "7pm" should match ANY flight departing
// 19:00-19:59, not require an exact "19:00". A minute IS present whenever
// the user gave one explicitly ("7:30pm", "19:45", "1945").
interface ParsedTime {
  hour: number;
  minute: string | null;
}

function parseTimeExpression(text: string): ParsedTime | null {
  const twelveHour = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*([ap])\.?m\.?\b/i);
  if (twelveHour) {
    let hour = parseInt(twelveHour[1], 10);
    const minute = twelveHour[2] ?? null;
    const isPM = /p/i.test(twelveHour[3]);
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return { hour, minute };
  }
  const withColon = text.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/);
  if (withColon) return { hour: parseInt(withColon[1], 10), minute: withColon[2] };
  const bareFourDigit = text.trim().match(/^([01][0-9]|2[0-3])([0-5][0-9])$/);
  if (bareFourDigit) return { hour: parseInt(bareFourDigit[1], 10), minute: bareFourDigit[2] };
  return null;
}

// Options are already shown zero-padded (e.g. "08:45"), but normalize
// defensively so a "H:MM" option would still compare equal to parseTimeExpression's output.
function normalizeOptionTime(opt: string): string {
  const m = opt.match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : opt;
}

// Resolves a ParsedTime against real flight options: an exact minute match
// when one was given, or — when only an hour was stated ("7pm") — whichever
// single option falls within that hour. More than one flight in the same
// hour is a genuine ambiguity (never guessed between); returns null so the
// caller falls through to asking, same as no match at all.
function findMatchingTimeOption(parsed: ParsedTime, options: string[]): string | null {
  if (parsed.minute !== null) {
    const exact = `${String(parsed.hour).padStart(2, "0")}:${parsed.minute}`;
    return options.find((opt) => normalizeOptionTime(opt) === exact) ?? null;
  }
  const inHour = options.filter((opt) => parseInt(normalizeOptionTime(opt).split(":")[0], 10) === parsed.hour);
  return inHour.length === 1 ? inHour[0] : null;
}

// Matches a free-text reply against a list of candidate departure times
// (e.g. "08:45"). Tries, in order: an explicit 12-hour or 24-hour time
// expression (so "4pm", "4:00 PM", and "16:00" all correctly match an
// option shown as "16:00"; a bare hour like "7pm" matches any option in
// that hour), then a looser exact/substring digit match (so "the 08:45
// one" still matches "08:45" even without am/pm), then an ordinal/position
// word ("first", "second", "1", "2").
// Returns null if nothing in the message plausibly picks one option.
function matchTimeSelection(message: string, options: string[]): string | null {
  const parsed = parseTimeExpression(message);
  if (parsed) {
    const byExplicitTime = findMatchingTimeOption(parsed, options);
    if (byExplicitTime) return byExplicitTime;
  }

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
  // The resolved departure time when exactly one flight was found.
  time: string | null;
  // True when `reply` is set because the disambiguation CHECK itself
  // failed (not because the route/date genuinely has no flights) — the
  // caller leaves every other slot untouched so simply retrying resolves
  // it, rather than resetting the whole booking and making the user
  // re-supply everything they already gave.
  retryable: boolean;
}

// Turns a leg's flight-count into the right outcome: exactly one flight ->
// use it silently, zero -> tell the user, more than one -> try the
// departure time the user already stated in their booking request (if any)
// before asking. A search failure asks the user to retry rather than
// silently proceeding without a preference — confirmed live that "proceed
// blind" guarantees a confusing, wasted automation failure whenever the
// route genuinely does have multiple flights (the booking automation's own
// ambiguity guard has no preferredDepartureTime to work with and refuses
// to guess), which is strictly worse than a quick, honest "try again."
function resolveLegFlightChoice(
  search: FlightSearchResult & { error?: string },
  leg: "outbound" | "return",
  rawMessage: string
): LegFlightChoiceOutcome {
  if (search.error) {
    console.warn(`[travel-assistant] ${leg} disambiguation search failed, asking to retry: ${search.error}`);
    const legNote = leg === "return" ? " for the return leg" : "";
    return {
      reply: `I'm having trouble checking available times${legNote} right now — mind trying again in a moment?`,
      pendingOptions: null,
      time: null,
      retryable: true,
    };
  }

  const times = search.options.map((o) => o.departureTime).filter((t): t is string => !!t);
  if (times.length === 0) {
    const legNote = leg === "return" ? " for the return leg" : "";
    return {
      reply: `I couldn't find any Enugu Air flights${legNote} for that route and date. Want to try a different date?`,
      pendingOptions: null,
      time: null,
      retryable: false,
    };
  }
  if (times.length === 1) {
    return { reply: null, pendingOptions: null, time: times[0], retryable: false };
  }

  // More than one flight — if the user's own booking request already named
  // an unambiguous departure time (12-hour or 24-hour), use it directly
  // instead of asking again. Only an explicit clock-time expression counts
  // here (see parseTimeExpression) — never an ordinal/bare digit, since
  // scanning those out of a free-text booking sentence (rather than a
  // direct reply to a shown list) would risk matching an unrelated number.
  const stated = parseTimeExpression(rawMessage);
  if (stated) {
    const match = findMatchingTimeOption(stated, times);
    if (match) return { reply: null, pendingOptions: null, time: match, retryable: false };
  }

  const legNote = leg === "return" ? "the return leg" : "your journey";
  return {
    reply: `I found multiple flights for ${legNote}.\nAvailable departure times are:\n${times.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nWhich departure time would you prefer? Reply with the number or the time.`,
    pendingOptions: times,
    time: null,
    retryable: false,
  };
}

// Drives the Book-on-Hold conversation: gather route + passenger details over
// as many turns as needed, then create the job and hand its id back for the
// chat to poll. Enugu Air and ValueJet only for now — a named other carrier
// is declined rather than silently swapped.
async function handleBookOnHold(
  sessionId: string,
  sessionKey: string,
  slots: ConversationSlots,
  turn: AssistantTurn,
  rawMessage: string
): Promise<OrchestratorOutput> {
  mergeEntitiesIntoSlots(slots, turn, rawMessage);

  const named = resolveNamedAirline(slots.airline);
  if (named && !BOOKABLE_AIRLINE_KEYS.has(named)) {
    const reply = `Right now I can only place a Book-on-Hold with Enugu Air, United Nigeria, XeJet, Rano Air, or ValueJet — ${named} isn't wired up for holds yet. Want me to hold one of those instead?`;
    await ChatMemoryRepository.updateSlots(sessionId, slots);
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }
  // Safe cast — BOOKABLE_AIRLINE_KEYS.has(named) was already checked above
  // (anything else returned early), so named can only be "ENUGU",
  // "VALUEJET", "UNITED", "XEJET", or "RANO" by this point.
  const bookingAirline = (named ?? "ENUGU") as "ENUGU" | "VALUEJET" | "UNITED" | "XEJET" | "RANO";
  const bookingAirlineLabel = AIRLINE_KEY_TO_DISPLAY_NAME[bookingAirline] ?? bookingAirline;

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

  // Same title/gender resolution, but for any additional passengers on a
  // multi-passenger PNR — resolved one at a time (oldest first) so a
  // multi-passenger booking never piles up several clarifying questions in
  // a single turn.
  if (slots.pendingAdditionalTitleConfirmations?.length) {
    const [current, ...rest] = slots.pendingAdditionalTitleConfirmations;
    const resolved = matchTitleConfirmation(rawMessage);
    if (!resolved) {
      const reply = `Please confirm the preferred title or gender for ${current.firstName} ${current.lastName}.`;
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
    if (slots.additionalPassengers?.[current.index]) {
      slots.additionalPassengers[current.index].title = resolved;
    }
    slots.pendingAdditionalTitleConfirmations = rest.length ? rest : null;
    if (slots.pendingAdditionalTitleConfirmations) {
      const next = slots.pendingAdditionalTitleConfirmations[0];
      const reply = `Got it. And for ${next.firstName} ${next.lastName}?`;
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
  }

  // Same one-at-a-time resolution, for a child/infant additional passenger
  // whose date of birth is still missing — the airline portal's own form
  // requires it for that passenger type (see VarsBookOnHold.ts), so this
  // blocks progress the same way title confirmation does, resolved AFTER
  // any pending titles so the two questions never pile up together.
  if (slots.pendingAdditionalDateOfBirthConfirmations?.length) {
    const [current, ...rest] = slots.pendingAdditionalDateOfBirthConfirmations;
    const resolved = parseDateOfBirthReply(rawMessage);
    if (!resolved) {
      const reply = `What's ${current.firstName} ${current.lastName}'s date of birth (or age)?`;
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
      return { reply };
    }
    if (slots.additionalPassengers?.[current.index]) {
      slots.additionalPassengers[current.index].dateOfBirth = resolved;
    }
    slots.pendingAdditionalDateOfBirthConfirmations = rest.length ? rest : null;
    if (slots.pendingAdditionalDateOfBirthConfirmations) {
      const next = slots.pendingAdditionalDateOfBirthConfirmations[0];
      const reply = `Got it. And ${next.firstName} ${next.lastName}'s date of birth (or age)?`;
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
      const reply = `I didn't catch which one — available departure times are:\n${slots.pendingDepartureTimeOptions.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nReply with the number or the time.`;
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
      const reply = `And for the return leg — available departure times are:\n${slots.pendingReturnTimeOptions.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nReply with the number or the time.`;
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
      // Scoped to airlines Book-on-Hold can actually place a hold with —
      // a shown United/Rano/XeJet option can never actually be held right
      // now, so resolving a reference to one of those would just be
      // setting the user up for the "not wired up yet" message moments
      // later instead of now.
      const bookableDisplayNames = new Set(Object.values(AIRLINE_KEY_TO_DISPLAY_NAME));
      const bookableOptions = results.options.filter((o) => bookableDisplayNames.has(o.airline));
      if (bookableOptions.length > 0) {
        const outcome = resolveShownFlightReference(rawMessage, bookableOptions);
        if (outcome.matched || outcome.ambiguousCandidates) {
          // The matched (or first ambiguous) option's own airline field
          // tells us which carrier this reference actually resolved to —
          // never assumed, since a shown search can mix both bookable
          // airlines' results together.
          const resolvedDisplayName = (outcome.matched ?? bookableOptions[0]).airline;
          const resolvedKey = Object.entries(AIRLINE_KEY_TO_DISPLAY_NAME).find(([, label]) => label === resolvedDisplayName)?.[0] ?? "ENUGU";
          slots.airline = resolvedKey;
          slots.origin = record.origin;
          slots.destination = record.destination;
          slots.date = record.date;
          if (outcome.matched) {
            slots.selectedDepartureTime = outcome.matched.departureTime;
          } else {
            const reply = `I found more than one ${resolvedDisplayName} option from that search — which one?\n${outcome.ambiguousCandidates!.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nReply with the number or the time.`;
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
    const outbound = await callSearchWithRetry(bookingAirline, slots.origin!, slots.destination!, slots.date!);
    const outcome = resolveLegFlightChoice(outbound, "outbound", rawMessage);
    if (outcome.reply) {
      if (outcome.pendingOptions) slots.pendingDepartureTimeOptions = outcome.pendingOptions;
      // retryable: leave every slot untouched so a plain "try again" simply
      // re-runs this same check next turn — resetting here would make the
      // user re-supply route/passenger details over a transient hiccup.
      else if (!outcome.retryable) resetBookingSlots(slots);
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", outcome.reply);
      return { reply: outcome.reply };
    }
    if (outcome.time) slots.selectedDepartureTime = outcome.time;
  }
  if (slots.isRoundTrip && !slots.selectedReturnTime) {
    const inbound = await callSearchWithRetry(bookingAirline, slots.destination!, slots.origin!, slots.returnDate!);
    const outcome = resolveLegFlightChoice(inbound, "return", rawMessage);
    if (outcome.reply) {
      if (outcome.pendingOptions) slots.pendingReturnTimeOptions = outcome.pendingOptions;
      else if (!outcome.retryable) resetBookingSlots(slots);
      await ChatMemoryRepository.updateSlots(sessionId, slots);
      await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", outcome.reply);
      return { reply: outcome.reply };
    }
    if (outcome.time) slots.selectedReturnTime = outcome.time;
  }

  const result = await startBookOnHold({
    airline: bookingAirline,
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
    cabinClass: slots.cabinClass === "PREMIUM" ? "PREMIUM" : "ECONOMY",
    additionalPassengers: slots.additionalPassengers?.map((p) => ({
      type: p.type,
      title: p.title ?? (p.type === "CHILD" ? "Mstr" : "Mr"),
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth ?? undefined,
    })),
    createdBy: sessionKey,
  });

  // Clear route + passenger slots so the next hold or search starts clean,
  // whether or not the trigger succeeded (a retry re-gathers details).
  resetBookingSlots(slots);
  await ChatMemoryRepository.updateSlots(sessionId, slots);

  if (result.status === "FAILED") {
    const reply = `I couldn't start the ${bookingAirlineLabel} hold just now — mind trying again in a moment? Please tell Muhammed the reason, and he'll fix it: "${result.error ?? "unknown error"}"`;
    await ChatMemoryRepository.appendMessage(sessionId, "ASSISTANT", reply);
    return { reply };
  }

  // Deliberately just "Copy" — per explicit product direction, this is the
  // acknowledgement that a booking request was received and IS now being
  // processed (the typing indicator covers the rest of the wait; the real
  // outcome — PNR, amount, etc. — arrives as its own follow-up message once
  // the job finishes). Generated here (not a client-side pre-check) so it
  // fires reliably even when the message never uses an explicit trigger
  // word like "book"/"hold" — the LLM already confirmed this IS a genuine
  // booking by the time this line runs.
  const reply = "Copy";
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

// Booking-time disambiguation is more failure-sensitive than a general
// flight search — confirmed live that a single flaky attempt here doesn't
// just miss a result, it can let a multi-flight booking automation run
// blind and fail confusingly deep inside Playwright (see
// resolveLegFlightChoice's search-error handling). One retry after a short
// delay costs a couple of seconds but closes most of that gap for a
// transient portal hiccup — used only at the two booking-disambiguation
// call sites, not the general multi-airline search path.
async function callSearchWithRetry(
  airline: string,
  origin: string,
  destination: string,
  date: string
): Promise<FlightSearchResult & { error?: string }> {
  const first = await callSearch(airline, origin, destination, date);
  if (!first.error) return first;
  console.warn(`[travel-assistant] ${airline} disambiguation search failed once, retrying: ${first.error}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return callSearch(airline, origin, destination, date);
}

// One airline's search having no ceiling of its own meant a single
// hung/slow carrier (a genuinely flaky external portal, confirmed live
// more than once) could drag the ENTIRE search past Vercel's 60s function
// limit — searchAllAirlines already isolates a failed airline gracefully
// via Promise.allSettled, but only if that airline actually settles.
// 25s leaves real headroom under the 60s ceiling even for the round-trip
// path (2 legs x up to 4 airlines, all concurrent) — a carrier this slow
// wasn't going to return usably fast anyway, so failing it fast and
// letting the others (and the whole quote) still come back is strictly
// better than one slow carrier taking the whole reply down with it.
const PER_AIRLINE_SEARCH_TIMEOUT_MS = 25000;

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
      signal: AbortSignal.timeout(PER_AIRLINE_SEARCH_TIMEOUT_MS),
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
    // fetch() itself threw — network failure, DNS, connector-service down,
    // or (AbortError, name-checked so the message is actually informative
    // instead of a generic "This operation was aborted") the per-airline
    // timeout above firing on a genuinely hung/slow carrier.
    const durationMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const message = isTimeout
      ? `timed out after ${PER_AIRLINE_SEARCH_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err);
    console.error(`[travel-assistant] ${airline} fetch failed after ${durationMs}ms:`, err);
    return {
      query: { origin, destination, date },
      options: [],
      searchedAt: new Date().toISOString(),
      error: message,
    };
  }
}
