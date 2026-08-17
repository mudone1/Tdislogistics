import type { AirlineKey } from "@prisma/client";
import { toDisplayDate } from "./lagosDate";

export interface DepositReportRow {
  airline: AirlineKey;
  amount: number;
}

// Report-specific display names/order — deliberately separate from
// depositAirlineAliases.ts's DEPOSIT_AIRLINE_MENU (which is Title Case,
// numbered-selection order). This is UPPERCASE and in the order the
// report's own real examples use.
const REPORT_AIRLINE_ORDER: { airline: AirlineKey; label: string }[] = [
  { airline: "UNITED", label: "UNITED" },
  { airline: "VALUEJET", label: "VALUE JET" },
  { airline: "AERO", label: "AERO" },
  { airline: "IBOM", label: "IBOM" },
  { airline: "ENUGU", label: "ENUGU" },
  { airline: "AIRPEACE", label: "AIR PEACE" },
  { airline: "XEJET", label: "XEJET" },
  { airline: "RANO", label: "RANO" },
  // Not in the earliest examples this format was built from (only 8
  // airlines existed at the time) — appended so a credited ARIK/NG Eagle
  // deposit doesn't silently vanish from the report just because it's
  // missing from this hardcoded order.
  { airline: "ARIK", label: "ARIK" },
  { airline: "NGEAGLE", label: "NG EAGLE" },
];

function formatNaira(amount: number): string {
  return amount.toLocaleString("en-NG", { maximumFractionDigits: 0 });
}

/**
 * Builds the "credit update" report text, one line per airline that had at
 * least one credited deposit this day:
 *
 *   {LABEL} CREDIT :{amt1} +{amt2} +...={total}
 *
 * — or, when this airline's opening balance for the day is known (see
 * openingBalances, sourced from AirlineOpeningBalanceRepository):
 *
 *   {LABEL}  OB :{ob} DEPOSIT :{amt1} +{amt2} +...={total}
 *
 * An airline with zero deposits this day is omitted entirely, regardless
 * of whether its OB is known — nothing to report if nothing was credited.
 * Every total here is computed from the actual rows, never copied/assumed.
 */
export function formatDepositReport(dateIso: string, rows: DepositReportRow[], openingBalances: Map<AirlineKey, number> = new Map()): string {
  const byAirline = new Map<AirlineKey, number[]>();
  for (const row of rows) {
    if (!byAirline.has(row.airline)) byAirline.set(row.airline, []);
    byAirline.get(row.airline)!.push(row.amount);
  }

  const header = `${toDisplayDate(dateIso)} AIRLINES CREDIT REPORT`;

  const airlineTotals: number[] = [];
  const lines: string[] = [header, ""];

  for (const { airline, label } of REPORT_AIRLINE_ORDER) {
    const amounts = byAirline.get(airline);
    if (!amounts || amounts.length === 0) continue; // no deposits this day — omit the airline entirely

    const total = amounts.reduce((sum, a) => sum + a, 0);
    airlineTotals.push(total);
    const depositList = amounts.map(formatNaira).join(" +");

    const ob = openingBalances.get(airline);
    if (ob !== undefined) {
      lines.push(`${label}  OB :${formatNaira(ob)} DEPOSIT :${depositList}=${formatNaira(total)}`);
    } else {
      lines.push(`${label} CREDIT :${depositList}=${formatNaira(total)}`);
    }
    lines.push("");
  }

  if (airlineTotals.length === 0) {
    return `${header}\n\nNo credited deposits recorded for this date yet.`;
  }

  const grandTotal = airlineTotals.reduce((sum, t) => sum + t, 0);
  lines.push("SUM TOTAL OF ALL CREDIT");
  lines.push(`${airlineTotals.map(formatNaira).join("+ ")} =${formatNaira(grandTotal)}`);

  return lines.join("\n");
}
