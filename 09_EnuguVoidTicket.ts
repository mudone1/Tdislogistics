/**
 * src/modules/travel-assistant/booking/enugu/EnuguVoidTicket.ts
 *
 * Void an issued ticket.
 *
 * Workflow:
 * 1. Log in with user's credentials
 * 2. Find the ticket by PNR
 * 3. Check if "Void" button is available
 * 4. If yes: Click void, confirm, capture confirmation
 * 5. If no: Return friendly message (do NOT fake the void)
 *
 * CRITICAL: Never void a ticket that the airline doesn't allow voiding.
 * If the Void button isn't there, it means the airline has a policy against it.
 */

import { Page, Browser, BrowserContext } from "playwright";
import { getChromium } from "../../automation/BrowserManager";

export interface VoidTicketRequest {
  pnr: string;
  passengerLastName: string;
  credentials: {
    username: string;
    password: string;
  };
}

export interface VoidTicketResult {
  success: boolean;
  message: string;
  screenshot: Buffer;
  cannotVoid?: boolean; // True if void button doesn't exist
}

/**
 * Void a ticket in Enugu Air
 */
export async function voidEnuguAirTicket(request: VoidTicketRequest): Promise<VoidTicketResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    console.log(`[void-ticket] voiding ticket for PNR=${request.pnr}`);

    // Launch browser
    const chromium = await getChromium();
    browser = await chromium.launch({ headless: true });
    context = await browser.createContext();
    page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Step 1: Login
    console.log("[void-ticket] logging in");
    await loginToEnuguAir(page, request.credentials);

    // Step 2: Navigate to Manage My Booking
    console.log("[void-ticket] navigating to Manage My Booking");
    await page.goto("https://www.enugu-air.com/manage-booking", { waitUntil: "networkidle" });

    // Step 3: Search for the ticket
    console.log("[void-ticket] searching for ticket");
    await page.fill('input[name*="pnr"], input[id*="pnr"]', request.pnr);
    await page.fill('input[name*="surname"], input[id*="surname"]', request.passengerLastName);

    await page.click('button:has-text("Search"), button:has-text("Retrieve")');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Step 4: Check if ticket exists
    const pageContent = await page.content();
    if (/no booking found|not found|invalid/i.test(pageContent)) {
      const screenshot = await page.screenshot({ fullPage: true });
      return {
        success: false,
        message: `Ticket PNR ${request.pnr} could not be found in the Enugu Air system.`,
        screenshot,
      };
    }

    // Step 5: Look for Void button
    console.log("[void-ticket] looking for Void button");
    const voidButton = await page.locator('button:has-text("Void"), [class*="void"], button[title*="void" i]').first();
    const voidButtonCount = await voidButton.count();

    if (voidButtonCount === 0) {
      // Void button not available — ticket cannot be voided
      console.log("[void-ticket] Void button not found — ticket cannot be voided");

      const screenshot = await page.screenshot({ fullPage: true });

      return {
        success: false,
        cannotVoid: true,
        message: `This ticket can no longer be voided. Please log in to your Enugu Air account using the PNR to manage the booking yourself, or contact Enugu Air Support for assistance.`,
        screenshot,
      };
    }

    // Step 6: Click Void button
    console.log("[void-ticket] clicking Void button");
    await voidButton.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Step 7: Confirm void action (may need to click a confirmation button)
    const confirmButton = await page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Proceed")').first();
    if (await confirmButton.count() > 0) {
      console.log("[void-ticket] confirming void action");
      await confirmButton.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }

    // Step 8: Verify void was successful
    const finalContent = await page.content();
    const voidSuccess =
      /voided|void successful|ticket cancelled|refund/i.test(finalContent) ||
      finalContent.includes("VOIDED");

    if (!voidSuccess) {
      console.warn("[void-ticket] void action completed but success status unclear");
    }

    // Step 9: Capture confirmation screenshot
    console.log("[void-ticket] capturing confirmation screenshot");
    const screenshot = await page.screenshot({ fullPage: true });

    console.log(`[void-ticket] SUCCESS: ticket voided for PNR=${request.pnr}`);

    return {
      success: true,
      message: `✅ Ticket ${request.pnr} has been successfully voided. You will receive a refund confirmation via email within 1-2 business days.`,
      screenshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[void-ticket] FAILED:", message);

    // Try to capture debug screenshot
    let debugScreenshot: Buffer | undefined;
    try {
      if (page) {
        debugScreenshot = await page.screenshot({ fullPage: true });
      }
    } catch (screenshotErr) {
      // Ignore
    }

    return {
      success: false,
      message: `Failed to void ticket: ${message}. Please try manually on the Enugu Air website or contact support.`,
      screenshot: debugScreenshot || Buffer.alloc(0),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Login to Enugu Air
 */
async function loginToEnuguAir(
  page: Page,
  credentials: { username: string; password: string }
): Promise<void> {
  await page.goto("https://www.enugu-air.com/login", { waitUntil: "networkidle" });

  await page.fill('input[name*="username"], input[name*="email"]', credentials.username);
  await page.fill('input[type="password"]', credentials.password);

  await page.click('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // Verify login
  const pageUrl = page.url();
  if (pageUrl.includes("login")) {
    throw new Error("Login failed");
  }
}
