import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isCLDebit, isPTDebit, statusForIgnored } from "./shared";

// AIR PEACE — the most complex rule set. PT Debit and CL Debit count;
// PM, Credits, Commission Payback, and Deposits are ignored. CL Debit
// belongs under SYSTEM only — a PM commission entry must never land
// there even though it's also "system-generated".
//
// The distinguishing rule: some PT entries are cancelled by a matching
// RT (refund) entry sharing the same MCO Reference. A cancelled PT must
// NOT be counted, so RT rows are scanned first to build the set of MCO
// references they cancel, before any PT row is classified.
export function classifyAirPeace(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  const cancelledMcoReferences = new Set(
    rows.filter((r) => r.kind === "RT" && r.mcoReference).map((r) => r.mcoReference as string)
  );

  return rows.map((row) => {
    if (isPTDebit(row)) {
      const cancelled = row.mcoReference != null && cancelledMcoReferences.has(row.mcoReference);
      const staffName = resolveStaffName(row.user);
      return cancelled
        ? classifiedRow(row, staffName, false, false, "CANCELLED_BY_RT")
        : classifiedRow(row, staffName, false, true, "INCLUDED");
    }
    if (isCLDebit(row)) {
      return classifiedRow(row, "SYSTEM", true, true, "SYSTEM_CL_DEBIT");
    }
    return classifiedRow(row, resolveStaffName(row.user), false, false, statusForIgnored(row));
  });
}
