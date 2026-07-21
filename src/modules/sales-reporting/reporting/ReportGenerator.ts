import { prisma } from "../../airline-connectors/storage/prismaClient";
import { parseExcelBuffer } from "../parsing/ExcelParser";
import { parseScreenshotBuffers } from "../parsing/ScreenshotParser";
import { applyRules } from "../rules/RuleEngine";
import { resolveStaffName, normalizeRawCode } from "../staff/resolveStaffName";
import { StaffAliasRepository } from "../staff/StaffAliasRepository";
import { renderReportText } from "./ReportTextRenderer";
import { scoreConfidence } from "./ConfidenceScorer";
import type { AirlineRuleKey } from "../core/types";

const AIRLINE_LABELS: Record<AirlineRuleKey, string> = {
  AERO: "Aero",
  AIRPEACE: "Airpeace",
  IBOM: "Ibom",
  ARIK: "Arik",
};

export interface UploadedFile {
  name: string;
  buffer: Buffer;
  mimeType?: string;
}

// Excel by extension (the reliable path), otherwise treat anything with an
// image mime type as a screenshot. Anything else is rejected upstream.
function fileKind(file: UploadedFile): "EXCEL" | "SCREENSHOT" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "EXCEL";
  return "SCREENSHOT";
}

export interface GeneratedReportSummary {
  reportId: string;
  airline: AirlineRuleKey;
  reportDate: string;
  reportText: string;
  grandTotal: number;
  confidence: number;
  needsReview: boolean;
  confidenceReasons: string[];
  staffTotals: { staffName: string; amount: number; transactionCount: number }[];
  ticketCount: number;
  transactionsIncludedCount: number;
  transactionsIgnoredCount: number;
  unknownStaff: string[]; // raw codes needing human confirmation before saving
  warnings: string[];
}

// "DD/MM/YYYY" for whichever date appears most often across the parsed
// rows — a single upload is always one day's transactions in practice,
// but taking the mode (rather than just the first row) is cheap
// insurance against a stray misdated row skewing the header.
function detectReportDate(dates: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const d of dates) {
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts) {
    if (count > bestCount) {
      best = date;
      bestCount = count;
    }
  }
  if (best) return best;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

export async function generateReport(
  airline: AirlineRuleKey,
  files: UploadedFile[],
  createdBy?: string
): Promise<GeneratedReportSummary> {
  await StaffAliasRepository.ensureSeeded();
  const knownAliases = await StaffAliasRepository.listAll();

  const excelFiles = files.filter((f) => fileKind(f) === "EXCEL");
  const screenshotFiles = files.filter((f) => fileKind(f) === "SCREENSHOT");

  const allRows = [];
  const allWarnings: string[] = [];

  for (const file of excelFiles) {
    const parsed = parseExcelBuffer(file.buffer);
    allRows.push(...parsed.rows);
    allWarnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));
  }

  // All screenshots go to the vision model together as ONE report — a long
  // report split across several images must be merged before rule
  // processing (per spec), not parsed image-by-image.
  if (screenshotFiles.length > 0) {
    const parsed = await parseScreenshotBuffers(
      screenshotFiles.map((f) => ({ name: f.name, buffer: f.buffer, mimeType: f.mimeType ?? "image/png" }))
    );
    allRows.push(...parsed.rows);
    allWarnings.push(...parsed.warnings);
  }

  const unknownStaff = new Set<string>();
  const resolve = (rawCode: string): string => {
    const resolution = resolveStaffName(rawCode, knownAliases);
    if (!resolution.isKnown) unknownStaff.add(resolution.rawCode);
    return resolution.displayName;
  };

  const result = applyRules(airline, allRows, resolve);
  const reportDate = detectReportDate(allRows.map((r) => r.date));
  const reportText = renderReportText(AIRLINE_LABELS[airline], reportDate, result.staffTotals, result.transactions);
  const confidence = scoreConfidence(result.transactions, result.grandTotal, Array.from(unknownStaff), allWarnings.length);

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.salesReport.create({
      data: {
        airline,
        reportDate,
        grandTotal: result.grandTotal,
        confidence: confidence.score,
        reportText,
        sourceFiles: files.map((f) => ({ name: f.name, kind: fileKind(f) })),
        rulesVersion: "v1",
        createdBy,
        status: "PENDING_VERIFICATION",
      },
    });

    await tx.staffSales.createMany({
      data: result.staffTotals.map((s) => ({
        reportId: created.id,
        staffName: s.staffName,
        amount: s.amount,
        transactionCount: s.transactionCount,
      })),
    });

    await tx.salesTransaction.createMany({
      data: result.transactions.map((t) => ({
        reportId: created.id,
        staffName: t.staffName,
        amount: t.amount,
        paymentType: t.paymentTypeLabel,
        mcoReference: t.mcoReference,
        pnr: t.pnr,
        user: normalizeRawCode(t.user),
        rawRecord: t.raw,
        status: t.status,
      })),
    });

    const ticketRows = result.transactions.filter((t) => t.kind === "PT");
    await tx.salesTicket.createMany({
      data: ticketRows.map((t) => ({
        reportId: created.id,
        airline,
        date: t.date ?? reportDate,
        staff: t.staffName,
        pnr: t.pnr,
        mcoReference: t.mcoReference,
        ticketValue: t.amount,
        paymentType: t.paymentTypeLabel,
        status: t.status,
        included: t.included,
        reasonIfExcluded: t.included ? null : t.status,
      })),
    });

    return created;
  });

  const transactionsIncludedCount = result.transactions.filter((t) => t.included).length;

  return {
    reportId: report.id,
    airline,
    reportDate,
    reportText,
    grandTotal: result.grandTotal,
    confidence: confidence.score,
    needsReview: confidence.needsReview,
    confidenceReasons: confidence.reasons,
    staffTotals: result.staffTotals,
    ticketCount: result.ticketCount,
    transactionsIncludedCount,
    transactionsIgnoredCount: result.transactions.length - transactionsIncludedCount,
    unknownStaff: Array.from(unknownStaff),
    warnings: allWarnings,
  };
}

