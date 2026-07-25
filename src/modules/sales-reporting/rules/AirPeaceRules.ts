import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isCLDebit, isPTDebit, statusForIgnored } from "./shared";

// AIR PEACE — the most complex rule set. PT Debit and CL Debit count;
// PM, Credits, Commission Payback, and Deposits are ignored. CL Debit
// belongs under SYSTEM only — a PM commission entry must never land
// there even though it's also "system-generated".
//
// The distinguishing rule: some PT entries are cancelled by a matching
// RT (refund) entry. A cancelled PT must NOT be counted, so RT rows are
// scanned first to build a count of how many cancellations are
// available, before any PT row is classified.
//
// This is a 1:1 pairing (one RT cancels exactly one PT), never a "does
// this MCO reference appear on any RT row" set-membership check — an MCO
// reference can cover multiple tickets (e.g. a multi-sector booking), so
// matching by MCO reference alone would let one refund wrongly cancel
// EVERY PT row sharing that reference, silently dropping an otherwise-
// legitimate sale for whichever staff happened to share the reference
// with the actually-refunded ticket.
//
// PNR is preferred when both the RT and a candidate PT have one — a PNR
// identifies one specific ticket, so it pins the cancellation to the
// exact row it belongs to. MCO reference alone is only used as a
// fallback when a PNR isn't available on both sides, and even then each
// RT still only consumes one PT match (taken in row order), never all of
// them.
export function classifyAirPeace(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  const remainingByPnr = new Map<string, number>(); // key: `${mcoRef}::${pnr}`
  const remainingByMcoOnly = new Map<string, number>(); // RT rows with no PNR

  for (const r of rows) {
    if (r.kind !== "RT" || !r.mcoReference) continue;
    if (r.pnr) {
      const key = `${r.mcoReference}::${r.pnr}`;
      remainingByPnr.set(key, (remainingByPnr.get(key) ?? 0) + 1);
    } else {
      remainingByMcoOnly.set(r.mcoReference, (remainingByMcoOnly.get(r.mcoReference) ?? 0) + 1);
    }
  }

  return rows.map((row) => {
    if (isPTDebit(row)) {
      const staffName = resolveStaffName(row.user);
      let cancelled = false;

      if (row.mcoReference != null && row.pnr) {
        const key = `${row.mcoReference}::${row.pnr}`;
        const remaining = remainingByPnr.get(key) ?? 0;
        if (remaining > 0) {
          remainingByPnr.set(key, remaining - 1);
          cancelled = true;
        }
      }

      if (!cancelled && row.mcoReference != null) {
        const remaining = remainingByMcoOnly.get(row.mcoReference) ?? 0;
        if (remaining > 0) {
          remainingByMcoOnly.set(row.mcoReference, remaining - 1);
          cancelled = true;
        }
      }

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
