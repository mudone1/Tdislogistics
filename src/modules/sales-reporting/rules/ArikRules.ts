import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isPTDebit, statusForIgnored } from "./shared";

// ARIK — the simplest rule set of all: PT Debit only, everything else ignored.
export function classifyArik(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  return rows.map((row) => {
    const included = isPTDebit(row);
    const staffName = resolveStaffName(row.user);
    return classifiedRow(row, staffName, false, included, included ? "INCLUDED" : statusForIgnored(row));
  });
}