// Called only after a human explicitly confirms ("Reply Save"). Any
// staff-name corrections supplied at that point are learned permanently
// (StaffAliasRepository) AND applied retroactively to this specific
// report's own rows before it's marked SAVED — otherwise the very first
// report that taught the system a mapping would still show the old guess.
export async function confirmReport(
  reportId: string,
  verifiedBy: string,
  staffCorrections?: Record<string, string>
): Promise<GeneratedReportSummary> {
  const report = await prisma.salesReport.findUniqueOrThrow({ where: { id: reportId } });
  if (report.status === "SAVED") {
    throw new Error(`Report ${reportId} was already saved.`);
  }

  if (staffCorrections && Object.keys(staffCorrections).length > 0) {
    const transactions = await prisma.salesTransaction.findMany({ where: { reportId } });
    for (const [rawCodeRaw, displayName] of Object.entries(staffCorrections)) {
      const rawCode = normalizeRawCode(rawCodeRaw);
      await StaffAliasRepository.learn(rawCode, displayName);
      const oldNames = new Set(transactions.filter((t) => t.user === rawCode).map((t) => t.staffName));
      await prisma.salesTransaction.updateMany({ where: { reportId, user: rawCode }, data: { staffName: displayName } });
      for (const oldName of oldNames) {
        await prisma.salesTicket.updateMany({
          where: { reportId, staff: oldName },
          data: { staff: displayName },
        });
      }
    }

    // Recompute totals/report text from the now-corrected transaction rows
    // — simplest to just regroup from source of truth rather than
    // surgically patch aggregates.
    const included = await prisma.salesTransaction.findMany({ where: { reportId, status: { in: ["INCLUDED", "SYSTEM_CL_DEBIT"] } } });
    const order: string[] = [];
    const totals = new Map<string, { amount: number; count: number }>();
    for (const t of included) {
      if (!totals.has(t.staffName)) {
        totals.set(t.staffName, { amount: 0, count: 0 });
        order.push(t.staffName);
      }
      const cur = totals.get(t.staffName)!;
      cur.amount += Number(t.amount);
      cur.count += 1;
    }
    order.sort((a, b) => (a === "SYSTEM" ? 1 : b === "SYSTEM" ? -1 : 0));
    const staffTotals = order.map((staffName) => ({
      staffName,
      amount: totals.get(staffName)!.amount,
      transactionCount: totals.get(staffName)!.count,
    }));
    const grandTotal = staffTotals.reduce((sum, s) => sum + s.amount, 0);

    const allTransactions = await prisma.salesTransaction.findMany({ where: { reportId } });
    const reportText = renderReportText(
      AIRLINE_LABELS[report.airline as AirlineRuleKey],
      report.reportDate,
      staffTotals,
      allTransactions.map((t) => ({
        staffName: t.staffName,
        amount: Number(t.amount),
        included: t.status === "INCLUDED" || t.status === "SYSTEM_CL_DEBIT",
      }))
    );

    await prisma.staffSales.deleteMany({ where: { reportId } });
    await prisma.staffSales.createMany({
      data: staffTotals.map((s) => ({ reportId, staffName: s.staffName, amount: s.amount, transactionCount: s.transactionCount })),
    });
    await prisma.salesReport.update({ where: { id: reportId }, data: { grandTotal, reportText } });
  }

  const updated = await prisma.salesReport.update({
    where: { id: reportId },
    data: { status: "SAVED", verifiedBy, verifiedAt: new Date() },
    include: { staffSales: true, transactions: true },
  });

  return {
    reportId: updated.id,
    airline: updated.airline as AirlineRuleKey,
    reportDate: updated.reportDate,
    reportText: updated.reportText,
    grandTotal: Number(updated.grandTotal),
    confidence: updated.confidence,
    needsReview: updated.confidence < 0.9,
    confidenceReasons: [],
    staffTotals: updated.staffSales.map((s) => ({ staffName: s.staffName, amount: Number(s.amount), transactionCount: s.transactionCount })),
    ticketCount: updated.transactions.filter((t) => t.status === "INCLUDED" && t.paymentType === "PT").length,
    transactionsIncludedCount: updated.transactions.filter((t) => t.status === "INCLUDED" || t.status === "SYSTEM_CL_DEBIT").length,
    transactionsIgnoredCount: updated.transactions.filter((t) => t.status !== "INCLUDED" && t.status !== "SYSTEM_CL_DEBIT").length,
    unknownStaff: [],
    warnings: [],
  };
}

export async function discardReport(reportId: string): Promise<void> {
  await prisma.$transaction([
    prisma.salesTicket.deleteMany({ where: { reportId } }),
    prisma.salesTransaction.deleteMany({ where: { reportId } }),
    prisma.staffSales.deleteMany({ where: { reportId } }),
    prisma.salesReport.delete({ where: { id: reportId } }),
  ]);
}
