import type { AirlineKey } from "@prisma/client";

// Keyword aliases matched against a payment's narration AND beneficiary
// text — configurable and extensible: add a new airline by adding an
// entry here, no other code changes needed elsewhere.
//
// Real deposit-account beneficiary names are messy: banks/apps often
// concatenate words with no space at all (e.g. "Unitednigeria/logistics
// Tdis", "Enuguairltd/Losgistics Tdis"). A strict \b-word-boundary match
// (the original approach) can never match "united" inside "unitednigeria"
// — there's no boundary between the two. See matchAirlineFromReceipt
// below for how this is handled without needing a one-off alias for every
// possible concatenation.
//
// Corrected from the original spec draft: "Fly Aero" is Aero's own real
// brand (flyaero.com) — ValueJet's real public site is flyvaluejet.com,
// not "Fly Aero" (confirmed live via research earlier in this project, see
// ValueJetSearch.ts). Using "Fly Aero" as an alias for BOTH airlines as
// originally drafted would have misclassified one of them every time.
export const DEPOSIT_AIRLINE_ALIASES: Record<string, AirlineKey> = {
  united: "UNITED",
  un: "UNITED",
  enugu: "ENUGU",
  "enugu air": "ENUGU",
  enu: "ENUGU",
  ibom: "IBOM",
  "ibom air": "IBOM",
  valuejet: "VALUEJET",
  "value jet": "VALUEJET",
  vk: "VALUEJET",
  "fly valuejet": "VALUEJET",
  // ValueJet's real deposit/collection account is registered under this
  // legal name — doesn't contain "valuejet"/"value jet" anywhere, so it
  // needs its own explicit alias (see beneficiary example in the spec:
  // "Flyforvalue Aviation Ltd-collection Account").
  flyforvalue: "VALUEJET",
  aero: "AERO",
  "fly aero": "AERO",
  "aero contractor": "AERO",
  "air peace": "AIRPEACE",
  airpeace: "AIRPEACE",
  xejet: "XEJET",
  "xe jet": "XEJET",
  rano: "RANO",
  "rano air": "RANO",
  arik: "ARIK",
  "arik air": "ARIK",
  "ng eagle": "NGEAGLE",
  ngeagle: "NGEAGLE",
};

// Longest alias first, so a multi-word alias ("air peace", "ibom air") is
// tried before a shorter one that could otherwise match part of it first
// (not currently a real collision here, but keeps this safe as more
// airlines/aliases get added later).
const SORTED_ALIASES = Object.entries(DEPOSIT_AIRLINE_ALIASES).sort((a, b) => b[0].length - a[0].length);

// Aliases shorter than this are common-enough letter sequences ("un",
// "enu", "vk") that they need a strict word-boundary match to avoid
// false-positiving inside an unrelated word. Aliases at or above this
// length are specific enough that a plain substring match is safe — and
// it's what lets a concatenated legal name like "unitednigeria" or
// "enuguairltd" still match "united"/"enugu" without a one-off alias for
// every possible concatenation a bank app might produce.
const SUBSTRING_SAFE_LENGTH = 5;

function aliasMatches(lowerText: string, alias: string): boolean {
  if (alias.length >= SUBSTRING_SAFE_LENGTH) {
    return lowerText.includes(alias);
  }
  const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(lowerText);
}

/**
 * Best-effort airline match from a payment's narration and/or beneficiary
 * text — checks both fields because the airline name often only shows up
 * in ONE of them (a generic narration like "TDIS DEPOSIT" alongside a
 * beneficiary like "Unitednigeria/logistics Tdis" that actually names the
 * airline, or vice versa). Returns null when nothing matches in either —
 * callers must NOT guess further past this point; the spec is explicit
 * that an unclear airline gets asked about, never inferred.
 */
export function matchAirlineFromReceipt(narration: string | null, beneficiary?: string | null): AirlineKey | null {
  const combined = [narration, beneficiary].filter((v): v is string => !!v).join(" | ");
  if (!combined) return null;
  const lower = combined.toLowerCase();
  for (const [alias, airline] of SORTED_ALIASES) {
    if (aliasMatches(lower, alias)) return airline;
  }
  return null;
}

// Kept as a thin alias of the function above for any external caller that
// still only has narration text to hand — same matching behavior, just
// without a beneficiary field to also check.
export function matchAirlineFromNarration(narration: string | null): AirlineKey | null {
  return matchAirlineFromReceipt(narration, null);
}

// Any of these appearing in the beneficiary, bank/channel, or narration
// text means the money went to Paystack itself, not directly to an
// airline's own account — the airline then has to be asked about
// separately, it's never inferable from a Paystack receipt's own fields.
const PAYSTACK_KEYWORDS = ["paystack"];

export function isPaystackReceipt(narration: string | null, beneficiary?: string | null, bankChannel?: string | null): boolean {
  const combined = [narration, beneficiary, bankChannel]
    .filter((v): v is string => !!v)
    .join(" | ")
    .toLowerCase();
  if (!combined) return false;
  return PAYSTACK_KEYWORDS.some((kw) => combined.includes(kw));
}

// The fixed, numbered disambiguation menu shown when the airline can't be
// confidently determined from the receipt — order matches the spec's own
// example (Arik and NG Eagle appended at the end since the spec's example
// list doesn't dictate their position, but every AirlineKey enum member
// needs a way to be manually selected). Kept as a separate list (not
// derived from the alias map) since menu order/wording is a display
// concern, independent of how many alias variants a given airline has.
export const DEPOSIT_AIRLINE_MENU: { num: number; airline: AirlineKey; label: string }[] = [
  { num: 1, airline: "VALUEJET", label: "ValueJet" },
  { num: 2, airline: "ENUGU", label: "Enugu Air" },
  { num: 3, airline: "UNITED", label: "United" },
  { num: 4, airline: "IBOM", label: "Ibom Air" },
  { num: 5, airline: "AERO", label: "Aero" },
  { num: 6, airline: "AIRPEACE", label: "Air Peace" },
  { num: 7, airline: "XEJET", label: "XeJet" },
  { num: 8, airline: "RANO", label: "Rano" },
  { num: 9, airline: "ARIK", label: "Arik Air" },
  { num: 10, airline: "NGEAGLE", label: "NG Eagle" },
];

export function airlineMenuText(): string {
  return DEPOSIT_AIRLINE_MENU.map((o) => `${o.num}. ${o.label}`).join("\n");
}

export function resolveAirlineMenuNumber(num: number): AirlineKey | null {
  return DEPOSIT_AIRLINE_MENU.find((o) => o.num === num)?.airline ?? null;
}

export function displayNameFor(airline: AirlineKey): string {
  return DEPOSIT_AIRLINE_MENU.find((o) => o.airline === airline)?.label ?? airline;
}
