import { ENUGU_SUPPORTED_TITLES } from "./booking/vars-platform/VarsBookOnHold";

// Shared passenger-name casing rules, used both when a name comes off an
// ID-card scan (PassportParser) and when it's parsed from free-text chat
// (ConversationOrchestrator, and the deterministic /book command parser —
// relocated here 2026-08-14, verbatim, so both share one implementation
// instead of drifting apart).
export function toTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join("-")
    )
    .join(" ");
}

export function toSurnameCase(raw: string): string {
  return raw.trim().toUpperCase();
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

export function splitPassengerName(fullName: string): { firstName: string; lastName: string } {
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

export const TITLE_PREFIX_WORDS = new Set([
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
// extraction on faith" reasoning already applied to email/phone elsewhere:
// only fires when the caller didn't already have a separate title, so a
// genuinely single-word first name is never mistaken for one.
export function extractLeadingTitle(fullName: string): { title: string | null; rest: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { title: null, rest: fullName };
  const bare = words[0].replace(/\.$/, "").toLowerCase();
  if (!TITLE_PREFIX_WORDS.has(bare)) return { title: null, rest: fullName };
  const supported = (ENUGU_SUPPORTED_TITLES as readonly string[]).find((t) => t.toLowerCase() === bare);
  const title = supported ?? bare.charAt(0).toUpperCase() + bare.slice(1);
  return { title, rest: words.slice(1).join(" ") };
}

// Small, high-confidence common-name lists for a deterministic gender
// guess — deliberately NOT exhaustive. Anything not on either list falls
// through to "unsure", which resolvePendingPassengerTitle already handles
// safely (it asks the user rather than guessing) — the same "never force
// a guess" discipline already established for this exact field. "Precious"
// is intentionally on neither list — genuinely unisex in Nigerian usage.
const COMMON_MALE_FIRST_NAMES = new Set([
  "muhammed", "muhammad", "mohammed", "mohammad", "john", "michael", "david",
  "daniel", "emmanuel", "emeka", "musa", "ibrahim", "peter", "paul", "james",
  "joseph", "samuel", "joshua", "benjamin", "francis", "anthony", "victor",
  "kelvin", "chidi", "chinedu", "obi", "tunde", "segun", "femi", "yusuf",
  "abdullahi", "aliyu", "usman", "suleiman", "othniel", "raheem",
  "raheemiel", "godfrey", "stephen", "mark", "matthew", "andrew", "richard",
  "robert", "william", "charles", "abdulwahab", "wahab", "akeeb",
]);
const COMMON_FEMALE_FIRST_NAMES = new Set([
  "mary", "jennifer", "sarah", "grace", "aisha", "fatima", "chidinma",
  "blessing", "favour", "joy", "peace", "gift", "esther", "ruth",
  "comfort", "patience", "mercy", "joyce", "florence", "helen", "mariam",
  "zainab", "hauwa", "amaka", "ngozi", "adaeze", "elizabeth", "victoria",
  "princess",
]);

export function guessGenderFromFirstName(firstName: string): "male" | "female" | "unsure" {
  const first = firstName.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return "unsure";
  if (COMMON_MALE_FIRST_NAMES.has(first)) return "male";
  if (COMMON_FEMALE_FIRST_NAMES.has(first)) return "female";
  return "unsure";
}
