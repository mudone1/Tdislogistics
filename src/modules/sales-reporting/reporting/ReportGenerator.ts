import { createHash } from "crypto";
import { prisma } from "../../airline-connectors/storage/prismaClient";
import { parseExcelBuffer } from "../parsing/ExcelParser";
import { parseScreenshotBuffers } from "../parsing/ScreenshotParser";
import { applyRules } from "../rules/RuleEngine";
import { resolveStaffName, normalizeRawCode } from "../staff/resolveStaffName";
import { StaffAliasRepository } from "../staff/StaffAliasRepository";
import { renderReportText } from "./ReportTextRenderer";
import { scoreConfidence } from "./ConfidenceScorer";
import { checkDuplicate, recordSupersession, type DuplicateMatch } from "../services/DuplicateCheckService";
import type { AirlineRuleKey, RawTransactionRow } from "../core/types";
import type { DetectionMethod } from "../services/AirlineDetectionService";

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
  isDuplicate: boolean;
  duplicateMatch?: DuplicateMatch;
}

export interface DetectionMeta {
  method: DetectionMethod;
  confidence: number;
  reasoning: string[];
}

export interface GenerateReportOptions {
  createdBy?: string;
  importedBy?: string;
  detection?: DetectionMeta; // set when the caller ran AirlineDetectionService rather than a manual pick
}

function hashFiles(files: UploadedFile[]): string {
  const hash = createHash("sha256");
  for (const f of files) hash.update(f.buffer);
  return hash.digest("hex");
}

// Shared by both the daily and monthly upload paths — turns the uploaded
// files into one merged row list. Excel parses directly; screenshots go
// to the vision model together as ONE report (a long report split across
// several images must be merged before rule processing, not parsed
// image-by-image).
export async function parseFiles(files: UploadedFile[]): Promise<{ rows: RawTransactionRow[]; warnings: string[] }> {
  const excelFiles = files.filter((f) => fileKind(f) === "EXCEL");
  const screenshotFiles = files.filter((f) => fileKind(f) === "SCREENSHOT");

  const rows: RawTransactionRow[] = [];
  const warnings: string[] = [];

  for (const file of excelFiles) {
    const parsed = parseExcelBuffer(file.buffer);
    rows.push(...parsed.rows);
    warnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));
  }

  if (screenshotFiles.length > 0) {
    const parsed = await parseScreenshotBuffers(
      screenshotFiles.map((f) => ({ name: f.name, buffer: f.buffer, mimeType: f.mimeType ?? "image/png" }))
    );
    rows.push(...parsed.rows);
    warnings.push(...parsed.warnings);
  }

  return { rows, warnings };
}

// A monthly export contains rows spanning more than one calendar date; a
// daily export is (per business practice) always one day's transactions.
// Two or more distinct dates among the parsed rows is treated as monthly
// — a single stray misdated row isn't enough on its own since
// detectReportDate's mode-based logic already tolerates that for the
// daily path, but this check runs on the RAW distinct-date count instead
// of a mode, since a monthly file's dates are all real, not noise.
export function distinctDates(rows: RawTransactionRow[]): string[] {
  const dates = new Set<string>();
  for (const r of rows) if (r.date) dates.add(r.date);
  return Array.from(dates).sort((a, b) => parseDDMMYYYY(a) - parseDDMMYYYY(b));
}

export function isMonthlyUpload(rows: RawTransactionRow[]): boolean {
  return distinctDates(rows).length > 1;
}

