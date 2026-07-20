import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isCLDebit, isPTDebit, statusForIgnored } from "./shared";

// IBOM — PT Debit and CL Debit both count; PM, RT, and Credits are
// ignored. SYSTEM contains only CL Debit, never anything else.
export function classifyIbom(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  return rows.map((row) => {
    if (isPTDebit(row)) {
      return classifiedRow(row, resolveStaffName(row.user), false, true, "INCLUDED");
    }
    if (isCLDebit(row)) {
      return classifiedRow(row, "SYSTEM", true, true, "SYSTEM_CL_DEBIT");
    }
    return classifiedRow(row, resolveStaffName(row.user), false, false, statusForIgnored(row));
  });
}
