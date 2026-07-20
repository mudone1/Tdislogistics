import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isPTDebit, statusForIgnored } from "./shared";

// AERO — simplest of the non-Arik airlines: only PT Debit counts as a
// sale. PM, Credits, and Deposits are all operational records, not sales.
// No SYSTEM concept for this airline.
export function classifyAero(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  return rows.map((row) => {
    const included = isPTDebit(row);
    const staffName = resolveStaffName(row.user);
    return classifiedRow(row, staffName, false, included, included ? "INCLUDED" : statusForIgnored(row));
  });
}
