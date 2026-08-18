/**
 * POST /api/email/send
 * Send an approved email case to airline
 * 
 * Request body:
 * {
 *   caseId: string
 *   approvedByUser?: string
 * }
 * 
 * Response: { success, messageId, sentAt, error }
 */

import { NextRequest } from "next/server";
import { getEmailCase, approveAndSendEmail } from "@/modules/email-management/services/emailTemplateService";
import { sendEmail } from "@/modules/email-management/services/emailSendingService";
import { sendEmailConfirmation } from "@/modules/email-management/integrations/whatsappIntegration";
import { SendEmailRequest, SendEmailResponse } from "@/modules/email-management/types/email.types";
import {
  EmailAPIError,
  ERROR_CODES,
  errorResponse,
  successResponse,
  validateRequired,
} from "@/modules/email-management/api/errorHandler";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as SendEmailRequest;

    // Validate required fields
    const missing = validateRequired(body, ["caseId"]);
    if (missing.length > 0) {
      throw new EmailAPIError(
        ERROR_CODES.MISSING_FIELD,
        `Missing required fields: ${missing.join(", ")}`,
        400
      );
    }

    // Get email case from database
    console.log(`[Email API] Fetching email case: ${body.caseId}`);
    const emailCase = await getEmailCase(body.caseId);

    if (!emailCase) {
      throw new EmailAPIError(
        ERROR_CODES.CASE_NOT_FOUND,
        `Email case not found: ${body.caseId}`,
        404
      );
    }

    // Verify case is in DRAFT status
    if (emailCase.status !== "DRAFT") {
      throw new EmailAPIError(
        ERROR_CODES.INVALID_CASE_STATUS,
        `Cannot send email from status: ${emailCase.status}. Case must be in DRAFT status.`,
        400,
        { currentStatus: emailCase.status }
      );
    }

    // Send email via SMTP
    console.log(`[Email API] Sending email for case: ${body.caseId}`);
    const sendResult = await sendEmail({
      caseId: body.caseId,
      toRecipient: emailCase.toRecipient,
      ccRecipients: emailCase.ccRecipients || [],
      subject: emailCase.subject,
      body: emailCase.emailBody,
      pnr: emailCase.pnr,
      passengerNames: emailCase.passengerNames,
      airline: emailCase.airline?.code || "UNKNOWN",
    });

    if (!sendResult.success) {
      throw new EmailAPIError(
        ERROR_CODES.EMAIL_SEND_FAILED,
        sendResult.error || "Failed to send email",
        500
      );
    }

    // Update case status to SENT
    console.log(`[Email API] Updating case status to SENT`);
    await approveAndSendEmail(body.caseId, body.approvedByUser || "system");

    // Send WhatsApp confirmation
    try {
      if (emailCase.whatsappChatId) {
        console.log(`[Email API] Sending WhatsApp confirmation`);
        await sendEmailConfirmation(emailCase.whatsappChatId, {
          caseNumber: emailCase.caseNumber || "CASE-XXXX",
          pnr: emailCase.pnr,
          airline: emailCase.airline?.name || emailCase.airline?.code || "Unknown",
          passengers: emailCase.passengerNames,
          recipients: emailCase.ccRecipients
            ? [emailCase.toRecipient, ...emailCase.ccRecipients]
            : [emailCase.toRecipient],
          sentAt: new Date().toISOString(),
        });
      }
    } catch (whatsappError) {
      console.error("[Email API] Failed to send WhatsApp confirmation:", whatsappError);
      // Don't fail the request - email was sent successfully
    }

    const response: SendEmailResponse = {
      success: true,
      messageId: sendResult.messageId,
      sentAt: sendResult.sentAt,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  return successResponse({ 
    message: "Email sending endpoint is ready",
    method: "POST"
  });
}
