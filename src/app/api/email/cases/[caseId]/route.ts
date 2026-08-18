/**
 * GET /api/email/cases/[caseId]
 * Get email case details including status, replies, and audit log
 * 
 * Response: { success, case, error }
 */

import { NextRequest } from "next/server";
import { getEmailCase } from "@/modules/email-management/services/emailTemplateService";
import { EmailCaseDetail } from "@/modules/email-management/types/email.types";
import {
  EmailAPIError,
  ERROR_CODES,
  errorResponse,
  successResponse,
} from "@/modules/email-management/api/errorHandler";

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } }
): Promise<Response> {
  try {
    const { caseId } = params;

    if (!caseId) {
      throw new EmailAPIError(
        ERROR_CODES.INVALID_CASE_ID,
        "Case ID is required",
        400
      );
    }

    console.log(`[Email API] Fetching email case: ${caseId}`);
    const emailCase = await getEmailCase(caseId);

    if (!emailCase) {
      throw new EmailAPIError(
        ERROR_CODES.CASE_NOT_FOUND,
        `Email case not found: ${caseId}`,
        404
      );
    }

    // Build detailed response
    const caseDetail: EmailCaseDetail = {
      id: emailCase.id,
      caseNumber: emailCase.caseNumber || "",
      airline: {
        code: emailCase.airline?.code || "UNKNOWN",
        name: emailCase.airline?.name || "Unknown",
      },
      pnr: emailCase.pnr,
      passengerNames: emailCase.passengerNames,
      requestType: emailCase.requestType,
      route: emailCase.route || undefined,
      newTravelDate: emailCase.newTravelDate || undefined,
      departureTime: emailCase.departureTime || undefined,
      subject: emailCase.subject,
      emailBody: emailCase.emailBody,
      toRecipient: emailCase.toRecipient,
      ccRecipients: emailCase.ccRecipients || [],
      status: emailCase.status,
      createdAt: emailCase.createdAt.toISOString(),
      updatedAt: emailCase.updatedAt.toISOString(),
      dateApproved: emailCase.dateApproved?.toISOString(),
      dateSent: emailCase.dateSent?.toISOString(),
      dateLastResponse: emailCase.dateLastResponse?.toISOString(),
      whatsappChatId: emailCase.whatsappChatId || undefined,
      whatsappMessageId: emailCase.whatsappMessageId || undefined,
      createdByUser: emailCase.createdByUser || undefined,
      approvedByUser: emailCase.approvedByUser || undefined,
      
      // Include replies if available
      replies: emailCase.emailReplies?.map((reply: any) => ({
        id: reply.id,
        fromEmail: reply.fromEmail,
        subject: reply.subject,
        body: reply.body,
        replyDate: reply.replyDate.toISOString(),
        statusUpdate: reply.statusUpdate,
      })),

      // Include audit trail if available
      auditTrail: emailCase.auditLogs?.map((log: any) => ({
        id: log.id,
        action: log.action,
        userId: log.userId,
        timestamp: log.timestamp.toISOString(),
        details: log.details,
      })).sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
    };

    const response = {
      success: true,
      case: caseDetail,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  return successResponse({ 
    message: "Use GET to fetch case details",
    method: "GET"
  });
}
