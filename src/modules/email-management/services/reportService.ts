/**
 * Email Report Service
 * 
 * Generates daily email activity reports for WhatsApp notifications
 * - 6 PM: Summary report
 * - 11 PM: Detailed end-of-day report
 */

import { prisma } from "@/lib/prisma";
import { formatDistanceToNow } from "date-fns";

export interface DailyReportSummary {
  reportDate: string;
  reportType: "SUMMARY" | "EOD";
  emailsSent: number;
  repliesReceived: number;
  pendingCases: number;
  approvedRefunds: number;
  completedVoids: number;
  completedReschedules: number;
  additionalInfoNeeded: number;
  rejectedCases: number;
  cases: CaseSummary[];
  whatsappText: string;
}

export interface CaseSummary {
  caseNumber: string;
  airline: string;
  pnr: string;
  passengers: string[];
  requestType: string;
  status: string;
  lastUpdate: string;
  daysWaiting: number;
}

/**
 * Generate 6 PM summary report
 */
export async function generateSummaryReport(): Promise<DailyReportSummary | null> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all cases from today
    const cases = await prisma.emailCase.findMany({
      where: {
        createdAt: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: {
        airline: true,
        replies: true,
      },
    });

    // Calculate metrics
    const emailsSent = cases.filter((c) => c.dateSent).length;
    const repliesReceived = cases.reduce((sum, c) => sum + c.replies.length, 0);
    const pendingCases = cases.filter(
      (c) => c.status === "AWAITING_AIRLINE_RESPONSE"
    ).length;
    const approvedRefunds = cases.filter((c) =>
      c.status === "COMPLETED" && c.requestType.includes("REFUND")
    ).length;
    const completedVoids = cases.filter(
      (c) => c.status === "COMPLETED" && c.requestType === "VOID"
    ).length;
    const completedReschedules = cases.filter(
      (c) => c.status === "COMPLETED" && c.requestType.includes("RESCHEDULE")
    ).length;
    const additionalInfoNeeded = cases.filter(
      (c) => c.status === "ADDITIONAL_INFO_REQUESTED"
    ).length;
    const rejectedCases = cases.filter((c) =>
      c.status === "COMPLETED" && c.replies.some((r) => r.statusUpdate?.includes("REJECTED"))
    ).length;

    // Build case summaries
    const caseSummaries = cases.map((c) => buildCaseSummary(c));

    // Generate WhatsApp text
    const whatsappText = generateSummaryReportText({
      emailsSent,
      repliesReceived,
      pendingCases,
      approvedRefunds,
      completedVoids,
      completedReschedules,
      additionalInfoNeeded,
    });

    const report: DailyReportSummary = {
      reportDate: today.toISOString().split("T")[0],
      reportType: "SUMMARY",
      emailsSent,
      repliesReceived,
      pendingCases,
      approvedRefunds,
      completedVoids,
      completedReschedules,
      additionalInfoNeeded,
      rejectedCases,
      cases: caseSummaries,
      whatsappText,
    };

    // Save to database
    await saveReport(report);

    return report;
  } catch (error) {
    console.error("Error generating summary report:", error);
    return null;
  }
}

/**
 * Generate 11 PM detailed end-of-day report
 */
