/**
 * WhatsApp Integration Module
 * 
 * Handles communication with WhatsApp service:
 * - Send email drafts for approval
 * - Notify on airline responses
 * - Send daily reports
 * - Listen for email commands
 */

import axios from "axios";

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL || "http://localhost:4200";

/**
 * Send message via WhatsApp
 */
export async function sendWhatsAppMessage(
  chatId: string,
  message: string,
  options?: {
    isMarkdown?: boolean;
    buttons?: Array<{ id: string; title: string }>;
    replyMessageId?: string;
  }
): Promise<boolean> {
  try {
    const payload: any = {
      chatId,
      message,
    };

    if (options?.isMarkdown) {
      payload.parseMode = "Markdown";
    }

    if (options?.buttons) {
      payload.interactive = {
        type: "button",
        buttons: options.buttons.map((b) => ({
          id: b.id,
          title: b.title,
        })),
      };
    }

    if (options?.replyMessageId) {
      payload.quotedMessageId = options.replyMessageId;
    }

    const response = await axios.post(
      `${WHATSAPP_SERVICE_URL}/api/send-message`,
      payload,
      { timeout: 5000 }
    );

    return response.status === 200;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    return false;
  }
}

/**
 * Send email draft preview for approval
 */
export async function sendDraftPreview(
  chatId: string,
  caseId: string,
  draft: {
    subject: string;
    body: string;
    toRecipient: string;
    ccRecipients: string[];
    pnr: string;
    airline: string;
    passengers: string[];
  }
): Promise<boolean> {
  try {
    const messageText = `
✉️  *Email Draft Ready for Approval*

📋 *Case:* ${caseId}
🏢 *Airline:* ${draft.airline}
🎫 *PNR:* ${draft.pnr}
👥 *Passenger(s):* ${draft.passengers.join(", ")}

📊 *Email Details:*
*Subject:* ${draft.subject}

*To:* ${draft.toRecipient}
${draft.ccRecipients.length > 0 ? `*CC:* ${draft.ccRecipients.join(", ")}` : ""}

*Body:*
${draft.body}

---

What would you like to do?
    `.trim();

    return await sendWhatsAppMessage(chatId, messageText, {
      isMarkdown: true,
      buttons: [
        { id: "1", title: "✅ Send Email" },
        { id: "2", title: "✏️  Edit" },
        { id: "3", title: "💾 Save Draft" },
        { id: "4", title: "❌ Cancel" },
      ],
    });
  } catch (error) {
    console.error("Error sending draft preview:", error);
    return false;
  }
}

/**
 * Notify of airline response
 */
export async function notifyAirlineResponse(
  chatId: string,
  notification: {
    airline: string;
    pnr: string;
    passenger: string;
    status: string;
    summary: string;
  }
): Promise<boolean> {
  try {
    const messageText = `
📧 *Airline Response Received*

🏢 *Airline:* ${notification.airline}
🎫 *PNR:* ${notification.pnr}
👤 *Passenger:* ${notification.passenger}

📊 *Status:* ${notification.status}

📝 *Summary:*
${notification.summary}

_Tap to view full response details_
    `.trim();

    return await sendWhatsAppMessage(chatId, messageText, {
      isMarkdown: true,
      buttons: [{ id: "view", title: "📂 View Details" }],
    });
  } catch (error) {
    console.error("Error notifying airline response:", error);
    return false;
  }
}

/**
 * Send email sent confirmation
 */
export async function sendEmailConfirmation(
  chatId: string,
  confirmation: {
    caseNumber: string;
    pnr: string;
    airline: string;
    passengers: string[];
    recipients: { to: string; cc: string[] };
    sentAt: string;
  }
): Promise<boolean> {
  try {
    const messageText = `
✅ *Email Sent Successfully*

📋 *Case Number:* ${confirmation.caseNumber}
🏢 *Airline:* ${confirmation.airline}
🎫 *PNR:* ${confirmation.pnr}
👥 *Passenger(s):* ${confirmation.passengers.join(", ")}

📤 *Sent To:*
*To:* ${confirmation.recipients.to}
${
  confirmation.recipients.cc.length > 0
    ? `*CC:* ${confirmation.recipients.cc.join(", ")}`
    : ""
}

⏰ *Time:* ${confirmation.sentAt}

_Awaiting airline response..._
    `.trim();

    return await sendWhatsAppMessage(chatId, messageText, {
      isMarkdown: true,
    });
  } catch (error) {
    console.error("Error sending email confirmation:", error);
    return false;
  }
}

/**
 * Send daily summary report
 */
export async function sendDailyReport(
  chatId: string,
  report: {
    type: "SUMMARY" | "EOD";
    date: string;
    metrics: Record<string, number>;
    cases?: Array<{ pnr: string; airline: string; status: string }>;
  }
): Promise<boolean> {
  try {
    let messageText = `📊 *${report.type === "SUMMARY" ? "Daily Summary" : "End-of-Day"} Report*\n\n`;
    messageText += `📅 *Date:* ${report.date}\n\n`;

    Object.entries(report.metrics).forEach(([key, value]) => {
      messageText += `• ${key}: ${value}\n`;
    });

    if (report.cases && report.cases.length > 0) {
      messageText += `\n📋 *Open Cases:*\n`;
      report.cases.slice(0, 5).forEach((c) => {
        messageText += `• ${c.pnr} (${c.airline}) - ${c.status}\n`;
      });
    }

    return await sendWhatsAppMessage(chatId, messageText, {
      isMarkdown: true,
    });
  } catch (error) {
    console.error("Error sending daily report:", error);
    return false;
  }
}

/**
 * Send error notification
 */
export async function sendErrorNotification(
  chatId: string,
  error: {
    title: string;
    message: string;
    caseId?: string;
    pnr?: string;
  }
): Promise<boolean> {
  try {
    const messageText = `
❌ *Error Notification*

*${error.title}*
${error.message}

${error.caseId ? `Case ID: ${error.caseId}` : ""}
${error.pnr ? `PNR: ${error.pnr}` : ""}

_Please check the system and take appropriate action._
    `.trim();

    return await sendWhatsAppMessage(chatId, messageText, {
      isMarkdown: true,
    });
  } catch (error) {
    console.error("Error sending error notification:", error);
    return false;
  }
}

/**
 * Parse WhatsApp message for email commands
 */
export function parseEmailCommand(
  message: string
): {
  type:
    | "REFUND"
    | "VOID"
    | "RESCHEDULE"
    | "OPEN"
    | "STATUS_UPDATE"
    | "UNKNOWN";
  originalText: string;
} | null {
  const lowerMessage = message.toLowerCase().trim();

  // Status update commands
  if (lowerMessage === "email update now" || lowerMessage === "email update today") {
    return { type: "STATUS_UPDATE", originalText: message };
  }

  // Action commands
  if (
    lowerMessage === "refund" ||
    lowerMessage === "refund this ticket" ||
    lowerMessage.startsWith("refund")
  ) {
    return { type: "REFUND", originalText: message };
  }

  if (
    lowerMessage === "void" ||
    lowerMessage === "void this ticket" ||
    lowerMessage.startsWith("void")
  ) {
    return { type: "VOID", originalText: message };
  }

  if (
    lowerMessage === "open" ||
    lowerMessage === "open this ticket" ||
    lowerMessage.startsWith("open")
  ) {
    return { type: "OPEN", originalText: message };
  }

  if (
    lowerMessage === "reschedule" ||
    lowerMessage.startsWith("reschedule") ||
    lowerMessage.includes("reschedule to")
  ) {
    return { type: "RESCHEDULE", originalText: message };
  }

  return null;
}
