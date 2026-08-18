/**
 * POST /api/email/edit
 * Edit an email draft before sending
 * 
 * Request body:
 * {
 *   caseId: string
 *   subject?: string
 *   emailBody?: string
 *   editedByUser?: string
 * }
 * 
 * Response: { success, updatedDraft, error }
 */

import { NextRequest } from "next/server";
import { getEmailCase, updateEmailCaseDraft } from "@/modules/email-management/services/emailTemplateService";
import { sendDraftPreview } from "@/modules/email-management/integrations/whatsappIntegration";
import { EditDraftRequest, EditDraftResponse, EmailDraftPreview } from "@/modules/email-management/types/email.types";
import {
  EmailAPIError,
  ERROR_CODES,
  errorResponse,
  successResponse,
  validateRequired,
} from "@/modules/email-management/api/errorHandler";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as EditDraftRequest;

    // Validate required fields
    const missing = validateRequired(body, ["caseId"]);
    if (missing.length > 0) {
      throw new EmailAPIError(
        ERROR_CODES.MISSING_FIELD,
        `Missing required fields: ${missing.join(", ")}`,
        400
      );
    }

    // Validate at least one field is being updated
    if (!body.subject && !body.emailBody) {
      throw new EmailAPIError(
        ERROR_CODES.INVALID_REQUEST,
        "At least one field (subject or emailBody) must be provided for update",
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

    // Verify case is in DRAFT status
    if (emailCase.status !== "DRAFT") {
      throw new EmailAPIError(
        ERROR_CODES.INVALID_CASE_STATUS,
        `Cannot edit email from status: ${emailCase.status}. Case must be in DRAFT status.`,
        400,
        { currentStatus: emailCase.status }
      );
    }

    // Update draft
    console.log(`[Email API] Updating email draft for case: ${body.caseId}`);
    const updatedCase = await updateEmailCaseDraft(
      body.caseId,
      {
        subject: body.subject,
        emailBody: body.emailBody,
      },
      body.editedByUser || "system"
    );

    if (!updatedCase) {
      throw new EmailAPIError(
        ERROR_CODES.DATABASE_ERROR,
        "Failed to update email case in database"
      );
    }

    // Prepare updated draft preview
    const updatedDraft: EmailDraftPreview = {
      caseId: updatedCase.id,
      caseNumber: updatedCase.caseNumber || "",
      airline: {
        code: updatedCase.airline?.code || "UNKNOWN",
        name: updatedCase.airline?.name || "Unknown",
      },
      pnr: updatedCase.pnr,
      passengerNames: updatedCase.passengerNames,
      requestType: updatedCase.requestType,
      route: updatedCase.route || undefined,
      newTravelDate: updatedCase.newTravelDate || undefined,
      departureTime: updatedCase.departureTime || undefined,
      toRecipient: updatedCase.toRecipient,
      ccRecipients: updatedCase.ccRecipients || [],
      subject: updatedCase.subject,
      emailBody: updatedCase.emailBody,
      status: updatedCase.status,
      createdAt: updatedCase.createdAt.toISOString(),
    };

    // Send updated preview to WhatsApp
    try {
      if (emailCase.whatsappChatId) {
        console.log(`[Email API] Sending updated draft preview to WhatsApp`);
        await sendDraftPreview(emailCase.whatsappChatId, body.caseId, updatedDraft);
      }
    } catch (whatsappError) {
      console.error("[Email API] Failed to send updated preview to WhatsApp:", whatsappError);
      // Don't fail the request - draft was updated successfully
    }

    const response: EditDraftResponse = {
      success: true,
      updatedDraft,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  return successResponse({ 
    message: "Email draft editing endpoint is ready",
    method: "POST"
  });
}
