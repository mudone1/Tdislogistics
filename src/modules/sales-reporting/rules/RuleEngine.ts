import type { AirlineRuleKey, RawTransactionRow, RuleEngineResult } from "../core/types";
import { classifyAero } from "./AeroRules";
import { classifyAirPeace } from "./AirPeaceRules";
import { classifyArik } from "./ArikRules";
import { classifyIbom } from "./IbomRules";
import { classifyTicketSalesReport } from "./TicketReportRules";
import { summarize } from "./shared";

// Adding a new airline: write its own classify function following the
// same (rows, resolveStaffName) => ClassifiedTransaction[] shape as the
// ones here, then add one line to this map — nothing else in the
// pipeline (parsing, reporting, storage) needs to change. Multiple
// airlines can point at the same classifier when they share an identical
// report format and rule set, as UNITED/RANO/ENUGU/XEJET do here.
const CLASSIFIERS: Record<
  AirlineRuleKey,
  (rows: RawTransactionRow[], resolveStaffName: (user: string) => string) => ReturnType<typeof classifyAero>
> = {
  AERO: classifyAero,
  AIRPEACE: classifyAirPeace,
  IBOM: classifyIbom,
  ARIK: classifyArik,
  UNITED: classifyTicketSalesReport,
  RANO: classifyTicketSalesReport,
  ENUGU: classifyTicketSalesReport,
  XEJET: classifyTicketSalesReport,
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
