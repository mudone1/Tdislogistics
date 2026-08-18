/**
 * Email Reply Monitoring Service
 * 
 * Monitors email inbox for airline responses and updates case status
 * Can use polling or webhook-based approach
 */

import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

interface InboxEmail {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
  inReplyTo?: string;
  references?: string[];
}

/**
 * Check inbox for replies and update case statuses
 * This would run on a schedule (e.g., every 5 minutes)
 */
export async function checkForReplies(): Promise<{
  checked: number;
  matched: number;
  updated: number;
}> {
  try {
    // Step 1: Fetch recent emails from inbox
    const inboxEmails = await fetchInboxEmails();

    if (inboxEmails.length === 0) {
      return { checked: 0, matched: 0, updated: 0 };
    }

    let matched = 0;
    let updated = 0;

    // Step 2: Try to match each email to an email case
    for (const email of inboxEmails) {
      const emailCase = await matchEmailToCase(email);

      if (emailCase) {
        matched++;

        // Step 3: Parse response and determine status update
        const statusUpdate = parseEmailResponse(email.body, email.subject);

        // Step 4: Update case
        const result = await updateCaseFromReply(
          emailCase.id,
          email.from,
          email.subject,
          email.body,
          statusUpdate
        );

        if (result) {
          updated++;
        }
      }
    }

    return { checked: inboxEmails.length, matched, updated };
  } catch (error) {
    console.error("Error checking for replies:", error);
    return { checked: 0, matched: 0, updated: 0 };
  }
}

/**
 * Fetch recent emails from business inbox
 * This is a placeholder - actual implementation depends on email provider
 */
async function fetchInboxEmails(): Promise<InboxEmail[]> {
  try {
    // TODO: Implement email fetching based on provider:
    // - Gmail API: https://developers.google.com/gmail/api
    // - Office 365 / Microsoft Graph: https://docs.microsoft.com/en-us/graph/api/message-list
    // - Generic IMAP: use imap package

    // For now, return empty array (placeholder)
    return [];
  } catch (error) {
    console.error("Error fetching inbox emails:", error);
    return [];
  }
}

/**
 * Match email to email case by PNR, from, or other metadata
 */
async function matchEmailToCase(
  email: InboxEmail
): Promise<(typeof prisma.emailCase)["findUnique"] | null> {
  try {
    // Extract PNR from email (usually in subject or body)
    const pnrMatch = email.subject.match(/[A-Z0-9]{6}/) || 
                    email.body.match(/PNR\s*[:=]?\s*([A-Z0-9]{6})/i);
    
    if (!pnrMatch) {
      return null;
    }

    const pnr = pnrMatch[0] || pnrMatch[1];

    // Find case by PNR and sender
    const emailCase = await prisma.emailCase.findFirst({
      where: {
        pnr,
        status: "AWAITING_AIRLINE_RESPONSE",
      },
      include: {
        airline: true,
        replies: true,
      },
    });

    // Verify sender is from expected airline
    if (emailCase) {
      const senderDomain = email.from.split("@")[1]?.toLowerCase() || "";
      const airlineRecipients = await prisma.emailRecipient.findMany({
        where: {
          airlineId: emailCase.airlineId,
          isActive: true,
        },
      });

      const isFromAirline = airlineRecipients.some(
        (r) => r.email.split("@")[1]?.toLowerCase() === senderDomain
      );

      if (isFromAirline) {
        return emailCase;
      }
    }

    return emailCase || null;
  } catch (error) {
    console.error("Error matching email to case:", error);
    return null;
  }
}

/**
 * Parse airline response to determine status
 * Look for keywords indicating approval, rejection, or need for more info
 */
