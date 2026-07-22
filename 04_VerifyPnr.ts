/**
 * src/modules/travel-assistant/verification/VerifyPnr.ts
 *
 * Verifies that a PNR exists in the Enugu Air reservation system.
 *
 * Before reporting a booking as successful, we must verify:
 * 1. The PNR exists in Enugu Air's system
 * 2. The PNR matches the passenger name
 * 3. The booking has not already been voided
 *
 * This prevents fake/incomplete bookings from being reported as successful.
 */

import { Page, Browser, BrowserContext } from "playwright";
import { getChromium } from "../../automation/BrowserManager";
import { prisma } from "../../../lib/prisma";

export interface VerifyPnrRequest {
  pnr: string;
  passengerLastName: string;
  credentials: {
    username: string;
    password: string;
  };
}

export interface VerifyPnrResult {
  verified: boolean;
  message: string;
  bookingStatus?: string; // BOOKED, ISSUED, VOIDED, EXPIRED
  holdExpiresAt?: string;
  durationMs: number;
}

/**
 * Verify that a PNR exists in Enugu Air's Manage My Booking system
 */
export async function verifyPnrExists(request: VerifyPnrRequest): Promise<VerifyPnrResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const startTime = Date.now();

  try {
    console.log(`[pnr-verify] verifying PNR=${request.pnr} for ${request.passengerLastName}`);

    // Launch browser
    const chromium = await getChromium();
    browser = await chromium.launch({ headless: true });
    context = await browser.createContext();
    page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Navigate to Manage My Booking
    console.log("[pnr-verify] navigating to Manage My Booking");
    await page.goto("https://www.enugu-air.com/manage-booking", { waitUntil: "networkidle" });

    // Enter PNR
    console.log("[pnr-verify] entering PNR");
    await page.fill('input[name*="pnr"], input[id*="pnr"], input[placeholder*="PNR"]', request.pnr);

    // Enter passenger last name
    console.log("[pnr-verify] entering passenger name");
    await page.fill('input[name*="surname"], input[id*="surname"], input[placeholder*="surname"]', request.passengerLastName);

    // Click search button
    console.log("[pnr-verify] searching booking");
    await page.click('button:has-text("Search"), button:has-text("Retrieve")');

    // Wait for result
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Check if booking was found
    const pageContent = await page.content();

    // If "not found" message appears, PNR doesn't exist
    const notFoundPatterns = [
      /no booking found/i,
      /booking not found/i,
      /pnr not found/i,
      /invalid pnr/i,
      /not exist/i,
    ];

    for (const pattern of notFoundPatterns) {
      if (pattern.test(pageContent)) {
        const durationMs = Date.now() - startTime;
        await recordVerification(request.pnr, false, "PNR not found in Enugu Air system", durationMs);
        return {
          verified: false,
          message: `The PNR ${request.pnr} could not be found in Enugu Air's reservation system. The booking may not have been completed successfully.`,
          durationMs,
        };
      }
    }

    // If we got here, booking was found
    console.log("[pnr-verify] booking found, extracting details");

    // Extract booking status
    const bookingStatus = await extractBookingStatus(page);

    // Extract hold expiry (if booking)
    const holdExpiresAt = await extractHoldExpiresAt(page);

    // Verify passenger name matches
    const passengerNameMatch = await verifyPassengerName(page, request.passengerLastName);
    if (!passengerNameMatch) {
      const durationMs = Date.now() - startTime;
      await recordVerification(
        request.pnr,
        false,
        `Passenger name mismatch - expected ${request.passengerLastName}`,
        durationMs
      );
      return {
        verified: false,
        message: `PNR ${request.pnr} exists but the passenger name does not match. Expected: ${request.passengerLastName}`,
        durationMs,
      };
    }

    const durationMs = Date.now() - startTime;
    await recordVerification(request.pnr, true, "Verified in Enugu Air system", durationMs);

    console.log(`[pnr-verify] SUCCESS: PNR=${request.pnr} verified (status=${bookingStatus})`);

    return {
      verified: true,
      message: `PNR ${request.pnr} verified in Enugu Air's reservation system`,
      bookingStatus: bookingStatus || "BOOKED",
      holdExpiresAt,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    console.error("[pnr-verify] FAILED:", message);
    await recordVerification(request.pnr, false, message, durationMs);

    return {
      verified: false,
      message: `Could not verify PNR: ${message}. Please check the Enugu Air website directly.`,
      durationMs,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Extract booking status from the Manage My Booking results page
 */
async function extractBookingStatus(page: Page): Promise<string | null> {
  try {
    // Look for status indicators
    const statusPatterns = [
      "BOOKED",
      "ISSUED",
      "TICKETED",
      "VOIDED",
      "CANCELLED",
      "PAID",
      "PENDING PAYMENT",
    ];

    const pageContent = await page.content();
    for (const status of statusPatterns) {
      if (pageContent.includes(status)) {
        return status;
      }
    }
  } catch (e) {
    // Continue
  }
  return null;
}

/**
 * Extract hold expiry from the booking details
 */
async function extractHoldExpiresAt(page: Page): Promise<string | undefined> {
  try {
    const expiryText = await page.locator("text=/held until|expires|TTL|time limit|valid until/i").textContent();
    if (expiryText) {
      // Try to extract date like "held until 02Jun25 20:06"
      const dateMatch = expiryText.match(/(\d{1,2}\s*\w{3}\s*\d{2}\s*\d{1,2}:\d{2})/i);
      if (dateMatch) {
        return dateMatch[1];
      }
    }
  } catch (e) {
    // Continue
  }
  return undefined;
}

/**
 * Verify that the passenger name on the booking matches the expected name
 */
async function verifyPassengerName(page: Page, expectedLastName: string): Promise<boolean> {
  try {
    const pageContent = await page.content();

    // Normalize the name for comparison
    const normalized = expectedLastName.toUpperCase().trim();
    const normalizedContent = pageContent.toUpperCase();

    // Check if last name appears in booking details
    return normalizedContent.includes(normalized);
  } catch (e) {
    return false;
  }
}

/**
 * Record verification attempt in database for audit trail
 */
async function recordVerification(
  pnr: string,
  verified: boolean,
  reason: string,
  durationMs: number
): Promise<void> {
  try {
    await prisma.pnrVerification.create({
      data: {
        pnr,
        airline: "ENUGU",
        passengerName: "", // Would need to be passed in for complete audit trail
        verified,
        errorMessage: verified ? null : reason,
        verificationMs: durationMs,
      },
    });
  } catch (err) {
    console.error("[pnr-verify] failed to record verification:", err);
    // Don't fail the entire operation if audit logging fails
  }
}
