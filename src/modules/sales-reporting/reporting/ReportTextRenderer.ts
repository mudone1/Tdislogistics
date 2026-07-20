import type { StaffTotal } from "../core/types";

function formatAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// Only these three fields are ever read — a plain structural shape
// (rather than the full ClassifiedTransaction) so callers rebuilding
// this from stored DB rows (see ReportGenerator.confirmReport, which
// re-renders after staff-name corrections) don't need to fabricate
// unrelated fields just to satisfy the type.
export interface AmountEntry {
  staffName: string;
  amount: number;
  included: boolean;
}

// Exact text layout from the spec — no tables, no markdown. One section
// per staff (SYSTEM always last, per StaffTotal's existing ordering),
// each line listing that staff's individual included transaction
// amounts in source order, followed by "TOTAL = X", then a blank line
// before the next section and a final "GRAND TOTAL = X".
export function renderReportText(
  airlineLabel: string,
  reportDate: string,
  staffTotals: StaffTotal[],
  transactions: AmountEntry[]
): string {
  const amountsByStaff = new Map<string, number[]>();
  for (const t of transactions) {
    if (!t.included) continue;
    if (!amountsByStaff.has(t.staffName)) amountsByStaff.set(t.staffName, []);
    amountsByStaff.get(t.staffName)!.push(t.amount);
  }

  const sections = staffTotals.map((s) => {
    const amounts = amountsByStaff.get(s.staffName) ?? [];
    return [s.staffName, ...amounts.map(formatAmount), `TOTAL = ${formatAmount(s.amount)}`].join("\n");
  });

  const grandTotal = staffTotals.reduce((sum, s) => sum + s.amount, 0);
  const header = `${airlineLabel.toUpperCase()} SALES RECORD FOR ${reportDate}`;

  return [header, "", sections.join("\n\n"), "", `GRAND TOTAL = ${formatAmount(grandTotal)}`].join("\n");
}
