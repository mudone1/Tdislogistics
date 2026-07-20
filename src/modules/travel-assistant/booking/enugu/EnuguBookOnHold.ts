import { chromium } from "playwright";

// Same VARS/Videcom agent portal as EnuguConnector.ts (wallet-balance
// sync) — reuses its exact login mechanism (Sine code + password, a
// non-submit #btnOk that drives an async postback). Logging in first,
// then reusing the same public CustomerPanels search flow, ties the
// resulting PNR to the agency account so it shows up in "Manage My
// Booking" under that agent — the whole reason to log in rather than
// book as an anonymous guest.
const LOGIN_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx";
const REQUIREMENTS_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/requirementsBS.aspx";
const LOGGED_IN_MARKER = "text=/Logged in as:/i";

export interface BookOnHoldCredentials {
  username: string;
  password: string;
}

export interface BookOnHoldPassenger {
  title: string; // "Mr" | "Mrs" | "Ms" | "Dr" | "Miss" | "Mstr" | "Prof" | "Rev"
  firstName: string;
  lastName: string;
  mobileNumber: string; // local format, no leading 0 or country code — the +234 prefix is fixed on the form
  email: string;
}

export interface BookOnHoldRequest {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD — omit for one-way
  // Compares these fare classes (by their internal data-classband value,
  // e.g. "Economy Promo" / "Economy Saver") on each leg and picks
  // whichever is cheaper. Verified these two exist per leg; other bands
  // (Premium, Business, ...) are intentionally not considered here.
  fareClassPreference: [string, string];
  passenger: BookOnHoldPassenger;
}

export interface BookOnHoldResult {
  pnr: string | null;
  holdExpiresAt: string | null;
  totalPayable: number | null;
  currency: string | null;
  raw: string;
}

export async function bookEnuguAirOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest
): Promise<BookOnHoldResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    const page = await context.newPage();

    // --- Login (identical mechanism to EnuguConnector.login()) ---
    console.log("[enugu-booking] logging in");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#txtSineCode").fill(credentials.username);
    await page.locator("#txtPassword").fill(credentials.password);
    await page.locator("#btnOk").click();
    await page.locator(LOGGED_IN_MARKER).waitFor({ state: "visible", timeout: 20000 });

    // --- Search (same public CustomerPanels flow, now under the agent session) ---
    console.log(`[enugu-booking] searching ${request.origin}->${request.destination}`);
    await page.goto(REQUIREMENTS_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#Origin").selectOption(request.origin);
    await page.locator("#Destination").selectOption(request.destination);
    await page.locator(request.returnDate ? "#ReturnTrip1" : "#ReturnTrip2").click();

    await page.evaluate(
      ({ dep, ret }) => {
        const w = window as unknown as { $: (sel: string) => { datepicker: (op: string, d: Date) => void } };
        w.$("#departuredate").datepicker("setDate", new Date(dep.y, dep.m, dep.d));
        if (ret) w.$("#returndate").datepicker("setDate", new Date(ret.y, ret.m, ret.d));
      },
      {
        dep: dateParts(request.departureDate),
        ret: request.returnDate ? dateParts(request.returnDate) : null,
      }
    );

    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/FlightCal\.aspx/i, { timeout: 20000 }).catch(() => {
      /* some VARS deployments don't change the URL for this step — proceed and let the panel wait below fail loudly if it truly didn't navigate */
    });

    // --- Fare selection: cheapest of the two given classbands, per leg ---
    const legCount = request.returnDate ? 2 : 1;
    await page.locator(".tab-pane.active .flt-panel").first().waitFor({ state: "visible", timeout: 15000 });
    for (let leg = 0; leg < legCount; leg++) {
      await selectCheapestFare(page, leg, request.fareClassPreference);
    }

    await clickNext(page);

    // --- Products page: remove any auto-added add-ons (e.g. Travel Insurance) ---
    await page.locator(".RemoveProductButton2").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {
      /* nothing auto-added — fine */
    });
    const removeButtons = page.locator(".RemoveProductButton2");
    const removeCount = await removeButtons.count();
    for (let i = 0; i < removeCount; i++) {
      // Always click index 0 — each removal re-renders the list and shifts indices.
      await removeButtons.first().click();
      await page.waitForTimeout(300);
    }

    await clickNext(page);

    // --- Passenger details ---
    console.log("[enugu-booking] filling passenger details");
    await page.locator("#passenger1firstname").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#passenger1title").selectOption({ label: request.passenger.title });
    await page.locator("#passenger1firstname").fill(request.passenger.firstName);
    await page.locator("#passenger1lastname").fill(request.passenger.lastName);
    await page.locator("#passenger1mobilephonenumber").fill(request.passenger.mobileNumber.replace(/^0+/, ""));
    await page.locator("#passenger1emailaddress").fill(request.passenger.email);
    await page.locator("#passenger1emailaddressverification").fill(request.passenger.email);
    await page.locator("#passenger1specialservicerequest0").click();

    // The "Book Now, Pay Later" radio shares its id/name with every other
    // payment option (a VARS repeater control quirk) — a plain .click()
    // was confirmed NOT to stick during manual verification, so set
    // checked + dispatch change directly instead.
    await page.evaluate(() => {
      const radios = document.querySelectorAll<HTMLInputElement>('input[name="optpaymentformofpayment"]');
      const hold = Array.from(radios).find((r) => r.value === "BuyNowPayLater");
      if (!hold) throw new Error('"Book Now, Pay Later" option not found on payment page');
      hold.checked = true;
      hold.dispatchEvent(new Event("click", { bubbles: true }));
      hold.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await page.evaluate(() => {
      const tnc = document.getElementById("chkAgreeTermsAndConditions") as HTMLInputElement | null;
      if (tnc && !tnc.checked) tnc.click();
    });

    // --- Submit the hold ---
    console.log("[enugu-booking] submitting hold");
    await clickNext(page);
    await page
      .locator("text=/PNR|Booking Reference|TTL Payment Instructions|Manage My Booking/i")
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    const raw = await page.locator("body").innerText();
    return parseConfirmation(raw);
  } finally {
    await browser.close().catch(() => {});
  }
}

