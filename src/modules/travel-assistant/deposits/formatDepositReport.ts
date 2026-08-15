import type { AirlineKey } from "@prisma/client";
import { toDisplayDate } from "./lagosDate";

export interface DepositReportRow {
  airline: AirlineKey;
  amount: number;
}

// Report-specific display names/order — deliberately separate from
// depositAirlineAliases.ts's DEPOSIT_AIRLINE_MENU (which is Title Case,
// numbered-selection order per spec section 2). This is UPPERCASE and in
// the order the report's own example (spec section 6) uses, which differs
// from the selection-menu order — both are literal per their own section
// of the spec, so this isn't "fixing" an inconsistency, just following
// each example where it actually appears.
const REPORT_AIRLINE_ORDER: { airline: AirlineKey; label: string }[] = [
  { airline: "UNITED", label: "UNITED" },
  { airline: "VALUEJET", label: "VALUE JET" },
  { airline: "AERO", label: "AERO" },
  { airline: "IBOM", label: "IBOM" },
  { airline: "ENUGU", label: "ENUGU" },
  { airline: "AIRPEACE", label: "AIR PEACE" },
  { airline: "XEJET", label: "XEJET" },
  { airline: "RANO", label: "RANO" },
];

function formatNaira(amount: number): string {
  return amount.toLocaleString("en-NG", { maximumFractionDigits: 0 });
}

/**
 * Builds the exact report text format from spec section 6, minus the
 * Opening Balance (OB) lines — explicitly left out for this testing phase
 * per product direction; the OB line for an airline reappears automatically
 * once that's wired back in, since this only ever renders what it's given.
 * Every total here is computed from the actual rows, never copied/assumed.
 */
export function formatDepositReport(dateIso: string, rows: DepositReportRow[]): string {
  const byAirline = new Map<AirlineKey, number[]>();
  for (const row of rows) {
    if (!byAirline.has(row.airline)) byAirline.set(row.airline, []);
    byAirline.get(row.airline)!.push(row.amount);
  }

  const header = `${toDisplayDate(dateIso)} AIRLINES DEPOSIT REPORT`;

  const airlineTotals: number[] = [];
  const lines: string[] = [header, ""];

  for (const { airline, label } of REPORT_AIRLINE_ORDER) {
    const amounts = byAirline.get(airline);
    if (!amounts || amounts.length === 0) continue; // no deposits this day — omit the airline entirely, matching "organize BY airline" (nothing to organize if there's nothing recorded)

    const total = amounts.reduce((sum, a) => sum + a, 0);
    airlineTotals.push(total);
    lines.push(label);
    lines.push(`DEPOSIT :${amounts.map(formatNaira).join(" +")}=${formatNaira(total)}`);
    lines.push("");
  }

  if (airlineTotals.length === 0) {
    return `${header}\n\nNo credited deposits recorded for this date yet.`;
  }

  const grandTotal = airlineTotals.reduce((sum, t) => sum + t, 0);
  lines.push("SUM TOTAL OF ALL DEPOSIT");
  lines.push(`${airlineTotals.map(formatNaira).join(" + ")} = ${formatNaira(grandTotal)}`);

  return lines.join("\n");
}
