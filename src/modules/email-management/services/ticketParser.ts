/**
 * Ticket Parser Service
 * 
 * Extracts ticket information from screenshots using OCR (Tesseract.js + Vision API)
 * - Airline detection
 * - PNR extraction
 * - Passenger name(s) extraction
 * - Travel details (route, date, time)
 */

import { AIRLINE_EMAIL_CONFIG } from "../config/airlineEmailConfig";

export interface TicketExtractionResult {
  success: boolean;
  airline?: string;
  pnr?: string;
  passengerNames?: string[];
  route?: string;
  travelDate?: string;
  departureTime?: string;
  rawText?: string;
  confidence?: number;
  errors?: string[];
}

/**
 * Extract ticket information from image buffer
 * Uses Vision API (Google Cloud Vision or similar) to OCR the image
 */
export async function extractTicketFromImage(
  imageBuffer: Buffer,
  mimeType: string
): Promise<TicketExtractionResult> {
  try {
    // Step 1: OCR the image using Vision API (Google Cloud Vision)
    const rawText = await performOCR(imageBuffer, mimeType);

    if (!rawText) {
      return {
        success: false,
        errors: ["Failed to extract text from image"],
      };
    }

    // Step 2: Parse the extracted text
    return parseTicketText(rawText);
  } catch (error) {
    return {
      success: false,
      errors: [
        `Error extracting ticket: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
    };
  }
}

/**
 * Perform OCR on image using Vision API
 * This is a placeholder - in production, use Google Cloud Vision API or similar
 */
async function performOCR(
  imageBuffer: Buffer,
  mimeType: string
): Promise<string | null> {
  try {
    // TODO: Integrate with Google Cloud Vision API or AWS Textract
    // For now, this is a placeholder that would use:
    // - Google Cloud Vision API for production
    // - Tesseract.js for browser/Node.js alternative
    // - AWS Rekognition for AWS-based deployments

    // Example with Google Cloud Vision:
    // const vision = require("@google-cloud/vision");
    // const client = new vision.ImageAnnotatorClient();
    // const request = { image: { content: imageBuffer } };
    // const [result] = await client.textDetection(request);
    // const text = result.fullTextAnnotation?.text;

    // Placeholder: would return extracted text
    return null;
  } catch (error) {
    console.error("OCR Error:", error);
    return null;
  }
}

/**
 * Parse ticket text to extract structured data
 */
export function parseTicketText(text: string): TicketExtractionResult {
  const errors: string[] = [];
  const result: TicketExtractionResult = {
    success: false,
    errors,
    rawText: text,
    confidence: 0,
  };

  // Step 1: Detect airline from text content
  const airline = detectAirlineFromText(text);
  if (airline) {
    result.airline = airline;
  } else {
    errors.push("Could not detect airline from ticket");
  }

  // Step 2: Extract PNR (6 alphanumeric characters)
  const pnr = extractPNR(text);
  if (pnr) {
    result.pnr = pnr;
  } else {
    errors.push("Could not extract PNR from ticket");
  }

  // Step 3: Extract passenger name(s)
  const passengerNames = extractPassengerNames(text);
  if (passengerNames && passengerNames.length > 0) {
    result.passengerNames = passengerNames;
  } else {
    errors.push("Could not extract passenger names from ticket");
  }

  // Step 4: Extract travel details (optional)
  const travelDetails = extractTravelDetails(text);
  if (travelDetails.route) {
    result.route = travelDetails.route;
  }
  if (travelDetails.date) {
    result.travelDate = travelDetails.date;
  }
  if (travelDetails.time) {
    result.departureTime = travelDetails.time;
  }

  // Mark as success only if we have at least PNR and passenger name
  if (result.pnr && result.passengerNames && result.passengerNames.length > 0) {
    result.success = true;
    result.confidence = calculateConfidence(result, errors);
  }

  return result;
}

/**
 * Detect airline from ticket text
 */
function detectAirlineFromText(text: string): string | null {
  const upperText = text.toUpperCase();

  // Airline name patterns (from most specific to most general)
  const patterns: Record<string, string[]> = {
    AIRPEACE: ["AIR PEACE", "AIRPEACE", "FLYAIRPEACE"],
    ARIK: ["ARIK AIR", "ARIK", "ARIKAIR"],
    AERO: ["AERO", "AERO CONTRACTORS", "ACN.AERO"],
    IBOM: ["IBOM AIR", "IBOMAIR", "IBOM"],
    UNITED: ["UNITED NIGERIA", "UNITEDNIGERIA", "FLYUNITEDNIGERIA"],
    NGEAGLE: ["NG EAGLE", "NGEAGLE", "EAGLE"],
    VALUEJET: ["VALUE JET", "VALUEJET", "FLYVALUEJET"],
    RANO: ["RANO AIR", "RANOAIR"],
    ENUGU: ["ENUGU AIR", "ENUGUAIRLINES"],
    XEJET: ["XEJET", "XE JET"],
  };

  for (const [code, names] of Object.entries(patterns)) {
    for (const name of names) {
      if (upperText.includes(name)) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Extract PNR (6 alphanumeric characters)
 * Look for common PNR patterns: "PNR: ABCDEF" or just "ABCDEF" in context
 */
function extractPNR(text: string): string | null {
  // Pattern 1: "PNR: XXXXXX" or "PNR XXXXXX"
  const pnrPattern1 = /PNR\s*[:=]?\s*([A-Z0-9]{6})/i;
  const match1 = text.match(pnrPattern1);
  if (match1) {
    return match1[1].toUpperCase();
  }

  // Pattern 2: "Booking reference: XXXXXX"
  const pnrPattern2 = /booking\s+reference\s*[:=]?\s*([A-Z0-9]{6})/i;
  const match2 = text.match(pnrPattern2);
  if (match2) {
    return match2[1].toUpperCase();
  }

  // Pattern 3: "Confirmation Number: XXXXXX"
  const pnrPattern3 = /confirmation\s+number\s*[:=]?\s*([A-Z0-9]{6})/i;
  const match3 = text.match(pnrPattern3);
  if (match3) {
    return match3[1].toUpperCase();
  }

  // Pattern 4: Standalone 6-char alphanumeric (as last resort)
  const pnrPattern4 = /\b([A-Z0-9]{6})\b/;
  const match4 = text.match(pnrPattern4);
  if (match4) {
    return match4[1].toUpperCase();
  }

  return null;
}

/**
 * Extract passenger name(s) from ticket
 * Look for "Name:", "Passenger:", or similar patterns
 */
function extractPassengerNames(text: string): string[] {
  const names: string[] = [];

  // Pattern 1: "Name: John Doe" or "Name: JOHN/DOE"
  const namePattern1 = /name\s*[:=]?\s*([A-Za-z\s\-'\.]+?)(?=\n|$|birth|date|phone|email)/im;
  const matches1 = text.matchAll(namePattern1);
  for (const match of matches1) {
    const name = cleanName(match[1]);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  // Pattern 2: "Passenger: John Doe"
  const namePattern2 = /passenger\s*[:=]?\s*([A-Za-z\s\-'\.]+?)(?=\n|$|birth|date)/im;
  const matches2 = text.matchAll(namePattern2);
  for (const match of matches2) {
    const name = cleanName(match[1]);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  // Pattern 3: "LASTNAME/FIRSTNAME" format (airline format)
  const namePattern3 = /\b([A-Z][A-Z\-]*)\s*\/\s*([A-Z][A-Za-z\s]*)\b/;
  const matches3 = text.matchAll(namePattern3);
  for (const match of matches3) {
    const name = `${match[2]} ${match[1]}`.trim();
    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/**
 * Clean and format passenger name
 */
function cleanName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z]+|[^A-Za-z\s\-'\.]+$/g, "")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)
    .join(" ");
}

/**
 * Extract travel details (route, date, departure time)
 */
function extractTravelDetails(text: string): {
  route?: string;
  date?: string;
  time?: string;
} {
  const details: { route?: string; date?: string; time?: string } = {};

  // Extract route (e.g., "LOS-ABV" or "Lagos-Abuja")
  const routePattern = /(?:from|route|leg)\s*[:=]?\s*([A-Z]{3})\s*[-–]\s*([A-Z]{3})/i;
  const routeMatch = text.match(routePattern);
  if (routeMatch) {
    details.route = `${routeMatch[1].toUpperCase()}-${routeMatch[2].toUpperCase()}`;
  }

  // Extract date (various formats: DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY)
  const datePattern =
    /(?:date|departure|travel)\s*[:=]?\s*(\d{1,2}[\/\-\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|0?[1-9]|1[0-2])[\/\-\s]\d{4})/i;
  const dateMatch = text.match(datePattern);
  if (dateMatch) {
    details.date = normalizeDateFormat(dateMatch[1]);
  }

  // Extract time (HH:MM AM/PM or HH:MM)
  const timePattern = /(?:time|departure|depart)\s*[:=]?\s*(\d{1,2}):(\d{2})\s*(?:AM|PM|am|pm)?/i;
  const timeMatch = text.match(timePattern);
  if (timeMatch) {
    details.time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  return details;
}

/**
 * Normalize date format to DD/MM/YYYY
 */
function normalizeDateFormat(dateStr: string): string {
  // Try to parse various date formats and convert to DD/MM/YYYY
  dateStr = dateStr.trim();

  // Already in DD/MM/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  // DD-MM-YYYY or DD MM YYYY format
  const match1 = dateStr.match(/(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{4})/);
  if (match1) {
    return `${match1[1].padStart(2, "0")}/${match1[2].padStart(2, "0")}/${match1[3]}`;
  }

  return dateStr;
}

/**
 * Calculate confidence score (0-1)
 */
function calculateConfidence(
  result: TicketExtractionResult,
  errors: string[]
): number {
  let score = 1.0;

  // Deduct for each missing field
  if (!result.airline) score -= 0.2;
  if (!result.pnr) score -= 0.3;
  if (!result.passengerNames || result.passengerNames.length === 0) score -= 0.3;
  if (!result.route) score -= 0.05;
  if (!result.travelDate) score -= 0.05;
  if (!result.departureTime) score -= 0.05;

  // Deduct for errors
  score -= Math.min(0.2, errors.length * 0.05);

  return Math.max(0, Math.min(1, score));
}

/**
 * Validate extracted data
 */
export function validateExtraction(result: TicketExtractionResult): boolean {
  if (!result.success) return false;
  if (!result.pnr || result.pnr.length !== 6) return false;
  if (!result.passengerNames || result.passengerNames.length === 0)
    return false;
  return true;
}
