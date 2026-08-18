/**
 * POST /api/email/admin/init
 * Initialize email management system (database seeding)
 * Should be called on app startup
 * 
 * Response: { success, airlines, templates, recipients, errors }
 */

import { NextRequest } from "next/server";
import { initializeEmailManagementSystem, verifyEmailSystemSetup } from "@/modules/email-management/services/emailSystemInit";
import {
  errorResponse,
  successResponse,
} from "@/modules/email-management/api/errorHandler";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    console.log("[Email API] Initializing email management system");

    const result = await initializeEmailManagementSystem();

    if (!result.success) {
      return successResponse({
        success: false,
        error: "Failed to initialize email system",
        details: result.errors,
      }, 500);
    }

    console.log("[Email API] Email system initialized successfully");
    console.log(`  - Airlines: ${result.airlines}`);
    console.log(`  - Templates: ${result.templates}`);
    console.log(`  - Recipients: ${result.recipients}`);

    const response = {
      success: true,
      message: "Email management system initialized",
      airlines: result.airlines,
      templates: result.templates,
      recipients: result.recipients,
      errors: result.errors,
    };

    return successResponse(response, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET /api/email/admin/init
 * Verify email system setup
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    console.log("[Email API] Verifying email system setup");

    const verification = await verifyEmailSystemSetup();

    const response = {
      success: verification.ok,
      message: verification.ok 
        ? "Email system is properly configured"
        : "Email system configuration issues found",
      details: verification.details,
    };

    return successResponse(response, verification.ok ? 200 : 400);
  } catch (error) {
    return errorResponse(error);
  }
}
