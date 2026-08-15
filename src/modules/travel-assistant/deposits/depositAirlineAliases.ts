import type { AirlineKey } from "@prisma/client";

// Keyword aliases matched against a payment's narration/description text —
// configurable and extensible: add a new airline by adding an entry here,
// no other code changes needed elsewhere.
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
  aero: "AERO",
  "fly aero": "AERO",
  "air peace": "AIRPEACE",
  airpeace: "AIRPEACE",
  xejet: "XEJET",
  "xe jet": "XEJET",
  rano: "RANO",
  "rano air": "RANO",
};

// Longest alias first, so a multi-word alias ("air peace", "ibom air") is
// tried before a shorter one that could otherwise match part of it first
// (not currently a real collision here, but keeps this safe as more
// airlines/aliases get added later).
const SORTED_ALIASES = Object.entries(DEPOSIT_AIRLINE_ALIASES).sort((a, b) => b[0].length - a[0].length);

/**
 * Best-effort airline match from a payment's narration/description text.
 * Returns null when nothing matches — callers must NOT guess further past
 * this point; the spec is explicit that an unclear airline gets asked
 * about, never inferred.
 */
export function matchAirlineFromNarration(narration: string | null): AirlineKey | null {
  if (!narration) return null;
  const lower = narration.toLowerCase();
  for (const [alias, airline] of SORTED_ALIASES) {
    // Word-boundary match — a short alias like "un" or "enu" could
    // otherwise match inside an unrelated word; \b keeps it exact.
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(lower)) return airline;
  }
  return null;
}

// The fixed, numbered disambiguation menu shown when the airline can't be
// confidently determined from the narration — order matches the spec's
// own example. Kept as a separate list (not derived from the alias map)
// since menu order/wording is a display concern, independent of how many
// alias variants a given airline has.
export const DEPOSIT_AIRLINE_MENU: { num: number; airline: AirlineKey; label: string }[] = [
  { num: 1, airline: "VALUEJET", label: "ValueJet" },
  { num: 2, airline: "ENUGU", label: "Enugu Air" },
  { num: 3, airline: "UNITED", label: "United" },
  { num: 4, airline: "IBOM", label: "Ibom Air" },
  { num: 5, airline: "AERO", label: "Aero" },
  { num: 6, airline: "AIRPEACE", label: "Air Peace" },
  { num: 7, airline: "XEJET", label: "XeJet" },
  { num: 8, airline: "RANO", label: "Rano" },
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