export async function generateEndOfDayReport(): Promise<DailyReportSummary | null> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all cases from today
    const cases = await prisma.emailCase.findMany({
      where: {
        createdAt: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: {
        airline: true,
        replies: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    // Calculate metrics
    const emailsSent = cases.filter((c) => c.dateSent).length;
    const repliesReceived = cases.reduce((sum, c) => sum + c.replies.length, 0);
    const pendingCases = cases.filter(
      (c) => c.status === "AWAITING_AIRLINE_RESPONSE"
    ).length;
    const approvedRefunds = cases.filter((c) =>
      c.status === "COMPLETED" && c.requestType.includes("REFUND")
    ).length;
    const completedVoids = cases.filter(
      (c) => c.status === "COMPLETED" && c.requestType === "VOID"
    ).length;
    const completedReschedules = cases.filter(
      (c) => c.status === "COMPLETED" && c.requestType.includes("RESCHEDULE")
    ).length;
    const additionalInfoNeeded = cases.filter(
      (c) => c.status === "ADDITIONAL_INFO_REQUESTED"
    ).length;
    const rejectedCases = cases.filter((c) =>
      c.status === "COMPLETED" && c.replies.some((r) => r.statusUpdate?.includes("REJECTED"))
    ).length;

    // Build case summaries with full details
    const caseSummaries = cases.map((c) => buildCaseSummary(c));

    // Generate detailed WhatsApp text
    const whatsappText = generateEodReportText(caseSummaries, {
      emailsSent,
      repliesReceived,
      pendingCases,
      approvedRefunds,
      completedVoids,
      completedReschedules,
      additionalInfoNeeded,
      rejectedCases,
    });

    const report: DailyReportSummary = {
      reportDate: today.toISOString().split("T")[0],
      reportType: "EOD",
      emailsSent,
      repliesReceived,
      pendingCases,
      approvedRefunds,
      completedVoids,
      completedReschedules,
      additionalInfoNeeded,
      rejectedCases,
      cases: caseSummaries,
      whatsappText,
    };

    // Save to database
    await saveReport(report);

    return report;
  } catch (error) {
    console.error("Error generating end-of-day report:", error);
    return null;
  }
}

/**
 * Build case summary from email case
 */
function buildCaseSummary(
  emailCase: any & { airline: any; replies: any[] }
): CaseSummary {
  const now = new Date();
  const sentAt = emailCase.dateSent || emailCase.createdAt;
  const daysWaiting = Math.floor(
    (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    caseNumber: emailCase.caseNumber,
    airline: emailCase.airline.name,
    pnr: emailCase.pnr,
    passengers: emailCase.passengerNames,
    requestType: emailCase.requestType,
    status: emailCase.status,
    lastUpdate: emailCase.dateLastResponse
      ? formatDistanceToNow(emailCase.dateLastResponse, { addSuffix: true })
      : formatDistanceToNow(emailCase.dateSent || emailCase.createdAt, { addSuffix: true }),
    daysWaiting,
  };
}

/**
 * Generate summary report text for WhatsApp (6 PM)
 */
function generateSummaryReportText(metrics: {
  emailsSent: number;
  repliesReceived: number;
  pendingCases: number;
  approvedRefunds: number;
  completedVoids: number;
  completedReschedules: number;
  additionalInfoNeeded: number;
}): string {
  return `
📊 *EMAIL ACTIVITY REPORT - TODAY*

✉️  *Emails Sent:* ${metrics.emailsSent}
📮 *Replies Received:* ${metrics.repliesReceived}
⏳ *Pending Response:* ${metrics.pendingCases}

✅ *Completed:*
   • Refunds Approved: ${metrics.approvedRefunds}
   • Voids Completed: ${metrics.completedVoids}
   • Reschedules Completed: ${metrics.completedReschedules}

⚠️  *Needs Action:*
   • Additional Info Needed: ${metrics.additionalInfoNeeded}

📌 _Send "Email Update Now" for detailed breakdown_
  `.trim();
}

/**
 * Generate detailed end-of-day report text for WhatsApp (11 PM)
 */
function generateEodReportText(
  cases: CaseSummary[],
  metrics: any
): string {
  let text = `
📊 *END-OF-DAY EMAIL REPORT*

📈 *Daily Summary:*
   • Emails Sent: ${metrics.emailsSent}
   • Replies: ${metrics.repliesReceived}
   • Pending: ${metrics.pendingCases}
   • Approved Refunds: ${metrics.approvedRefunds}
   • Completed Voids: ${metrics.completedVoids}
   • Completed Reschedules: ${metrics.completedReschedules}
   • Additional Info Needed: ${metrics.additionalInfoNeeded}

📋 *Open Cases:*
  `;

  // Group by status
  const byStatus: Record<string, CaseSummary[]> = {};
  cases.forEach((c) => {
    if (!byStatus[c.status]) {
      byStatus[c.status] = [];
    }
    byStatus[c.status].push(c);
  });

  // Add up to 10 pending cases
  if (byStatus["AWAITING_AIRLINE_RESPONSE"]) {
    text += "\n⏳ *Awaiting Airline Response:*\n";
    byStatus["AWAITING_AIRLINE_RESPONSE"].slice(0, 10).forEach((c) => {
      text += `   ${c.pnr} • ${c.airline} • ${c.passengers[0]} • ${c.daysWaiting}d\n`;
    });
  }

  if (byStatus["ADDITIONAL_INFO_REQUESTED"]) {
    text += "\n⚠️  *Needs Additional Info:*\n";
    byStatus["ADDITIONAL_INFO_REQUESTED"].slice(0, 5).forEach((c) => {
      text += `   ${c.pnr} • ${c.airline} • ${c.passengers[0]}\n`;
    });
  }

  text += "\n_All cases properly tracked and monitored._";

  return text.trim();
}

/**
 * Save report to database
 */
async function saveReport(report: DailyReportSummary): Promise<void> {
  try {
    await prisma.emailDailyReport.create({
      data: {
        reportDate: new Date(report.reportDate),
        reportType: report.reportType,
        emailsSent: report.emailsSent,
        repliesReceived: report.repliesReceived,
        pendingCases: report.pendingCases,
        approvedRefunds: report.approvedRefunds,
        completedVoids: report.completedVoids,
        completedReschedules: report.completedReschedules,
        needsMoreInfo: report.additionalInfoNeeded,
        casesSummary: JSON.stringify(report.cases),
      },
    });
  } catch (error) {
    console.error("Error saving report:", error);
  }
}

/**
 * Get live status update for manual "Email Update Now" command
 */
export async function getManualStatusUpdate(): Promise<string> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cases = await prisma.emailCase.findMany({
      where: {
        createdAt: {
          gte: today,
        },
      },
      include: {
        airline: true,
        replies: true,
      },
    });

    const emailsSent = cases.filter((c) => c.dateSent).length;
    const repliesReceived = cases.reduce((sum, c) => sum + c.replies.length, 0);
    const pendingCases = cases.filter(
      (c) => c.status === "AWAITING_AIRLINE_RESPONSE"
    ).length;
    const completedCases = cases.filter((c) => c.status === "COMPLETED").length;

    let text = `
🔄 *LIVE EMAIL STATUS UPDATE*

📊 *Today's Activity:*
   • Total Emails Sent: ${emailsSent}
   • Total Replies: ${repliesReceived}

📈 *Current Status:*
   • ✅ Completed: ${completedCases}
   • ⏳ Pending Response: ${pendingCases}
   • 📋 Total Cases: ${cases.length}

⏱️  *Last Updated:* Just now

_Updated automatically throughout the day_
    `.trim();

    return text;
  } catch (error) {
    console.error("Error getting status update:", error);
    return "Unable to fetch status update at this time.";
  }
}
