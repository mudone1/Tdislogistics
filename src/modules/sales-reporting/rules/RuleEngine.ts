import type { AirlineRuleKey, RawTransactionRow, RuleEngineResult } from "../core/types";
import { classifyAero } from "./AeroRules";
import { classifyAirPeace } from "./AirPeaceRules";
import { classifyArik } from "./ArikRules";
import { classifyIbom } from "./IbomRules";
import { summarize } from "./shared";

// Adding a new airline: write its own classify function following the
// same (rows, resolveStaffName) => ClassifiedTransaction[] shape as the
// four here, then add one line to this map — nothing else in the
// pipeline (parsing, reporting, storage) needs to change.
const CLASSIFIERS: Record<
  AirlineRuleKey,
  (rows: RawTransactionRow[], resolveStaffName: (user: string) => string) => ReturnType<typeof classifyAero>
> = {
  AERO: classifyAero,
  AIRPEACE: classifyAirPeace,
  IBOM: classifyIbom,
  ARIK: classifyArik,
};

export function applyRules(
  airline: AirlineRuleKey,
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): RuleEngineResult {
  const classify = CLASSIFIERS[airline];
  const transactions = classify(rows, resolveStaffName);
  return summarize(transactions);
}