function parseEmailResponse(body: string, subject: string): string | null {
  const fullText = `${subject} ${body}`.toLowerCase();

  // Refund responses
  if (
    fullText.includes("refund") &&
    (fullText.includes("approved") || fullText.includes("processed"))
  ) {
    return "REFUND_APPROVED";
  }
  if (
    fullText.includes("refund") &&
    (fullText.includes("rejected") || fullText.includes("cannot"))
  ) {
    return "REFUND_REJECTED";
  }

  // Void responses
  if (fullText.includes("void") && fullText.includes("completed")) {
    return "VOID_COMPLETED";
  }
  if (fullText.includes("void") && fullText.includes("cannot")) {
    return "VOID_REJECTED";
  }

  // Reschedule responses
  if (
    fullText.includes("reschedule") &&
    (fullText.includes("confirmed") || fullText.includes("booked"))
  ) {
    return "RESCHEDULE_COMPLETED";
  }

  // Need more information
  if (
    fullText.includes("additional") ||
    fullText.includes("more information") ||
    fullText.includes("required document") ||
    fullText.includes("please provide")
  ) {
    return "ADDITIONAL_INFO_REQUESTED";
  }

  // Default: just mark as received
  return null;
}

/**
 * Update case from airline reply
 */
async function updateCaseFromReply(
  caseId: string,
  fromEmail: string,
  subject: string,
  body: string,
  statusUpdate: string | null
): Promise<boolean> {
  try {
    // Create reply record
    await prisma.emailReply.create({
      data: {
        emailCaseId: caseId,
        fromEmail,
        subject,
        body,
        replyDate: new Date(),
        statusUpdate,
      },
    });

    // Update case status if we know what it is
    let newStatus = "AWAITING_AIRLINE_RESPONSE";
    if (statusUpdate === "REFUND_APPROVED") {
      newStatus = "COMPLETED";
    } else if (statusUpdate === "VOID_COMPLETED") {
      newStatus = "COMPLETED";
    } else if (statusUpdate === "RESCHEDULE_COMPLETED") {
      newStatus = "COMPLETED";
    } else if (statusUpdate === "ADDITIONAL_INFO_REQUESTED") {
      newStatus = "ADDITIONAL_INFO_REQUESTED";
    } else if (statusUpdate?.includes("REJECTED")) {
      newStatus = "COMPLETED"; // Could also be a separate REJECTED status
    }

    await prisma.emailCase.update({
      where: { id: caseId },
      data: {
        status: newStatus as any,
        dateLastResponse: new Date(),
      },
    });

    // Log audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: caseId,
        action: "REPLY_RECEIVED",
        details: JSON.stringify({
          from: fromEmail,
          statusUpdate,
          hasAttachment: false, // TODO: Parse attachments
        }),
      },
    });

    return true;
  } catch (error) {
    console.error("Error updating case from reply:", error);
    return false;
  }
}

/**
 * Get case summary for WhatsApp notification
 */
export async function getCaseSummaryForNotification(
  caseId: string
): Promise<string | null> {
  try {
    const emailCase = await prisma.emailCase.findUnique({
      where: { id: caseId },
      include: {
        airline: true,
        replies: { orderBy: { replyDate: "desc" }, take: 1 },
      },
    });

    if (!emailCase || emailCase.replies.length === 0) {
      return null;
    }

    const latestReply = emailCase.replies[0];
    const statusText = latestReply.statusUpdate || "Response received";

    return `
📧 *${emailCase.airline.name}* has responded

🎫 *PNR:* ${emailCase.pnr}
👤 *Passenger:* ${emailCase.passengerNames.join(", ")}
📊 *Status:* ${statusText}

_Tap to view full response_
    `.trim();
  } catch (error) {
    console.error("Error getting case summary:", error);
    return null;
  }
}

/**
 * Check for overdue cases (no response for X days)
 */
export async function getOverdueCases(daysSinceRequest: number = 3) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSinceRequest);

    return await prisma.emailCase.findMany({
      where: {
        status: "AWAITING_AIRLINE_RESPONSE",
        dateSent: {
          lt: cutoffDate,
        },
      },
      include: {
        airline: true,
      },
      orderBy: { dateSent: "asc" },
    });
  } catch (error) {
    console.error("Error fetching overdue cases:", error);
    return [];
  }
}
