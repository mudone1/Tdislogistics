/**
 * Email Management System - Database Initialization & Seeding
 * 
 * This script initializes the email management system by:
 * - Creating all airline configurations
 * - Creating all email templates
 * - Setting up email recipients
 */

import { prisma } from "@/lib/prisma";
import { AIRLINE_EMAIL_CONFIG } from "../config/airlineEmailConfig";
import { EMAIL_TEMPLATES } from "./config/emailTemplates";

export async function initializeEmailManagementSystem(): Promise<{
  success: boolean;
  airlines: number;
  templates: number;
  recipients: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let airlines = 0;
  let templates = 0;
  let recipients = 0;

  try {
    console.log("🚀 Initializing Email Management System...");

    // Step 1: Create/update airlines
    console.log("\n📍 Setting up airlines...");
    for (const [code, config] of Object.entries(AIRLINE_EMAIL_CONFIG)) {
      try {
        const airline = await prisma.emailAirline.upsert({
          where: { code },
          update: {
            name: config.name,
            isActive: config.isActive,
          },
          create: {
            code,
            name: config.name,
            isActive: config.isActive,
          },
        });

        airlines++;
        console.log(`  ✅ ${config.name} (${code})`);

        // Step 2: Create recipients for this airline
        for (let i = 0; i < config.recipients.length; i++) {
          const recipient = config.recipients[i];
          const isPrimary = i === 0; // First recipient is primary

          try {
            await prisma.emailRecipient.upsert({
              where: {
                airlineId_email: {
                  airlineId: airline.id,
                  email: recipient.email,
                },
              },
              update: {
                recipientType: isPrimary ? "TO" : "CC",
                isPrimary,
                isActive: true,
              },
              create: {
                airlineId: airline.id,
                email: recipient.email,
                recipientType: isPrimary ? "TO" : "CC",
                isPrimary,
                isActive: true,
              },
            });

            recipients++;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            errors.push(`Failed to create recipient ${recipient.email}: ${errorMsg}`);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Failed to create airline ${code}: ${errorMsg}`);
      }
    }

    // Step 3: Create email templates
    console.log("\n📧 Setting up email templates...");
    for (const [templateId, template] of Object.entries(EMAIL_TEMPLATES)) {
      try {
        await prisma.emailTemplate.upsert({
          where: { name: template.name },
          update: {
            subject: template.subject,
            bodyTemplate: template.bodyTemplate,
            isActive: template.isActive,
          },
          create: {
            name: template.name,
            requestType: template.requestType as any,
            subject: template.subject,
            bodyTemplate: template.bodyTemplate,
            isActive: template.isActive,
          },
        });

        templates++;
        console.log(`  ✅ ${template.name} (${template.requestType})`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Failed to create template ${templateId}: ${errorMsg}`);
      }
    }

    console.log(`\n✨ Initialization Complete!`);
    console.log(`   • Airlines: ${airlines}`);
    console.log(`   • Templates: ${templates}`);
    console.log(`   • Recipients: ${recipients}`);

    if (errors.length > 0) {
      console.log(`\n⚠️  ${errors.length} errors encountered:`);
      errors.forEach((e) => console.log(`   • ${e}`));
    }

    return { success: errors.length === 0, airlines, templates, recipients, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`\n❌ Initialization failed: ${errorMsg}`);
    return {
      success: false,
      airlines,
      templates,
      recipients,
      errors: [errorMsg],
    };
  }
}

/**
 * Verify system is properly initialized
 */
export async function verifyEmailSystemSetup(): Promise<{
  ok: boolean;
  details: Record<string, any>;
}> {
  try {
    const airlineCount = await prisma.emailAirline.count({
      where: { isActive: true },
    });

    const templateCount = await prisma.emailTemplate.count({
      where: { isActive: true },
    });

    const recipientCount = await prisma.emailRecipient.count({
      where: { isActive: true },
    });

    const caseCount = await prisma.emailCase.count();

    return {
      ok: airlineCount > 0 && templateCount > 0 && recipientCount > 0,
      details: {
        activeAirlines: airlineCount,
        activeTemplates: templateCount,
        activeRecipients: recipientCount,
        totalCases: caseCount,
        expectedAirlines: Object.keys(AIRLINE_EMAIL_CONFIG).length,
        expectedTemplates: Object.keys(EMAIL_TEMPLATES).length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      details: { error: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}

/**
 * Reset and reinitialize system (WARNING: Dangerous!)
 * Only use in development/testing
 */
export async function resetEmailSystem(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Cannot reset email system in production");
  }

  try {
    console.log("⚠️  Resetting email management system...");

    // Delete in reverse dependency order
    await prisma.emailAuditLog.deleteMany({});
    await prisma.emailReply.deleteMany({});
    await prisma.emailCase.deleteMany({});
    await prisma.emailDailyReport.deleteMany({});
    await prisma.emailRecipient.deleteMany({});
    await prisma.emailTemplate.deleteMany({});
    await prisma.emailAirline.deleteMany({});

    console.log("✅ Email system reset successfully");

    // Reinitialize
    const result = await initializeEmailManagementSystem();
    return result.success;
  } catch (error) {
    console.error("❌ Failed to reset email system:", error);
    return false;
  }
}
