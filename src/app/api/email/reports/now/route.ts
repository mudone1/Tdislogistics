/**
 * GET /api/email/reports/now
 * Get manual status update with current case summaries
 * Used when user sends "Email Update Now" command
 * 
 * Response: { success, report, error }
 */

import { NextRequest } from "next/server";
import { generateSummaryReport } from "@/modules/email-management/services/reportService";
import {
  errorResponse,
  successResponse,
} from "@/modules/email-management/api/errorHandler";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    console.log("[Email API] Generating manual status update report");
    
    const report = await generateSummaryReport();

    if (!report) {
      return successResponse({
        success: true,
        report: {
          reportDate: new Date().toISOString().split("T")[0],
          reportType: "SUMMARY",
          metrics: {
            emailsSent: 0,
            repliesReceived: 0,
            pendingCases: 0,
            approvedRefunds: 0,
            completedVoids: 0,
            completedReschedules: 0,
            additionalInfoNeeded: 0,
            rejectedCases: 0,
          },
          cases: [],
          whatsappText: "No emails processed today.",
        },
      });
    }

    const response = {
      success: true,
      report,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  return successResponse({ 
    message: "Use GET to generate status update",
    method: "GET"
  });
}