function parseDDMMYYYY(d: string): number {
  const [day, month, year] = d.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
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
  options?: GenerateReportOptions,
  // Set by the route when it already parsed the files itself to decide
  // monthly vs daily — re-parsing here would re-run the (expensive,
  // Groq-vision-backed) screenshot path a second time.
  preParsed?: { rows: RawTransactionRow[]; warnings: string[] }
): Promise<GeneratedReportSummary> {
  const createdBy = options?.createdBy;
  await StaffAliasRepository.ensureSeeded();
  const knownAliases = await StaffAliasRepository.listAll();

  const { rows: allRows, warnings: allWarnings } = preParsed ?? (await parseFiles(files));

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

  const fileHash = hashFiles(files);
  const primaryFile = files[0];
  // checkDuplicate's own fileHash comparison already covers the exact-file
  // case (byte-identical upload) as one of its weighted factors, so a
  // single call covers both "same file re-uploaded" and "same
  // date/airline/totals from a different export" duplicates.
  const duplicateMatch = await checkDuplicate(airline, reportDate, result.grandTotal, result.ticketCount, fileHash);

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
        airlineDetectedBy: options?.detection?.method,
        detectionConfidence: options?.detection?.confidence,
        detectionReasoning: options?.detection?.reasoning ?? [],
        fileHash,
        originalFilename: primaryFile?.name,
        fileSize: files.reduce((sum, f) => sum + f.buffer.byteLength, 0),
        importedAt: new Date(),
        importedBy: options?.importedBy,
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
    isDuplicate: duplicateMatch != null,
    duplicateMatch: duplicateMatch ?? undefined,
  };
}

export interface DailyProcessResult {
  reportDate: string;
  reportId: string;
  grandTotal: number;
  ticketCount: number;
  wasOverwrite: boolean;
  needsReview: boolean;
  confidence: number;
}

export interface MonthlyUploadSummary {
  airline: AirlineRuleKey;
  totalDatesProcessed: number;
  datesOverwritten: string[];
  totalGrandTotal: number;
  totalTickets: number;
  perDate: DailyProcessResult[];
  warnings: string[];
}

