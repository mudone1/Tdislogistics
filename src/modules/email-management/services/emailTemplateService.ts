/**
 * Email Template Service
 * 
 * Manages email template rendering, validation, and database operations
 */

import { prisma } from "@/lib/prisma";
import {
  getTemplateById,
  renderTemplate as renderTemplateConfig,
  formatPassengerList,
  parseRequestType,
  parseRescheduleDetails,
} from "../config/emailTemplates";
import { getAirlineRecipients } from "../config/airlineEmailConfig";

export interface EmailDraftData {
  airline: string;
  pnr: string;
  passengerNames: string[];
  requestType: string;
  route?: string;
  newTravelDate?: string;
  departureTime?: string;
  commandText?: string; // Original command from user
}

export interface RenderedEmail {
  subject: string;
  body: string;
  toRecipient: string;
  ccRecipients: string[];
}

/**
 * Generate email draft from ticket and command
 */
export async function generateEmailDraft(
  data: EmailDraftData
): Promise<RenderedEmail | null> {
  try {
    // Step 1: Determine request type
    let requestType = data.requestType;
    if (data.commandText && !requestType) {
      const detected = parseRequestType(data.commandText);
      if (detected) {
        requestType = detected;
      }
    }

    if (!requestType) {
      throw new Error("Could not determine request type");
    }

    // Step 2: Get the appropriate template
    const template = getTemplateById(requestType);
    if (!template) {
      throw new Error(`No template found for request type: ${requestType}`);
    }

    // Step 3: Parse reschedule details if applicable
    let rescheduleDetails = { date: undefined, route: undefined, time: undefined };
    if (data.commandText && requestType.includes("RESCHEDULE")) {
      rescheduleDetails = parseRescheduleDetails(data.commandText);
    }

    // Step 4: Build template variables
    const variables: Record<string, string> = {
      PNR: data.pnr,
      PASSENGER_NAME: data.passengerNames[0] || "Passenger",
      PASSENGER_LIST: formatPassengerList(data.passengerNames),
      ROUTE: data.route || rescheduleDetails.route || "",
      TRAVEL_DATE: data.newTravelDate || rescheduleDetails.date || "",
      DEPARTURE_TIME: data.departureTime || rescheduleDetails.time || "",
    };

    // Step 5: Render template
    const rendered = renderTemplateConfig(requestType, variables);
    if (!rendered) {
      throw new Error("Failed to render template");
    }

    // Step 6: Get airline recipients
    const recipients = getAirlineRecipients(data.airline);
    if (!recipients.to) {
      throw new Error(`No email recipient found for airline: ${data.airline}`);
    }

    return {
      subject: rendered.subject,
      body: rendered.body,
      toRecipient: recipients.to,
      ccRecipients: recipients.cc,
    };
  } catch (error) {
    console.error("Error generating email draft:", error);
    return null;
  }
}

/**
 * Create email case draft in database
 */
