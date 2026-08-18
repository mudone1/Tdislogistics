/**
 * Email Management System - App Initialization
 * 
 * Call this function during app startup to initialize the email system
 * Example usage in src/app/layout.tsx or src/lib/server/init.ts:
 * 
 * import { initializeEmailSystem } from '@/modules/email-management/app-init';
 * 
 * // In your server component or startup code:
 * await initializeEmailSystem();
 */

import { initializeEmailManagementSystem, verifyEmailSystemSetup } from "@/modules/email-management/services/emailSystemInit";
import { initializeScheduledTasks } from "@/modules/email-management/services/scheduledTasks";

/**
 * Initialize the entire email management system
 * Should be called once on application startup
 */
export async function initializeEmailSystem(): Promise<{
  success: boolean;
  message: string;
  details?: Record<string, any>;
}> {
  try {
    console.log("[Email System Init] Starting email management system initialization...");

    // Step 1: Verify database connectivity
    console.log("[Email System Init] Verifying database...");
    const dbVerification = await verifyEmailSystemSetup();
    
    if (!dbVerification.ok) {
      console.log("[Email System Init] Database verification details:", dbVerification.details);
    }

    // Step 2: Initialize database with airlines, templates, and recipients
    console.log("[Email System Init] Initializing database with airlines and templates...");
    const initResult = await initializeEmailManagementSystem();

    if (!initResult.success) {
      console.error("[Email System Init] Initialization failed:", initResult.errors);
      return {
        success: false,
        message: "Failed to initialize email system",
        details: {
          errors: initResult.errors,
        },
      };
    }

    console.log(
      `[Email System Init] Database initialized successfully - Airlines: ${initResult.airlines}, Templates: ${initResult.templates}, Recipients: ${initResult.recipients}`
    );

    // Step 3: Initialize scheduled tasks (if enabled)
    if (process.env.ENABLE_EMAIL_MONITORING === "true" || process.env.NODE_ENV === "production") {
      console.log("[Email System Init] Initializing scheduled tasks...");
      try {
        initializeScheduledTasks();
        console.log("[Email System Init] Scheduled tasks initialized");
      } catch (taskError) {
        console.error("[Email System Init] Failed to initialize scheduled tasks:", taskError);
        // Don't fail overall if tasks initialization fails
      }
    } else {
      console.log("[Email System Init] Scheduled tasks disabled (ENABLE_EMAIL_MONITORING != 'true')");
    }

    // Step 4: Final verification
    console.log("[Email System Init] Running final verification...");
    const finalVerification = await verifyEmailSystemSetup();

    if (!finalVerification.ok) {
      console.warn("[Email System Init] Verification issues found:", finalVerification.details);
    }

    console.log("[Email System Init] Email management system initialized successfully ✓");

    return {
      success: true,
      message: "Email management system initialized successfully",
      details: {
        airlines: initResult.airlines,
        templates: initResult.templates,
        recipients: initResult.recipients,
        tasksEnabled: process.env.ENABLE_EMAIL_MONITORING === "true",
      },
    };
  } catch (error) {
    console.error("[Email System Init] Critical initialization error:", error);
    return {
      success: false,
      message: "Critical error during email system initialization",
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Initialize scheduled tasks only
 * Can be called separately if app startup is handled differently
 */
export async function initializeEmailTasks(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log("[Email Tasks Init] Starting scheduled tasks...");
    initializeScheduledTasks();
    console.log("[Email Tasks Init] Scheduled tasks initialized successfully ✓");
    return {
      success: true,
      message: "Scheduled tasks initialized",
    };
  } catch (error) {
    console.error("[Email Tasks Init] Failed to initialize tasks:", error);
    return {
      success: false,
      message: "Failed to initialize scheduled tasks",
    };
  }
}

/**
 * Check if email system is ready
 * Returns status and any configuration issues
 */
export async function checkEmailSystemStatus(): Promise<{
  ready: boolean;
  status: string;
  checks: Record<string, boolean>;
  issues?: string[];
}> {
  try {
    const verification = await verifyEmailSystemSetup();

    const checks = {
      database: verification.ok,
      smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
      whatsapp_configured: Boolean(process.env.WHATSAPP_SERVICE_URL),
      admin_chat_configured: Boolean(process.env.ADMIN_WHATSAPP_CHAT_ID),
    };

    const issues: string[] = [];
    if (!checks.database) issues.push("Database not properly configured");
    if (!checks.smtp_configured) issues.push("SMTP credentials missing");
    if (!checks.whatsapp_configured) issues.push("WhatsApp service URL not configured");
    if (!checks.admin_chat_configured) issues.push("Admin WhatsApp chat ID not configured");

    return {
      ready: Object.values(checks).every((c) => c),
      status: Object.values(checks).every((c) => c) ? "ready" : "not ready",
      checks,
      issues: issues.length > 0 ? issues : undefined,
    };
  } catch (error) {
    return {
      ready: false,
      status: "error",
      checks: {},
      issues: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}