// A monthly upload skips the PENDING_VERIFICATION/human-review step
// entirely, per product decision: rows are split by date, each date is
// classified through the SAME rule engine as a daily upload, and saved
// directly as SAVED — immediately reflected in the analytics rollups, no
// "Reply Save" step. A date that already has a SAVED report is
// superseded automatically, same "always overwrite, never ask" rule as
// confirmReport's daily path.
export async function processMonthlyUpload(
  airline: AirlineRuleKey,
  files: UploadedFile[],
  options?: GenerateReportOptions,
  preParsed?: { rows: RawTransactionRow[]; warnings: string[] }
): Promise<MonthlyUploadSummary> {
  await StaffAliasRepository.ensureSeeded();
  const knownAliases = await StaffAliasRepository.listAll();

  const { rows: allRows, warnings } = preParsed ?? (await parseFiles(files));
  const dates = distinctDates(allRows);

  const unknownStaff = new Set<string>();
  const resolve = (rawCode: string): string => {
    const resolution = resolveStaffName(rawCode, knownAliases);
    if (!resolution.isKnown) unknownStaff.add(resolution.rawCode);
    return resolution.displayName;
  };

  const fileHash = hashFiles(files);
  const primaryFile = files[0];
  const totalFileSize = files.reduce((sum, f) => sum + f.buffer.byteLength, 0);
  const attributedTo = options?.createdBy || options?.importedBy || "monthly-upload";

  const perDate: DailyProcessResult[] = [];
  const datesOverwritten: string[] = [];

  for (const date of dates) {
    const dayRows = allRows.filter((r) => r.date === date);
    const dayRawCodes = new Set(dayRows.map((r) => normalizeRawCode(r.user)));

    const result = applyRules(airline, dayRows, resolve);
    const reportText = renderReportText(AIRLINE_LABELS[airline], date, result.staffTotals, result.transactions);
    const dayUnknownStaff = Array.from(unknownStaff).filter((code) => dayRawCodes.has(code));
    const confidence = scoreConfidence(result.transactions, result.grandTotal, dayUnknownStaff, warnings.length);

    const existingSaved = await prisma.salesReport.findFirst({
      where: { airline, reportDate: date, status: "SAVED" },
    });

    const created = await prisma.$transaction(async (tx) => {
      const report = await tx.salesReport.create({
        data: {
          airline,
          reportDate: date,
          grandTotal: result.grandTotal,
          confidence: confidence.score,
          reportText,
          sourceFiles: files.map((f) => ({ name: f.name, kind: fileKind(f) })),
          rulesVersion: "v1",
          createdBy: options?.createdBy,
          status: "SAVED",
          verifiedBy: attributedTo,
          verifiedAt: new Date(),
          airlineDetectedBy: options?.detection?.method,
          detectionConfidence: options?.detection?.confidence,
          detectionReasoning: options?.detection?.reasoning ?? [],
          fileHash,
          originalFilename: primaryFile?.name,
          fileSize: totalFileSize,
          importedAt: new Date(),
          importedBy: options?.importedBy,
        },
      });

      await tx.staffSales.createMany({
        data: result.staffTotals.map((s) => ({
          reportId: report.id,
          staffName: s.staffName,
          amount: s.amount,
          transactionCount: s.transactionCount,
        })),
      });

      await tx.salesTransaction.createMany({
        data: result.transactions.map((t) => ({
          reportId: report.id,
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
          reportId: report.id,
          airline,
          date: t.date ?? date,
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

      return report;
    });

    if (existingSaved) {
      datesOverwritten.push(date);
      await recordSupersession(existingSaved.id, created.id, attributedTo, "Automatically superseded by monthly bulk upload.");
    }

    // Best-effort, matching confirmReport's own contract — the day's
    // report is already SAVED regardless of whether this succeeds.
    await syncDenormalizedAnalytics(created.id);

    perDate.push({
      reportDate: date,
      reportId: created.id,
      grandTotal: result.grandTotal,
      ticketCount: result.ticketCount,
      wasOverwrite: existingSaved != null,
      needsReview: confidence.needsReview,
      confidence: confidence.score,
    });
  }

  return {
    airline,
    totalDatesProcessed: perDate.length,
    datesOverwritten,
    totalGrandTotal: perDate.reduce((sum, d) => sum + d.grandTotal, 0),
    totalTickets: perDate.reduce((sum, d) => sum + d.ticketCount, 0),
    perDate,
    warnings,
  };
}

// Called only after a human explicitly confirms ("Reply Save"). Any
// staff-name corrections supplied at that point are learned permanently
// (StaffAliasRepository) AND applied retroactively to this specific
// report's own rows before it's marked SAVED — otherwise the very first
// report that taught the system a mapping would still show the old guess.
//
// Per product decision: uploading/saving a report for a date that
// already has a SAVED report always overwrites it automatically — no
// separate "Overwrite / Save Anyway" choice. This looks up any existing
// SAVED report for the same airline+date itself; the caller doesn't pass
// anything special to trigger it.
export async function confirmReport(
  reportId: string,
  verifiedBy: string,
  staffCorrections?: Record<string, string>
): Promise<GeneratedReportSummary> {
  const report = await prisma.salesReport.findUniqueOrThrow({ where: { id: reportId } });
  if (report.status === "SAVED") {
    throw new Error(`Report ${reportId} was already saved.`);
  }

  const existingSaved = await prisma.salesReport.findFirst({
    where: { airline: report.airline, reportDate: report.reportDate, status: "SAVED", id: { not: reportId } },
  });

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

  if (existingSaved) {
    await recordSupersession(existingSaved.id, reportId, verifiedBy, "Automatically superseded — a newer upload for the same airline/date was saved.");
  }

  // Best-effort: the report is already SAVED at this point regardless of
  // whether this succeeds — dashboard rollups can be backfilled/retried
  // separately, but a hiccup here must never undo the save itself.
  await syncDenormalizedAnalytics(reportId);

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
    isDuplicate: false,
  };
}

// Populates the denormalized rollup tables from this report's own
// transaction/ticket rows. Since DuplicateCheckService guarantees at most
// one SAVED report per (airline, date), this always fully REPLACES that
// date's rollup rows rather than incrementing — a superseding report's own
// confirm just overwrites the same (date, airline) rows, no separate
// subtract-old-add-new step needed.
//
// The rule engine's "included" set is entirely debit-direction (PT/CL
// debits only — see isPTDebit/isCLDebit in rules/shared.ts), so grandTotal
// already *is* the total debit amount; there's no separate gross/net split
// or commission calculation in the rule engine yet, so grossSalesAmount and
// netSalesAmount both hold that same figure and totalCommission is 0 until
// those rules exist. "Voided" maps to CANCELLED_BY_RT (a PT cancelled by a
// matching RT row) — the closest existing concept to a void in this domain.
export async function syncDenormalizedAnalytics(reportId: string): Promise<void> {
  const report = await prisma.salesReport.findUniqueOrThrow({ where: { id: reportId } });
  const tickets = await prisma.salesTicket.findMany({ where: { reportId } });
  const transactions = await prisma.salesTransaction.findMany({ where: { reportId } });

  const issuedTickets = tickets.filter((t) => t.included);
  const voidedTickets = tickets.filter((t) => t.status === "CANCELLED_BY_RT");
  const creditTransactions = transactions.filter((t) => t.status === "IGNORED_CREDIT");

  const totalTicketsIssued = issuedTickets.length;
  const totalTicketsVoided = voidedTickets.length;
  const totalVoidAmount = voidedTickets.reduce((sum, t) => sum + Number(t.ticketValue), 0);
  const totalCreditAmount = creditTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const grandTotal = Number(report.grandTotal);

  await prisma.salesReportAnalytics.upsert({
    where: { reportId },
    create: {
      reportId,
      airline: report.airline,
      reportDate: report.reportDate,
      totalTicketsIssued,
      totalTicketsVoided,
      totalVoidAmount,
      totalCreditAmount,
      totalDebitAmount: grandTotal,
      grossSalesAmount: grandTotal,
      netSalesAmount: grandTotal,
      totalCommission: 0,
    },
    update: {
      totalTicketsIssued,
      totalTicketsVoided,
      totalVoidAmount,
      totalCreditAmount,
      totalDebitAmount: grandTotal,
      grossSalesAmount: grandTotal,
      netSalesAmount: grandTotal,
      totalCommission: 0,
    },
  });

  await prisma.airlineDailyMetrics.upsert({
    where: { date_airline: { date: report.reportDate, airline: report.airline } },
    create: {
      date: report.reportDate,
      airline: report.airline,
      totalSales: grandTotal,
      totalTickets: totalTicketsIssued,
      totalVoids: totalTicketsVoided,
      totalVoidAmount,
      netSales: grandTotal,
    },
    update: {
      totalSales: grandTotal,
      totalTickets: totalTicketsIssued,
      totalVoids: totalTicketsVoided,
      totalVoidAmount,
      netSales: grandTotal,
    },
  });

  const staffNames = new Set(issuedTickets.map((t) => t.staff));
  for (const staffName of staffNames) {
    const staffTickets = issuedTickets.filter((t) => t.staff === staffName);
    const staffVoids = voidedTickets.filter((t) => t.staff === staffName);
    const staffCredits = creditTransactions.filter((t) => t.staffName === staffName);

    await prisma.staffDailyPerformance.upsert({
      where: { date_airline_staffName: { date: report.reportDate, airline: report.airline, staffName } },
      create: {
        date: report.reportDate,
        airline: report.airline,
        staffName,
        ticketsIssued: staffTickets.length,
        salesAmount: staffTickets.reduce((sum, t) => sum + Number(t.ticketValue), 0),
        commission: 0,
        voidAmount: staffVoids.reduce((sum, t) => sum + Number(t.ticketValue), 0),
        creditAmount: staffCredits.reduce((sum, t) => sum + Number(t.amount), 0),
      },
      update: {
        ticketsIssued: staffTickets.length,
        salesAmount: staffTickets.reduce((sum, t) => sum + Number(t.ticketValue), 0),
        commission: 0,
        voidAmount: staffVoids.reduce((sum, t) => sum + Number(t.ticketValue), 0),
        creditAmount: staffCredits.reduce((sum, t) => sum + Number(t.amount), 0),
      },
    });
  }
}

export async function discardReport(reportId: string): Promise<void> {
  await prisma.$transaction([
    prisma.salesTicket.deleteMany({ where: { reportId } }),
    prisma.salesTransaction.deleteMany({ where: { reportId } }),
    prisma.staffSales.deleteMany({ where: { reportId } }),
    prisma.salesReport.delete({ where: { id: reportId } }),
  ]);
}