function dateParts(dateISO: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateISO.split("-").map(Number);
  return { y, m: m - 1, d };
}

async function selectCheapestFare(
  page: import("playwright").Page,
  legIndex: number,
  fareClasses: [string, string]
): Promise<void> {
  const panel = page.locator(".tab-pane.active .flt-panel").nth(legIndex);
  const cheaperBand = await panel.evaluate((panelEl, classes) => {
    const amounts = classes.map((band) => {
      const card = panelEl.querySelector<HTMLElement>(`[data-classband="${band}"]`);
      const priceEl = card?.querySelector<HTMLElement>("[data-original-amount]");
      const amount = priceEl?.getAttribute("data-original-amount");
      return { band, amount: amount ? parseFloat(amount) : null };
    });
    const available = amounts.filter((a) => a.amount != null);
    if (available.length === 0) return null;
    available.sort((a, b) => (a.amount as number) - (b.amount as number));
    return available[0].band;
  }, fareClasses);

  if (!cheaperBand) {
    throw new Error(`Neither of ${fareClasses.join(", ")} is available on leg ${legIndex}`);
  }

  await panel.locator(`[data-classband="${cheaperBand}"] .flight-class-select-fare-text`).click();
}

async function clickNext(page: import("playwright").Page): Promise<void> {
  const next = page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^next$/i })
    .last();
  await next.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

function parseConfirmation(raw: string): BookOnHoldResult {
  // VARS confirmation pages show the PNR as a short, standalone
  // alphanumeric code near "Manage My Booking" — same pattern documented
  // in the XEJET SOP screenshots for this shared platform (e.g.
  // "AAPR6Z"). Best-effort regex; `raw` is always returned in full so a
  // failed match is still diagnosable rather than a silent black box.
  const pnrMatch = raw.match(/\b([A-Z0-9]{5,8})\b(?=\s*(?:\n|$|\s{2,}))/);
  const holdMatch = raw.match(/held until\s+([0-9A-Za-z: ]+?)(?:\s*\(|\.|$)/i);
  const totalMatch = raw.match(/Total Payable:?\s*([\d,]+)\s*([A-Z]{3})/i);

  return {
    pnr: pnrMatch ? pnrMatch[1] : null,
    holdExpiresAt: holdMatch ? holdMatch[1].trim() : null,
    totalPayable: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : null,
    currency: totalMatch ? totalMatch[2].toUpperCase() : null,
    raw,
  };
}
