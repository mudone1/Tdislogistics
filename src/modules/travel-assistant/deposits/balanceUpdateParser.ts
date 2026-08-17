import type { AirlineKey } from "@prisma/client";

// The nightly "Balance Update" message (see the real examples this was
// built from) is plain text, one airline per line, no punctuation beyond
// commas in the number — e.g.:
//
//   Balance Update
//   Airpeace 1,715,306
//   Arik 1,008,590
//   Aero 62,212
//   Ibom 1,074,605
//   Eagle 968,743
//   United 181,422
//   Xejet 1,583,022
//   Rano 909,426
//   Enugu 275,890
//
// Deliberately regex-only, no AI call — the format is simple and fixed
// enough (one airline name, one number, per line) that a vision/LLM round
// trip would add latency and cost for zero accuracy benefit over a plain
// parse. Only used for the airlines this file's own alias map recognizes;
// United/Rano/Enugu/Xejet's real opening balance for the report comes from
// the existing automated wallet-sync system instead (see
// AirlineOpeningBalanceRepository.getOpeningBalances) — but a human
// operator's own reposting of ALL airlines every night (as seen in the
// real examples) is harmless: whichever four of those lines are for the
// sync-covered airlines just get parsed and stored the same as any other,
// simply never read back for those four at report time.
const TITLE_PATTERN = /^\s*balance\s*update\b/i;

// Deliberately a SEPARATE alias map from depositAirlineAliases.ts's
// DEPOSIT_AIRLINE_ALIASES, not a shared one — that file matches airline
// names as a SUBSTRING anywhere inside a longer narration/beneficiary
// string (so a short alias like "un" needs a strict word-boundary guard to
// avoid false-positiving inside an unrelated word). Here, each line is
// EXACTLY "{airline name} {amount}" and nothing else — the airline token
// is matched as a whole line-leading word, never as a substring buried in
// other text — so short/ambiguous tokens that would be unsafe over there
// (e.g. "air" on its own, seen in one of the real examples as shorthand
// for Air Peace) are perfectly safe here.
const BALANCE_LINE_ALIASES: Record<string, AirlineKey> = {
  airpeace: "AIRPEACE",
  "air peace": "AIRPEACE",
  air: "AIRPEACE",
  arik: "ARIK",
  aero: "AERO",
  ibom: "IBOM",
  eagle: "NGEAGLE",
  "ng eagle": "NGEAGLE",
  ngeagle: "NGEAGLE",
  united: "UNITED",
  xejet: "XEJET",
  rano: "RANO",
  enugu: "ENUGU",
  valuejet: "VALUEJET",
  "value jet": "VALUEJET",

};

// Matches "{airline name} {amount}" as the whole line — airline name is
// letters/spaces only, amount is digits with optional comma grouping.
// Anchored to the full line (^...$) so a line that doesn't cleanly match
// this shape (a stray caption, a sales-record line from a DIFFERENT kind
// of nightly message, etc.) is simply skipped rather than guessed at.
const LINE_PATTERN = /^([A-Za-z ]+?)\s+([\d,]+(?:\.\d+)?)\s*$/;

export interface ParsedOpeningBalance {
  airline: AirlineKey;
  balance: number;
}

/** True if this message's own first line identifies it as a nightly Balance Update post. */
export function isBalanceUpdateMessage(text: string): boolean {
  const firstLine = text.split("\n")[0] ?? "";
  return TITLE_PATTERN.test(firstLine);
}

/**
 * Parses every recognizable "{airline} {amount}" line out of a Balance
 * Update message. Unrecognized airline names and malformed lines are
 * silently skipped, never guessed at — matches the deposit-parsing
 * modules' own "never invent a value" principle. Duplicate lines for the
 * same airline: last one in the message wins (a correction reposted
 * lower down in the same message).
 */
export function parseBalanceUpdateMessage(text: string): ParsedOpeningBalance[] {
  const byAirline = new Map<AirlineKey, number>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || TITLE_PATTERN.test(line)) continue; // skip the title line itself

    const match = LINE_PATTERN.exec(line);
    if (!match) continue;

    const [, nameToken, amountToken] = match;
    const airline = BALANCE_LINE_ALIASES[nameToken.trim().toLowerCase()];
    if (!airline) continue; // unrecognized airline name — skip, don't guess

    const balance = Number(amountToken.replace(/,/g, ""));
    if (!Number.isFinite(balance)) continue;

    byAirline.set(airline, balance);
  }

  return Array.from(byAirline.entries()).map(([airline, balance]) => ({ airline, balance }));
}
