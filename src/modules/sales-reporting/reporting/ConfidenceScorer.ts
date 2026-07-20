import type { ClassifiedTransaction } from "../core/types";

export interface ConfidenceResult {
  score: number; // 0-1
  needsReview: boolean; // true below 0.9, per spec
  reasons: string[];
}

// A rule-based proxy, not a model score — the two things that actually
// make a generated report untrustworthy are (1) money attributed to a
// staff code we're only guessing at, and (2) rows the parser couldn't
// classify at all. Weighted by the SHARE of the grand total each issue
// touches, since 1 unknown code holding 80% of the money is a much
// bigger problem than 5 unknown codes holding 2% of it.
export function scoreConfidence(
  transactions: ClassifiedTransaction[],
  grandTotal: number,
  unknownStaffRawCodes: readonly string[],
  parserWarningCount: number
): ConfidenceResult {
  const reasons: string[] = [];
  let score = 1;

  if (grandTotal > 0 && unknownStaffRawCodes.length > 0) {
    const unknownAmount = transactions
      .filter((t) => t.included && unknownStaffRawCodes.includes(t.user))
      .reduce((sum, t) => sum + t.amount, 0);
    const share = unknownAmount / grandTotal;
    if (share > 0) {
      score -= 0.6 * share;
      reasons.push(
        `${unknownStaffRawCodes.length} unrecognized staff code(s) account for ${(share * 100).toFixed(0)}% of the grand total`
      );
    }
  }

  if (parserWarningCount > 0) {
    const penalty = Math.min(0.3, parserWarningCount * 0.03);
    score -= penalty;
    reasons.push(`${parserWarningCount} row(s) had parsing warnings`);
  }

  score = Math.max(0, Math.min(1, score));
  return { score, needsReview: score < 0.9, reasons };
}
