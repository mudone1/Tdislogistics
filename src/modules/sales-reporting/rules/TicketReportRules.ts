import type { ClassifiedTransaction, RawTransactionRow } from "../core/types";
import { classifiedRow, isPTDebit, statusForIgnored } from "./shared";

// UNITED / RANO / ENUGU / XEJET — share the identical VARS/Videcom
// "ticket sales report" export and Status vocabulary (see ExcelParser's
// TICKET_REPORT_COLUMN_ALIASES/normalizeTicketReportKind), so one
// classifier serves all four (see RuleEngine's CLASSIFIERS map).
//
// ETKT is the actual ticket sale (kind PT, counts). VOID and REFUND both
// cancel a previously issued ticket and are matched 1:1 against a
// same-batch ETKT row by exact Ticket# — this format has no MCO
// reference at all, so RawTransactionRow.mcoReference is repurposed to
// carry the Ticket# instead, playing the identical "pin a cancellation to
// the one sale it cancels" role AirPeace's MCO-reference+PNR matching
// does. A same-day VOID-then-reissue (the common case in these exports)
// matches cleanly and the original sale is excluded via
// CANCELLED_BY_RT, exactly like AirPeace's PT/RT pairing.
//
// A REFUND against a ticket sold in an earlier report (a different
// date's batch — sometimes a different month entirely, common in this
// format) has no match available in the current batch. It is NOT
// force-matched against an unrelated ticket, and it is NOT counted as a
// negative adjustment to the current date's total either — it's simply
// excluded (IGNORED_RT), the same as an RT-kind row with no match ever
// is elsewhere in this engine. That means a refund never retroactively
// edits a prior period's already-reported sale, but it also means this
// classifier does not yet reduce today's total for money that left the
// account today — flagged as a known gap, not a silent decision to
// ignore refunds' cash impact.
//
// IN01/CF01/CF02/NOSH/NS01/NS02 are ancillary fee/no-show line items, not
// ticket sales — normalized to kind PM by ExcelParser, which every
// airline's rules (including this one) already ignore outright.
export function classifyTicketSalesReport(
  rows: RawTransactionRow[],
  resolveStaffName: (user: string) => string
): ClassifiedTransaction[] {
  const remainingByTicket = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "RT" || !r.mcoReference) continue;
    remainingByTicket.set(r.mcoReference, (remainingByTicket.get(r.mcoReference) ?? 0) + 1);
  }

  return rows.map((row) => {
    if (isPTDebit(row)) {
      const staffName = resolveStaffName(row.user);
      let cancelled = false;

      if (row.mcoReference != null) {
        const remaining = remainingByTicket.get(row.mcoReference) ?? 0;
        if (remaining > 0) {
          remainingByTicket.set(row.mcoReference, remaining - 1);
          cancelled = true;
        }
      }

      return cancelled
        ? classifiedRow(row, staffName, false, false, "CANCELLED_BY_RT")
        : classifiedRow(row, staffName, false, true, "INCLUDED");
    }
    return classifiedRow(row, resolveStaffName(row.user), false, false, statusForIgnored(row));
  });
}
