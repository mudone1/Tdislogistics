import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { AirlineRuleKey } from "../core/types";

export interface DuplicateMatchFactors {
  airline: boolean;
  date: boolean;
  salesAmount: number; // 0-1 similarity, not boolean — real amounts are rarely byte-identical
  ticketCount: boolean;
  fileHash?: boolean; // undefined when no hash was supplied to compare
}

export interface DuplicateMatch {
  matchScore: number; // 0-1
  existingReport: {
    id: string;
    date: string;
    airline: AirlineRuleKey;
    totals: { sales: number; tickets: number; voids: number };
    savedAt: string;
  };
  matchFactors: DuplicateMatchFactors;
}

// ±2% tolerance for rounding noise between an identical report parsed
// twice; anything past 3x that slides down to 0 rather than a hard cutoff.
const SALES_TOLERANCE = 0.02;

function salesSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const diff = Math.abs(a - b);
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  const percentDiff = avg === 0 ? 1 : diff / avg;

  if (percentDiff <= SALES_TOLERANCE) return 1;
  if (percentDiff <= SALES_TOLERANCE * 3) return 0.8;
  return Math.max(0, 1 - percentDiff);
}

// fileHash is only counted when both sides actually have one to compare —
// weight is redistributed across the remaining factors otherwise, rather
// than penalizing a match for a field neither report population.
function compositeScore(factors: DuplicateMatchFactors): number {
  let score = 0;
  let weight = 0;

  score += (factors.airline ? 1 : 0) * 0.25;
  weight += 0.25;
  score += (factors.date ? 1 : 0) * 0.25;
  weight += 0.25;
  score += factors.salesAmount * 0.3;
  weight += 0.3;
  score += (factors.ticketCount ? 1 : 0) * 0.15;
  weight += 0.15;
  if (factors.fileHash !== undefined) {
    score += (factors.fileHash ? 1 : 0) * 0.05;
    weight += 0.05;
  }

  return weight > 0 ? score / weight : 0;
}

// Same airline + same date is the candidate filter (in steady state there's
// only ever one SAVED report per airline/date); the composite score then
// decides whether that candidate is similar enough to be a re-upload of the
// same source, rather than a legitimately different correction that
// happens to share a date. Score >= 0.80 is reported as a duplicate; below
// that the caller should proceed with a normal save.
export async function checkDuplicate(
  airline: AirlineRuleKey,
  reportDate: string,
  totalSales: number,
  ticketCount: number,
  fileHash?: string
): Promise<DuplicateMatch | null> {
  const existing = await prisma.salesReport.findFirst({
    where: { airline, reportDate, status: "SAVED" },
    include: { analytics: true },
    orderBy: { verifiedAt: "desc" },
  });

  if (!existing) return null;

  const existingSales = existing.analytics?.grossSalesAmount ?? existing.grandTotal;
  const matchFactors: DuplicateMatchFactors = {
    airline: true, // guaranteed by the WHERE clause
    date: true, // guaranteed by the WHERE clause
    salesAmount: salesSimilarity(totalSales, Number(existingSales)),
    ticketCount: existing.analytics ? existing.analytics.totalTicketsIssued === ticketCount : false,
    fileHash: fileHash ? existing.fileHash === fileHash : undefined,
  };

  const matchScore = compositeScore(matchFactors);
  if (matchScore < 0.8) return null;

  return {
    matchScore,
    existingReport: {
      id: existing.id,
      date: existing.reportDate,
      airline: existing.airline as AirlineRuleKey,
      totals: {
        sales: Number(existing.grandTotal),
        tickets: existing.analytics?.totalTicketsIssued ?? 0,
        voids: existing.analytics?.totalTicketsVoided ?? 0,
      },
      savedAt: (existing.verifiedAt ?? existing.createdAt).toISOString(),
    },
    matchFactors,
  };
}

// A byte-identical re-upload (same source file) is a definite duplicate
// regardless of totals — short-circuits straight to a match without
// running the similarity scoring at all.
export async function checkExactFileDuplicate(
  fileHash: string
): Promise<{ id: string; airline: AirlineRuleKey; date: string } | null> {
  const existing = await prisma.salesReport.findFirst({ where: { fileHash, status: "SAVED" } });
  if (!existing) return null;
  return { id: existing.id, airline: existing.airline as AirlineRuleKey, date: existing.reportDate };
}

// Called once a user explicitly confirms "replace the existing report" for
// a detected duplicate. Records the old report's superseded-by pointer AND
// writes a ReportDuplicateHistory row — this is the audit trail an admin
// looks at later to see why a given date's numbers changed after the fact.
export async function recordSupersession(
  originalReportId: string,
  supersededById: string,
  replacedBy: string,
  replacementReason?: string
): Promise<void> {
  const original = await prisma.salesReport.findUniqueOrThrow({ where: { id: originalReportId } });

  await prisma.$transaction([
    prisma.salesReport.update({
      where: { id: originalReportId },
      data: { supersededById, supersededAt: new Date(), supersededBy: replacedBy },
    }),
    prisma.reportDuplicateHistory.create({
      data: {
        originalReportId,
        supersededById,
        airline: original.airline,
        reportDate: original.reportDate,
        originalStatus: original.status,
        replacedAt: new Date(),
        replacedBy,
        replacementReason,
      },
    }),
  ]);
}
