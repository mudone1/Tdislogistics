/**
 * POST /api/email/cancel
 * Cancel an email case
 * 
 * Request body:
 * {
 *   caseId: string
 *   reason?: string
 *   cancelledByUser?: string
 * }
 * 
 * Response: { success, message, error }
 */

import { NextRequest } from "next/server";
import { getEmailCase, cancelEmailCase } from "@/modules/email-management/services/emailTemplateService";
import { sendErrorNotification } from "@/modules/email-management/integrations/whatsappIntegration";
import { CancelCaseRequest, CancelCaseResponse } from "@/modules/email-management/types/email.types";
import {
  EmailAPIError,
  ERROR_CODES,
  errorResponse,
  successResponse,
  validateRequired,
} from "@/modules/email-management/api/errorHandler";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as CancelCaseRequest;

    // Validate required fields
    const missing = validateRequired(body, ["caseId"]);
    if (missing.length > 0) {
      throw new EmailAPIError(
        ERROR_CODES.MISSING_FIELD,
        `Missing required fields: ${missing.join(", ")}`,
        400
      );
    }

    // Get email case
    console.log(`[Email API] Fetching email case: ${body.caseId}`);
    const emailCase = await getEmailCase(body.caseId);

    if (!emailCase) {
      throw new EmailAPIError(
        ERROR_CODES.CASE_NOT_FOUND,
        `Email case not found: ${body.caseId}`,
        404
      );
    }

    // Cannot cancel if already sent (would need a different workflow for sent cases)
    if (emailCase.status === "SENT" || emailCase.status === "AWAITING_AIRLINE_RESPONSE") {
      throw new EmailAPIError(
        ERROR_CODES.CASE_ALREADY_SENT,
        `Cannot cancel email from status: ${emailCase.status}. Email has already been sent.`,
        400,
        { currentStatus: emailCase.status }
      );
    }

    // Cannot cancel if already closed
    if (emailCase.status === "CLOSED") {
      throw new EmailAPIError(
        ERROR_CODES.CASE_ALREADY_CLOSED,
        `Email case is already closed`,
        400
      );
    }

    // Cancel the case
    console.log(`[Email API] Cancelling email case: ${body.caseId}`);
    await cancelEmailCase(body.caseId, body.cancelledByUser || "system");

    // Send cancellation notification to WhatsApp
    try {
      if (emailCase.whatsappChatId) {
        console.log(`[Email API] Sending cancellation notification to WhatsApp`);
        await sendErrorNotification(emailCase.whatsappChatId, {
          title: "Email Case Cancelled",
          message: `Email case ${emailCase.caseNumber} has been cancelled.${body.reason ? ` Reason: ${body.reason}` : ""}`,
          caseId: body.caseId,
          pnr: emailCase.pnr,
        });
      }
    } catch (whatsappError) {
      console.error("[Email API] Failed to send cancellation notification:", whatsappError);
      // Don't fail the request - case was cancelled successfully
    }

    const response: CancelCaseResponse = {
      success: true,
      message: `Email case ${emailCase.caseNumber} has been cancelled`,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  return successResponse({ 
    message: "Email case cancellation endpoint is ready",
    method: "POST"
  });
}
