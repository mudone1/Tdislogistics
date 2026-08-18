/**
 * POST /api/email/upload-ticket
 * Upload ticket screenshot and generate email draft
 * 
 * Request body:
 * {
 *   imageData: string (base64 data URL)
 *   command: string (e.g., "Refund", "Void", "Reschedule to 31/08/2026 LOS-ABV at 7:30 AM")
 *   chatId: string (WhatsApp chat ID)
 *   messageId?: string (optional WhatsApp message ID)
 * }
 * 
 * Response: { success, caseId, draft, error }
 */

import { NextRequest } from "next/server";
import { extractTicketFromImage } from "@/modules/email-management/services/ticketParser";
import { createEmailCaseDraft } from "@/modules/email-management/services/emailTemplateService";
import { sendDraftPreview } from "@/modules/email-management/integrations/whatsappIntegration";
import { 
  UploadTicketRequest, 
  UploadTicketResponse,
  EmailDraftPreview 
} from "@/modules/email-management/types/email.types";
import {
  EmailAPIError,
  ERROR_CODES,
  errorResponse,
  successResponse,
  validateRequired,
  isValidBase64Image,
  base64DataUrlToBuffer,
} from "@/modules/email-management/api/errorHandler";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Parse request body
    const body = await request.json() as UploadTicketRequest;

    // Validate required fields
    const missing = validateRequired(body, ["imageData", "command", "chatId"]);
    if (missing.length > 0) {
      throw new EmailAPIError(
        ERROR_CODES.MISSING_FIELD,
        `Missing required fields: ${missing.join(", ")}`,
        400
      );
    }

    // Validate image data
    if (!isValidBase64Image(body.imageData)) {
      throw new EmailAPIError(
        ERROR_CODES.INVALID_BASE64_IMAGE,
        "Invalid base64 image data URL. Expected format: data:image/jpeg;base64,..."
      );
    }

    // Convert base64 to buffer
    const imageBuffer = base64DataUrlToBuffer(body.imageData);
    const mimeType = body.imageData.split(";")[0].replace("data:", "") || "image/jpeg";

    // Step 1: Extract ticket information
    console.log("[Email API] Extracting ticket from image...");
    const extractionResult = await extractTicketFromImage(imageBuffer, mimeType);

    if (!extractionResult.success) {
      throw new EmailAPIError(
        ERROR_CODES.TICKET_PARSING_FAILED,
        extractionResult.error || "Failed to parse ticket from image",
        400,
        { confidence: extractionResult.confidence, errors: extractionResult.errors }
      );
    }

    if (!extractionResult.data?.pnr) {
      throw new EmailAPIError(
        ERROR_CODES.PNR_NOT_FOUND,
        "Could not extract PNR from ticket. Please ensure ticket details are clearly visible.",
        400,
        { confidence: extractionResult.confidence }
      );
    }

    if (!extractionResult.data?.passengerNames || extractionResult.data.passengerNames.length === 0) {
      throw new EmailAPIError(
        ERROR_CODES.PASSENGERS_NOT_FOUND,
        "Could not extract passenger names from ticket.",
        400
      );
    }

    if (!extractionResult.data?.airlineCode) {
      throw new EmailAPIError(
        ERROR_CODES.AIRLINE_NOT_DETECTED,
        "Could not detect airline from ticket. Please verify ticket details.",
        400,
        { detectedAirline: extractionResult.data?.airline }
      );
    }

    const ticketData = extractionResult.data;

    // Step 2: Create email case draft
    console.log("[Email API] Creating email case draft...");
    const draftCase = await createEmailCaseDraft(
      {
        airlineCode: ticketData.airlineCode,
        pnr: ticketData.pnr,
        passengerNames: ticketData.passengerNames,
        requestType: "OPEN", // Will be updated if user specifies
        route: ticketData.route,
        newTravelDate: ticketData.travelDate,
        departureTime: ticketData.departureTime,
        commandText: body.command,
        whatsappChatId: body.chatId,
        whatsappMessageId: body.messageId,
      },
      "system" // createdByUser
    );

    if (!draftCase) {
      throw new EmailAPIError(
        ERROR_CODES.DATABASE_ERROR,
        "Failed to create email case in database"
      );
    }

    // Step 3: Prepare draft preview response
    const draftPreview: EmailDraftPreview = {
      caseId: draftCase.id,
      caseNumber: draftCase.caseNumber || "",
      airline: {
        code: ticketData.airlineCode,
        name: draftCase.airline?.name || ticketData.airlineCode,
      },
      pnr: draftCase.pnr,
      passengerNames: draftCase.passengerNames,
      requestType: draftCase.requestType,
      route: draftCase.route || undefined,
      newTravelDate: draftCase.newTravelDate || undefined,
      departureTime: draftCase.departureTime || undefined,
      toRecipient: draftCase.toRecipient,
      ccRecipients: draftCase.ccRecipients || [],
      subject: draftCase.subject,
      emailBody: draftCase.emailBody,
      status: draftCase.status,
      createdAt: draftCase.createdAt.toISOString(),
    };

    // Step 4: Send preview to WhatsApp
    try {
      console.log("[Email API] Sending draft preview to WhatsApp...");
      await sendDraftPreview(body.chatId, draftCase.id, draftPreview);
    } catch (whatsappError) {
      console.error("[Email API] Failed to send WhatsApp preview:", whatsappError);
      // Don't fail the request - draft was created successfully
      // WhatsApp notification failure is not critical
    }

    // Return success response
    const response: UploadTicketResponse = {
      success: true,
      caseId: draftCase.id,
      draft: draftPreview,
    };

    return successResponse(response, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

// Optional: Handle GET request to check health
export async function GET() {
  return successResponse({ 
    message: "Email ticket upload endpoint is ready",
    method: "POST"
  });
}
