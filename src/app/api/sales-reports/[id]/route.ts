import { NextResponse } from "next/server";
import { prisma } from "@/modules/airline-connectors/storage/prismaClient";

export const runtime = "nodejs";

// Full detail view for one report — report text, staff totals, analytics,
// and supersession history in both directions (what this report replaced,
// and what replaced this report, if anything).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const report = await prisma.salesReport.findUnique({
      where: { id },
      include: {
        staffSales: true,
        analytics: true,
        tickets: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: `Report ${id} not found` }, { status: 404 });
    }

    const [supersededBy, supersedes] = await Promise.all([
      report.supersededById ? prisma.salesReport.findUnique({ where: { id: report.supersededById } }) : null,
      prisma.reportDuplicateHistory.findMany({ where: { supersededById: id } }),
    ]);

    return NextResponse.json({
      id: report.id,
      airline: report.airline,
      reportDate: report.reportDate,
      grandTotal: Number(report.grandTotal),
      confidence: report.confidence,
      reportText: report.reportText,
      status: report.status,
      createdAt: report.createdAt,
      verifiedAt: report.verifiedAt,
      verifiedBy: report.verifiedBy,
      airlineDetectedBy: report.airlineDetectedBy,
      detectionConfidence: report.detectionConfidence,
      detectionReasoning: report.detectionReasoning,
      originalFilename: report.originalFilename,
      staffTotals: report.staffSales.map((s) => ({
        staffName: s.staffName,
        amount: Number(s.amount),
        transactionCount: s.transactionCount,
      })),
      analytics: report.analytics
        ? {
            totalTicketsIssued: report.analytics.totalTicketsIssued,
            totalTicketsVoided: report.analytics.totalTicketsVoided,
            totalVoidAmount: Number(report.analytics.totalVoidAmount),
            totalCreditAmount: Number(report.analytics.totalCreditAmount),
            totalDebitAmount: Number(report.analytics.totalDebitAmount),
            grossSalesAmount: Number(report.analytics.grossSalesAmount),
            netSalesAmount: Number(report.analytics.netSalesAmount),
            totalCommission: Number(report.analytics.totalCommission),
          }
        : null,
      supersededBy: supersededBy ? { id: supersededBy.id, createdAt: supersededBy.createdAt } : null,
      supersedes: supersedes.map((h) => ({ originalReportId: h.originalReportId, replacedAt: h.replacedAt, replacedBy: h.replacedBy })),
    });
  } catch (err) {
    console.error("[sales-reports/[id]] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
