/**
 * Email Management - WhatsApp Message Handler
 * Processes incoming WhatsApp messages and routes to email system
 * 
 * This file should be imported and used in whatsapp-service message handler
 */

import axios from "axios";
import { parseEmailCommand } from "@/modules/email-management/config/emailTemplates";
import {
  UploadTicketRequest,
  UploadTicketResponse,
  SendEmailRequest,
  EditDraftRequest,
  CancelCaseRequest,
} from "@/modules/email-management/types/email.types";

/**
 * Main handler for incoming WhatsApp messages
 * Routes to appropriate email action based on message type and content
 */
export async function handleEmailManagementMessage(
  message: {
    type: "text" | "image" | "document" | "audio" | "video";
    text?: string;
    imageData?: string; // base64 data URL
    imageCaption?: string;
    chatId: string;
    messageId: string;
    timestamp: number;
    sender?: string;
  },
  emailApiBaseUrl: string = process.env.EMAIL_API_BASE_URL || "http://localhost:3000"
): Promise<any> {
  
  try {
    // Handle image messages (ticket screenshots)
    if (message.type === "image" && message.imageData) {
      return await handleTicketScreenshot(
        message.imageData,
        message.imageCaption || "Process this ticket",
        message.chatId,
        message.messageId,
        emailApiBaseUrl
      );
    }

    // Handle text messages (commands)
    if (message.type === "text" && message.text) {
      return await handleEmailCommand(
        message.text,
        message.chatId,
        emailApiBaseUrl
      );
    }

    return {
      handled: false,
      message: "Unsupported message type for email management",
    };
  } catch (error) {
    console.error("[Email Handler] Error processing message:", error);
    return {
      handled: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Handle ticket screenshot upload
 * Extracts image, sends to ticket parser, generates draft
 */
export async function handleTicketScreenshot(
  imageData: string,
  caption: string,
  chatId: string,
  messageId: string,
  emailApiBaseUrl: string
): Promise<UploadTicketResponse> {
  
  console.log("[Email Handler] Processing ticket screenshot");

  try {
    const payload: UploadTicketRequest = {
      imageData,
      command: caption,
      chatId,
      messageId,
    };

    const response = await axios.post<UploadTicketResponse>(
      `${emailApiBaseUrl}/api/email/upload-ticket`,
      payload,
      {
        timeout: 30000, // 30 second timeout for OCR
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("[Email Handler] Ticket processed successfully");
    return response.data;
  } catch (error) {
    console.error("[Email Handler] Failed to process ticket:", error);
    throw error;
  }
}

/**
 * Handle email text commands
 * Parses commands like:
 * - "Refund" (simple refund)
 * - "Void" (void ticket)
 * - "Reschedule to 31/08/2026 LOS-ABV at 7:30 AM"
 * - "Send CASE-2024-08-18-12345" (send existing draft)
 * - "Cancel CASE-2024-08-18-12345" (cancel case)
 * - "Status CASE-2024-08-18-12345" (get case status)
 */
export async function handleEmailCommand(
  text: string,
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Processing email command: ${text}`);

  const command = text.trim().toLowerCase();

  // Parse the command
  const parsed = parseEmailCommand(text);

  // Handle different command types
  if (command.startsWith("send ")) {
    // Send existing draft: "Send CASE-2024-08-18-12345"
    const caseId = text.substring(5).trim();
    return await sendEmailDraft(caseId, chatId, emailApiBaseUrl);
  }

  if (command.startsWith("cancel ")) {
    // Cancel case: "Cancel CASE-2024-08-18-12345"
    const caseId = text.substring(7).trim();
    return await cancelEmailCase(caseId, chatId, emailApiBaseUrl);
  }

  if (command.startsWith("status ")) {
    // Get case status: "Status CASE-2024-08-18-12345"
    const caseId = text.substring(7).trim();
    return await getCaseStatus(caseId, chatId, emailApiBaseUrl);
  }

  if (
    command.startsWith("refund") ||
    command.startsWith("void") ||
    command.startsWith("reschedule") ||
    command.startsWith("open")
  ) {
    // These should be used with a screenshot - can't process without PNR data
    return {
      handled: true,
      action: "need_screenshot",
      message:
        "Please send a screenshot of the ticket with your command as caption",
    };
  }

  // Check for manual status update
  if (
    command.includes("email update") ||
    command.includes("status update") ||
    command.includes("email now")
  ) {
    return await getManualStatusUpdate(chatId, emailApiBaseUrl);
  }

  return {
    handled: false,
    message: "Command not recognized. Expected: Refund, Void, Reschedule, or case ID",
  };
}

/**
 * Send an existing email draft
 */
export async function sendEmailDraft(
  caseId: string,
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Sending email for case: ${caseId}`);

  try {
    const payload: SendEmailRequest = {
      caseId,
      approvedByUser: chatId,
    };

    const response = await axios.post(
      `${emailApiBaseUrl}/api/email/send`,
      payload,
      { timeout: 10000 }
    );

    return {
      handled: true,
      success: response.data.success,
      data: response.data,
    };
  } catch (error) {
    console.error("[Email Handler] Failed to send email:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Cancel an email case
 */
export async function cancelEmailCase(
  caseId: string,
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Cancelling case: ${caseId}`);

  try {
    const payload: CancelCaseRequest = {
      caseId,
      reason: "Cancelled by user",
      cancelledByUser: chatId,
    };

    const response = await axios.post(
      `${emailApiBaseUrl}/api/email/cancel`,
      payload,
      { timeout: 10000 }
    );

    return {
      handled: true,
      success: response.data.success,
      data: response.data,
    };
  } catch (error) {
    console.error("[Email Handler] Failed to cancel case:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Failed to cancel case",
    };
  }
}

/**
 * Get case status
 */
export async function getCaseStatus(
  caseId: string,
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Fetching case status: ${caseId}`);

  try {
    const response = await axios.get(
      `${emailApiBaseUrl}/api/email/cases/${caseId}`,
      { timeout: 10000 }
    );

    return {
      handled: true,
      success: response.data.success,
      case: response.data.case,
    };
  } catch (error) {
    console.error("[Email Handler] Failed to get case status:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Case not found",
    };
  }
}

/**
 * Get manual status update (for "Email Update Now" command)
 */
export async function getManualStatusUpdate(
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Generating manual status update`);

  try {
    const response = await axios.get(
      `${emailApiBaseUrl}/api/email/reports/now`,
      { timeout: 10000 }
    );

    return {
      handled: true,
      success: response.data.success,
      report: response.data.report,
    };
  } catch (error) {
    console.error("[Email Handler] Failed to generate status update:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate report",
    };
  }
}

/**
 * Handle button response from WhatsApp interactive messages
 * Called when user clicks a button in draft preview
 * 
 * Button IDs:
 * - "1" = Send email
 * - "2" = Edit email
 * - "3" = Save draft for later
 * - "4" = Cancel case
 */
export async function handleDraftPreviewButton(
  buttonId: string,
  caseId: string,
  chatId: string,
  emailApiBaseUrl: string
): Promise<any> {
  
  console.log(`[Email Handler] Processing button ${buttonId} for case ${caseId}`);

  switch (buttonId) {
    case "1":
      // Send button
      return await sendEmailDraft(caseId, chatId, emailApiBaseUrl);

    case "2":
      // Edit button - return signal to wait for edit message
      return {
        handled: true,
        action: "await_edit",
        message: "Send your edited subject or body",
      };

    case "3":
      // Save draft - just acknowledge
      return {
        handled: true,
        action: "draft_saved",
        message: "Draft saved. Send 'Send CASE-ID' to send later",
      };

    case "4":
      // Cancel button
      return await cancelEmailCase(caseId, chatId, emailApiBaseUrl);

    default:
      return {
        handled: false,
        error: "Unknown button ID",
      };
  }
}

/**
 * Format case detail for WhatsApp display
 */
export function formatCaseForWhatsApp(caseData: any): string {
  const lines = [
    `📧 *Email Case*`,
    `Case: ${caseData.caseNumber}`,
    `PNR: ${caseData.pnr}`,
    `Airline: ${caseData.airline?.name || "Unknown"}`,
    `Status: ${caseData.status}`,
    ``,
    `*Details:*`,
    `Passengers: ${caseData.passengerNames?.join(", ") || "N/A"}`,
    `Request Type: ${caseData.requestType}`,
    `Created: ${new Date(caseData.createdAt).toLocaleString()}`,
  ];

  if (caseData.dateSent) {
    lines.push(`Sent: ${new Date(caseData.dateSent).toLocaleString()}`);
  }

  if (caseData.replies && caseData.replies.length > 0) {
    lines.push(``, `*Recent Reply:*`);
    const lastReply = caseData.replies[0];
    lines.push(`From: ${lastReply.fromEmail}`);
    lines.push(`Status: ${lastReply.statusUpdate || "N/A"}`);
  }

  return lines.join("\n");
}
