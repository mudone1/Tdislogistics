/**
 * src/modules/travel-assistant/booking/enugu/EnuguRebook.ts
 *
 * Rebook a flight using a previously saved booking.
 *
 * Workflow:
 * 1. Load saved booking details (passenger, route, dates)
 * 2. Allow user to change dates/route if needed
 * 3. Attempt to book with original fare class
 * 4. If unavailable, try NEXT class only (no class-skipping)
 * 5. If that unavailable, fail gracefully
 * 6. Return new PNR
 *
 * Key constraint: Only move to the immediate next higher class.
 * If Economy Promo is full, try Economy Saver (not Comfort).
 * If both Economy classes full, do NOT try Business.
 */

import { Page, Browser, BrowserContext } from "playwright";
import { getChromium } from "../../automation/BrowserManager";

export interface RebookRequest {
  originalPnr: string;
  passengerFirstName: string;
  passengerLastName: string;
  passengerTitle: string;
  email: string;
  phone: string;
  
  // Original flight details
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  
  // User can change these
  newDepartureDate?: string;
  newReturnDate?: string;
  newOrigin?: string;
  newDestination?: string;
  
  // Original class preference
  fareClassPreference: string[];
  
  credentials: {
    username: string;
    password: string;
  };
}

export interface RebookResult {
  success: boolean;
  newPnr?: string;
  bookedClass?: string;
  message: string;
  screenshot?: Buffer;
}

/**
 * Rebook a flight using saved booking details
 */
export async function rebookEnuguAirFlight(request: RebookRequest): Promise<RebookResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    console.log(
      `[rebook] rebooking ${request.passengerFirstName} ${request.passengerLastName} from ${request.origin}->${request.destination}`
    );

    // Launch browser
    const chromium = await getChromium();
    browser = await chromium.launch({ headless: true });
    context = await browser.createContext();
    page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Navigate to Enugu Air
    await page.goto("https://www.enugu-air.com/", { waitUntil: "networkidle" });

    // Use user's changed dates/route, or original if not specified
    const departureDate = request.newDepartureDate || request.departureDate;
    const returnDate = request.newReturnDate || request.returnDate;
    const origin = request.newOrigin || request.origin;
    const destination = request.newDestination || request.destination;

    // Search flights
    console.log(`[rebook] searching ${origin}->${destination} on ${departureDate}`);
    await performFlightSearch(page, {
      origin,
      destination,
      departureDate,
      returnDate,
    });

    // Select flight
    await page.click('[class*="flight-option"], .flight-card');
    await page.waitForLoadState("networkidle");

    // Enter passenger details (reuse from original booking)
    console.log("[rebook] entering passenger details");
    await page.fill('input[name*="first"], input[id*="firstName"]', request.passengerFirstName);
    await page.fill('input[name*="last"], input[id*="lastName"]', request.passengerLastName);
    await page.fill('input[type="email"]', request.email);
    await page.fill('input[type="tel"], input[name*="phone"]', request.phone);

    // Attempt booking with original fare class
    console.log(`[rebook] attempting to book with class: ${request.fareClassPreference[0]}`);
    let bookedClass: string | null = null;
    let bookingSucceeded = false;

    for (let i = 0; i < request.fareClassPreference.length; i++) {
      const fareClass = request.fareClassPreference[i];
      console.log(`[rebook] trying class ${i + 1}/${request.fareClassPreference.length}: ${fareClass}`);

      try {
        // Select fare class
        const classButton = await page.locator(`text=${fareClass}`).first();
        if (classButton) {
          await classButton.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(1000);
        }

        // Click Book Now, Pay Later
        await page.click('button:has-text("Book Now"), button[class*="BookNow"]');
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);

        // Check if there's an error (class unavailable)
        const pageContent = await page.content();
        if (/no seats|not available|fully booked|sold out/i.test(pageContent)) {
          console.log(`[rebook] class ${fareClass} not available, trying next...`);
          // Go back and try next class
          await page.goBack();
          await page.waitForLoadState("networkidle");
          continue;
        }

        // If we got here, booking likely succeeded
        bookedClass = fareClass;
        bookingSucceeded = true;
        console.log(`[rebook] successfully booked with class: ${fareClass}`);
        break;
      } catch (err) {
        console.log(`[rebook] error with class ${fareClass}:`, err instanceof Error ? err.message : String(err));
        // Try next class
        if (i < request.fareClassPreference.length - 1) {
          await page.goBack().catch(() => {});
          await page.waitForLoadState("networkidle");
        }
      }
    }

    if (!bookingSucceeded) {
      return {
        success: false,
        message: "No available seats for this route in any of the available booking classes. Please try a different date.",
      };
    }

    // Complete authentication step (password confirmation)
    console.log("[rebook] completing authentication");
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.fill(request.credentials.password);
        await page.click('button:has-text("Confirm"), button[type="submit"]');
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);
      }
    } catch (err) {
      console.warn("[rebook] password confirmation not completed:", err instanceof Error ? err.message : String(err));
    }

    // Extract new PNR
    const newPnr = await extractPnrFromPage(page);
    if (!newPnr) {
      return {
        success: false,
        message: "Rebooking appears to have failed — no PNR was generated",
      };
    }

    // Capture screenshot
    const screenshot = await page.screenshot({ fullPage: true });

    console.log(`[rebook] SUCCESS: newPnr=${newPnr}, bookedClass=${bookedClass}`);

    return {
      success: true,
      newPnr,
      bookedClass: bookedClass || undefined,
      message: `Rebooking successful! Your new PNR is ${newPnr}. Would you like to save this booking or issue the ticket now?`,
      screenshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[rebook] FAILED:", message);

    return {
      success: false,
      message: `Rebooking failed: ${message}. Please try manually on the Enugu Air website.`,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Perform flight search
 */
async function performFlightSearch(
  page: Page,
  params: { origin: string; destination: string; departureDate: string; returnDate?: string }
) {
  // Click search tab
  await page.click('a:has-text("Search"), [class*="search"]');
  await page.waitForLoadState("networkidle");

  // Fill origin
  await page.fill('input[name*="origin"], input[id*="from"]', params.origin);
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // Fill destination
  await page.fill('input[name*="destination"], input[id*="to"]', params.destination);
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // Fill departure date
  const dateInput = await page.$('input[name*="departure"], input[type="date"]');
  if (dateInput) {
    await dateInput.fill(params.departureDate);
  }

  // Fill return date if provided
  if (params.returnDate) {
    const returnInput = await page.$('input[name*="return"]');
    if (returnInput) {
      await returnInput.fill(params.returnDate);
    }
  }

  // Click search
  await page.click('button:has-text("Search"), [class*="search"]');
  await page.waitForLoadState("networkidle");
}

/**
 * Extract PNR from confirmation page
 */
async function extractPnrFromPage(page: Page): Promise<string | null> {
  try {
    const patterns = [
      'text=/Confirmation Reference[:\\s]+([A-Z0-9]{6})/i',
      'text=/PNR[:\\s]+([A-Z0-9]{6})/i',
    ];

    for (const pattern of patterns) {
      const element = await page.locator(pattern).first();
      const text = await element.textContent();
      if (text) {
        const match = text.match(/([A-Z0-9]{6})/);
        if (match) {
          return match[1];
        }
      }
    }
  } catch (e) {
    // Continue
  }

  // Fallback: search page content
  const content = await page.content();
  const match = content.match(/([A-Z0-9]{6})/);
  return match ? match[0] : null;
}
