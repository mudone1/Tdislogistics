/**
 * Email Sending Service
 * 
 * Handles SMTP integration and actual email sending
 */

import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    email: string;
  };
}

// Initialize SMTP configuration from environment variables
function getSmtpConfig(): SmtpConfig {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASSWORD || "",
    },
    from: {
      name: process.env.SMTP_FROM_NAME || "TDIS Logistics",
      email: process.env.SMTP_FROM_EMAIL || "",
    },
  };
}

// Create transporter instance
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const config = getSmtpConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }
  return transporter;
}

export interface EmailSendRequest {
  caseId: string;
  toRecipient: string;
  ccRecipients: string[];
  subject: string;
  body: string;
  pnr: string;
  passengerNames: string[];
  airline: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  sentAt?: Date;
  error?: string;
}

/**
 * Send email and update case status
 */
export async function sendEmail(
  request: EmailSendRequest
): Promise<EmailSendResult> {
  try {
    // Validate email addresses
    if (!isValidEmail(request.toRecipient)) {
      return {
        success: false,
        error: `Invalid To email: ${request.toRecipient}`,
      };
    }

    for (const cc of request.ccRecipients) {
      if (!isValidEmail(cc)) {
        return {
          success: false,
          error: `Invalid CC email: ${cc}`,
        };
      }
    }

    // Get SMTP config
    const config = getSmtpConfig();

    // Create email message
    const mailOptions = {
      from: `${config.from.name} <${config.from.email}>`,
      to: request.toRecipient,
      cc: request.ccRecipients.length > 0 ? request.ccRecipients.join(", ") : undefined,
      subject: request.subject,
      text: request.body,
      html: formatEmailAsHtml(request.body),
      headers: {
        "X-Mailer": "TDIS Email Management System",
        "X-Case-ID": request.caseId,
        "X-PNR": request.pnr,
      },
    };

    // Send email
    const transporter = getTransporter();
    const info = await transporter.sendMail(mailOptions);

    // Update email case in database
    const sentAt = new Date();
    await prisma.emailCase.update({
      where: { id: request.caseId },
      data: {
        status: "SENT",
        dateSent: sentAt,
      },
    });

    // Log in audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: request.caseId,
        action: "EMAIL_SENT",
        details: JSON.stringify({
          messageId: info.messageId,
          sentAt: sentAt.toISOString(),
          to: request.toRecipient,
          cc: request.ccRecipients,
        }),
      },
    });

    return {
      success: true,
      messageId: info.messageId,
      sentAt,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log error in audit trail
    await prisma.emailAuditLog.create({
      data: {
        emailCaseId: request.caseId,
        action: "EMAIL_SEND_FAILED",
        details: JSON.stringify({
          error: errorMessage,
        }),
      },
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Format email body as HTML
 */
function formatEmailAsHtml(text: string): string {
  // Simple text-to-HTML conversion
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>\n");

  return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .email-content { max-width: 600px; padding: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #999; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="email-content">
          ${html}
          <div class="footer">
            <p>This is an automated email from TDIS Logistics Email Management System.</p>
            <p>Please do not reply to this email. Use the original communication channels.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Validate email address
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Test SMTP connection
 */
export async function testSmtpConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    return {
      success: true,
      message: "SMTP connection successful",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: `SMTP connection failed: ${errorMessage}`,
    };
  }
}

/**
 * Get SMTP configuration status
 */
export function getSmtpStatus(): {
  configured: boolean;
  details: string;
} {
  const config = getSmtpConfig();
  const configured =
    config.auth.user &&
    config.auth.pass &&
    config.from.email &&
    config.host;

  return {
    configured,
    details: configured
      ? `SMTP configured: ${config.auth.user} via ${config.host}:${config.port}`
      : "SMTP not configured - missing environment variables",
  };
}

/**
 * Send bulk emails to multiple airlines (for daily updates, etc.)
 */
export async function sendBulkEmails(
  requests: EmailSendRequest[]
): Promise<{ successful: string[]; failed: string[] }> {
  const successful: string[] = [];
  const failed: string[] = [];

  for (const request of requests) {
    const result = await sendEmail(request);
    if (result.success) {
      successful.push(request.caseId);
    } else {
      failed.push(request.caseId);
    }

    // Add delay between emails to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { successful, failed };
}
