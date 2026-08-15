// Shared airline identity constants — the single place a new bookable
// airline gets added. Relocated (2026-08-14, verbatim, no behavior change)
// out of ConversationOrchestrator.ts so the new deterministic /book and
// /settings command parsers can share the exact same alias/key/display-name
// tables the rest of the assistant already uses, instead of duplicating or
// drifting from them.

export const ALL_AIRLINES = ["ENUGU", "UNITED", "XEJET", "RANO", "VALUEJET"] as const;

export const AIRLINE_NAME_MATCHERS: Record<string, string> = {
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
export const BOOKABLE_AIRLINE_KEYS = new Set(["ENUGU", "VALUEJET", "UNITED", "XEJET", "RANO"]);

// Display names matching each search module's FlightOption.airline field
// (EnuguAirSearch/ValueJetSearch/UnitedNigeriaSearch/XeJetSearch/
// RanoAirSearch's own AIRLINE_LABEL constants) — used to match a "book that
// flight" reference against a shown search result.
export const AIRLINE_KEY_TO_DISPLAY_NAME: Record<string, string> = {
  ENUGU: "Enugu Air",
  VALUEJET: "ValueJet",
  UNITED: "United Nigeria",
  XEJET: "XeJet",
  RANO: "Rano Air",
};

// Resolve a named carrier to its key, or null if the user didn't name a known
// airline. Reuses the same alias table the search path uses.
export function resolveNamedAirline(pref: string | null): string | null {
  if (!pref) return null;
  const p = pref.toLowerCase();
  for (const [name, key] of Object.entries(AIRLINE_NAME_MATCHERS)) {
    if (p.includes(name)) return key;
  }
  return null;
}
