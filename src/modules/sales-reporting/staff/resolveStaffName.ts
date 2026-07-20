export interface StaffResolution {
  rawCode: string;
  displayName: string;
  isKnown: boolean; // false means this is a best-effort guess, not a confirmed mapping
}

// Real exports aren't consistent about internal whitespace — e.g.
// "TRTL0003-OMOLALA  AINA" (double space before AINA) vs a stored alias
// keyed on "TRTL0003-OMOLALA AINA" (single space). Collapsing runs of
// whitespace to one space (in addition to trimming the ends) keeps the
// same person's code matching the same alias regardless of that
// formatting noise.
export function normalizeRawCode(rawCode: string): string {
  return rawCode.trim().replace(/\s+/g, " ");
}

// Best-effort guess for a code with no stored alias: take whatever
// follows the last "-" (the reservation-software prefix, e.g.
// "TDISLOGIST-", "TA0051-", "TRTL0003-") and use its first word. This
// gets the common case right but is deliberately NOT trusted as final —
// e.g. "TRTL0003-OMOLALA AINA" guesses "OMOLALA", not the real "OMO"
// nickname, which only a stored alias can capture. Callers must treat
// isKnown: false as "needs human confirmation before saving".
export function guessDisplayName(rawCode: string): string {
  const afterPrefix = rawCode.includes("-") ? rawCode.slice(rawCode.lastIndexOf("-") + 1) : rawCode;
  const firstWord = afterPrefix.trim().split(/\s+/)[0] ?? afterPrefix.trim();
  return firstWord.toUpperCase();
}

export function resolveStaffName(rawCode: string, knownAliases: ReadonlyMap<string, string>): StaffResolution {
  const normalized = normalizeRawCode(rawCode);
  const known = knownAliases.get(normalized);
  if (known) return { rawCode: normalized, displayName: known, isKnown: true };
  return { rawCode: normalized, displayName: guessDisplayName(normalized), isKnown: false };
}