export async function createEmailCaseDraft(
  data: EmailDraftData & { whatsappChatId: string; userId?: string }
): Promise<string | null> {
  try {
    // Generate draft
    const draft = await generateEmailDraft(data);
    if (!draft) {
      throw new Error("Failed to generate email draft");
    }

    // Determine request type enum value
    const requestType = data.requestType || parseRequestType(data.commandText || "");
    if (!requestType) {
      throw new Error("Invalid request type");
    }

    // Get or create airline in database
    let dbAirline = await prisma.emailAirline.findUnique({
      where: { code: data.airline },
    });

    if (!dbAirline) {
      dbAirline = await prisma.emailAirline.create({
        data: {
          code: data.airline,
          name: data.airline, // Name can be updated later
          isActive: true,
        },
      });
    }

    // Get template
    const template = getTemplateById(requestType);
    if (!template) {
      throw new Error(`Template not found for: ${requestType}`);
    }

    // Get or create template in database
    let dbTemplate = await prisma.emailTemplate.findUnique({
      where: { name: template.name },
    });

    if (!dbTemplate) {
      dbTemplate = await prisma.emailTemplate.create({
        data: {
          name: template.name,
          requestType: requestType as any,
          subject: template.subject,
          bodyTemplate: template.bodyTemplate,
          isActive: true,
        },
      });
    }

    // Generate case number
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "-");
    const caseNumber = `CASE-${today}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create email case
    const emailCase = await prisma.emailCase.create({
      data: {
        caseNumber,
        airlineId: dbAirline.id,
        pnr: data.pnr,
        passengerNames: data.passengerNames,
        requestType: requestType as any,
        route: data.route,
        newTravelDate: data.newTravelDate ? new Date(data.newTravelDate) : undefined,
        departureTime: data.departureTime,
        templateId: dbTemplate.id,
        subject: draft.subject,
        emailBody: draft.body,
        toRecipient: draft.toRecipient,
        ccRecipients: draft.ccRecipients,
        status: "DRAFT",
        whatsappChatId: data.whatsappChatId,
        createdByUser: data.userId,
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: emailCase.id,
        action: "DRAFT_CREATED",
        userId: data.userId,
        details: JSON.stringify({
          airline: data.airline,
          pnr: data.pnr,
          requestType,
        }),
      },
    });

    return emailCase.id;
  } catch (error) {
    console.error("Error creating email case draft:", error);
    return null;
  }
}

/**
 * Get email case by ID
 */
export async function getEmailCase(caseId: string) {
  try {
    return await prisma.emailCase.findUnique({
      where: { id: caseId },
      include: {
        airline: true,
        template: true,
        replies: true,
        auditTrail: { orderBy: { timestamp: "desc" } },
      },
    });
  } catch (error) {
    console.error("Error fetching email case:", error);
    return null;
  }
}

/**
 * Update email case (e.g., user edits draft)
 */
export async function updateEmailCaseDraft(
  caseId: string,
  updates: { subject?: string; emailBody?: string },
  userId?: string
): Promise<boolean> {
  try {
    const emailCase = await prisma.emailCase.update({
      where: { id: caseId },
      data: {
        subject: updates.subject,
        emailBody: updates.emailBody,
        updatedAt: new Date(),
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: caseId,
        action: "DRAFT_EDITED",
        userId,
        details: JSON.stringify({
          updatedFields: Object.keys(updates),
        }),
      },
    });

    return true;
  } catch (error) {
    console.error("Error updating email case:", error);
    return false;
  }
}

/**
 * Approve and send email case
 */
export async function approveAndSendEmail(
  caseId: string,
  userId?: string
): Promise<boolean> {
  try {
    const emailCase = await prisma.emailCase.findUnique({
      where: { id: caseId },
    });

    if (!emailCase) {
      throw new Error("Email case not found");
    }

    if (emailCase.status !== "DRAFT") {
      throw new Error(`Cannot send email with status: ${emailCase.status}`);
    }

    // TODO: Actually send email via SMTP
    // For now, just update status to SENT

    const updated = await prisma.emailCase.update({
      where: { id: caseId },
      data: {
        status: "SENT",
        dateSent: new Date(),
        approvedByUser: userId,
        dateApproved: new Date(),
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: caseId,
        action: "SENT",
        userId,
        details: JSON.stringify({
          toRecipient: emailCase.toRecipient,
          ccRecipients: emailCase.ccRecipients,
          pnr: emailCase.pnr,
        }),
      },
    });

    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}

/**
 * Cancel email case draft
 */
export async function cancelEmailCase(
  caseId: string,
  userId?: string
): Promise<boolean> {
  try {
    const emailCase = await prisma.emailCase.findUnique({
      where: { id: caseId },
    });

    if (!emailCase) {
      throw new Error("Email case not found");
    }

    if (emailCase.status !== "DRAFT") {
      throw new Error(`Cannot cancel email with status: ${emailCase.status}`);
    }

    await prisma.emailCase.update({
      where: { id: caseId },
      data: {
        status: "CLOSED",
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: caseId,
        action: "CANCELLED",
        userId,
      },
    });

    return true;
  } catch (error) {
    console.error("Error cancelling email case:", error);
    return false;
  }
}

/**
 * Save draft (for later)
 */
export async function saveDraftForLater(
  caseId: string,
  userId?: string
): Promise<boolean> {
  try {
    await prisma.emailCase.update({
      where: { id: caseId },
      data: {
        status: "DRAFT",
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: caseId,
        action: "DRAFT_SAVED_FOR_LATER",
        userId,
      },
    });

    return true;
  } catch (error) {
    console.error("Error saving draft:", error);
    return false;
  }
}

/**
 * Get all drafts for a WhatsApp chat
 */
export async function getDraftsForChat(chatId: string) {
  try {
    return await prisma.emailCase.findMany({
      where: {
        whatsappChatId: chatId,
        status: "DRAFT",
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("Error fetching drafts:", error);
    return [];
  }
}
