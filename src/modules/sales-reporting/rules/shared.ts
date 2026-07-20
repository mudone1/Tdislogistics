import type { ClassifiedTransaction, RawTransactionRow, RuleEngineResult, StaffTotal, TransactionStatus } from "../core/types";

export function isPTDebit(row: RawTransactionRow): boolean {
  return row.kind === "PT" && row.drCr === "DEBIT";
}

export function isCLDebit(row: RawTransactionRow): boolean {
  return row.kind === "CL" && row.drCr === "DEBIT";
}

// Status for a row that isn't included — used by every airline's rule
// module for the "everything else" branch. PM covers deposits, top-ups,
// and commission paybacks (real exports don't have separate Payment
// Types for those — they're all PM rows with descriptive text in the
// MCO Definition column, not a distinct kind). A Credit-direction row
// (a refund not routed through a distinct RT row) gets its own reason
// since it's a meaningfully different case from a wrong-kind row.
export function statusForIgnored(row: RawTransactionRow): TransactionStatus {
  if (row.kind === "PM") return "IGNORED_PM";
  if (row.kind === "RT") return "IGNORED_RT";
  if (row.drCr === "CREDIT") return "IGNORED_CREDIT";
  return "IGNORED_OTHER";
}

export function classifiedRow(
  row: RawTransactionRow,
  staffName: string,
  isSystem: boolean,
  included: boolean,
  status: TransactionStatus
): ClassifiedTransaction {
  return { ...row, staffName, isSystem, included, status };
}

// Shared by every airline once classification is done — builds per-staff
// totals (SYSTEM always last, matching the report format's convention),
// the grand total, and the ticket count (only PT-kind transactions count
// as tickets, per spec — CL/SYSTEM entries are sales-adjacent but never
// counted as a ticket issued).
export function summarize(transactions: ClassifiedTransaction[]): RuleEngineResult {
  const included = transactions.filter((t) => t.included);

  const order: string[] = [];
  const totals = new Map<string, { amount: number; count: number }>();
  for (const t of included) {
    if (!totals.has(t.staffName)) {
      totals.set(t.staffName, { amount: 0, count: 0 });
      order.push(t.staffName);
    }
    const cur = totals.get(t.staffName)!;
    cur.amount += t.amount;
    cur.count += 1;
  }

  order.sort((a, b) => (a === "SYSTEM" ? 1 : b === "SYSTEM" ? -1 : 0));

  const staffTotals: StaffTotal[] = order.map((staffName) => ({
    staffName,
    amount: totals.get(staffName)!.amount,
    transactionCount: totals.get(staffName)!.count,
  }));

  const grandTotal = staffTotals.reduce((sum, s) => sum + s.amount, 0);
  const ticketCount = included.filter((t) => t.kind === "PT").length;

  return { transactions, staffTotals, grandTotal, ticketCount };
}
