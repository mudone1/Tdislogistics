/**
 * Email API - Error Handling & Utilities
 */

import { NextResponse } from "next/server";
import { ErrorResponse } from "../types/email.types";

export class EmailAPIError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = "EmailAPIError";
  }
}

export const ERROR_CODES = {
  // Validation errors
  INVALID_REQUEST: "INVALID_REQUEST",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_CASE_ID: "INVALID_CASE_ID",
  INVALID_BASE64_IMAGE: "INVALID_BASE64_IMAGE",

  // Case state errors
  CASE_NOT_FOUND: "CASE_NOT_FOUND",
  INVALID_CASE_STATUS: "INVALID_CASE_STATUS",
  CASE_ALREADY_SENT: "CASE_ALREADY_SENT",
  CASE_ALREADY_CLOSED: "CASE_ALREADY_CLOSED",

  // Ticket parsing errors
  TICKET_PARSING_FAILED: "TICKET_PARSING_FAILED",
  AIRLINE_NOT_DETECTED: "AIRLINE_NOT_DETECTED",
  PNR_NOT_FOUND: "PNR_NOT_FOUND",
  PASSENGERS_NOT_FOUND: "PASSENGERS_NOT_FOUND",

  // Email sending errors
  EMAIL_SEND_FAILED: "EMAIL_SEND_FAILED",
  INVALID_RECIPIENTS: "INVALID_RECIPIENTS",
  SMTP_CONNECTION_FAILED: "SMTP_CONNECTION_FAILED",

  // Database errors
  DATABASE_ERROR: "DATABASE_ERROR",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",

  // WhatsApp errors
  WHATSAPP_NOTIFICATION_FAILED: "WHATSAPP_NOTIFICATION_FAILED",

  // Server errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
};

/**
 * Convert error to standardized response
 */
export function handleError(error: unknown): {
  status: number;
  response: ErrorResponse;
} {
  console.error("[Email API Error]", error);

  if (error instanceof EmailAPIError) {
    return {
      status: error.statusCode,
      response: {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      },
    };
  }

  if (error instanceof SyntaxError) {
    return {
      status: 400,
      response: {
        success: false,
        error: "Invalid JSON in request body",
        code: ERROR_CODES.INVALID_REQUEST,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      response: {
        success: false,
        error: error.message,
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      },
    };
  }

  return {
    status: 500,
    response: {
      success: false,
      error: "An unexpected error occurred",
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    },
  };
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, statusCode: number = 200) {
  return NextResponse.json(data, { status: statusCode });
}

/**
 * Create error response
 */
export function errorResponse(error: unknown) {
  const { status, response } = handleError(error);
  return NextResponse.json(response, { status });
}

/**
 * Validate required fields in request
 */
export function validateRequired(
  data: Record<string, any>,
  requiredFields: string[]
): string[] {
  const missing = requiredFields.filter((field) => !data[field]);
  return missing;
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T>(
  json: string,
  fallback?: T
): T | null {
  try {
    return JSON.parse(json);
  } catch {
    return fallback ?? null;
  }
}

/**
 * Validate base64 image data
 */
export function isValidBase64Image(data: string): boolean {
  // Check if it's base64 format
  if (!data.startsWith("data:image/")) {
    return false;
  }

  // Extract the base64 part
  const base64Part = data.split(",")[1];
  if (!base64Part) {
    return false;
  }

  // Validate base64
  return /^[A-Za-z0-9+/=]+$/.test(base64Part);
}

/**
 * Convert base64 data URL to buffer
 */
export function base64DataUrlToBuffer(dataUrl: string): Buffer {
  const base64Part = dataUrl.split(",")[1];
  if (!base64Part) {
    throw new EmailAPIError(
      ERROR_CODES.INVALID_BASE64_IMAGE,
      "Invalid base64 image data URL format",
      400
    );
  }

  try {
    return Buffer.from(base64Part, "base64");
  } catch {
    throw new EmailAPIError(
      ERROR_CODES.INVALID_BASE64_IMAGE,
      "Failed to decode base64 image data",
      400
    );
  }
}
