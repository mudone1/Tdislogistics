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
// Public "Manage My Booking" lookup (Surname + Booking Reference, no agent
// login needed) — reached from enuguairlines.com's "Check In|Manage
// Booking" toggle, which embeds this exact page in an iframe. This is the
// independent ground truth for whether a PNR is real: confirmed via a real
// run that a fabricated/invalid reference returns the literal text
// "Booking not found!" here, while the in-flow agent-session page after
// submitting a hold can land on what LOOKS like a booking-management
// screen (same nav chrome: My Booking / Passenger Details / Change
// Flight / Book Extras / Log Out) without an actual booking having been
// created — that's exactly what happened once trusting that page alone.
const MMB_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/MmbLoginBS.aspx";
const BOOKING_NOT_FOUND_MARKER = /booking not found/i;

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
  // PNG of the confirmation page (PNR + passenger visible) — captured on the
  // final page so the chat/job record has visual proof of the hold. Null only
  // if the screenshot call itself fails (best-effort, never blocks the result).
  screenshot: Buffer | null;
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
    // The Return/One Way control is a Bootstrap .btn-check radio — its
    // <label> sits visually on top and intercepts pointer events, so a
    // plain click() fails Playwright's actionability check (confirmed via
    // a real run: "label ... intercepts pointer events"). Same fix already
    // proven for this exact control in VarsFlightSearch.ts's "One Way"
    // button: set checked + dispatch the events its handlers listen for.
    await page.locator(request.returnDate ? "#ReturnTrip1" : "#ReturnTrip2").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("click", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

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

    await page
      .locator('button, a, input[type="submit"], input[type="button"]')
      .filter({ hasText: /^continue$/i })
      .first()
      .click();
    await page.waitForURL(/FlightCal\.aspx/i, { timeout: 20000 }).catch(() => {
      /* some VARS deployments don't change the URL for this step — proceed and let the panel wait below fail loudly if it truly didn't navigate */
    });

    // --- Fare selection: cheapest of the two given classbands, per leg ---
    const legCount = request.returnDate ? 2 : 1;
    await page.locator(".tab-pane.active .flt-panel").first().waitFor({ state: "visible", timeout: 15000 });
    for (let leg = 0; leg < legCount; leg++) {
      await selectCheapestFare(page, leg, request.fareClassPreference);
    }

    await clickNext(page, "fare-selection");

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

    await clickNext(page, "products");

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
    await clickNext(page, "payment-details");

    // Wait for the confirmation summary page to appear
    await page
      .locator("text=/PNR|Booking Reference|TTL Payment Instructions|Manage My Booking/i")
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    // Click the final Confirm/Submit button to actually complete the booking —
    // not required: some flights land straight on Manage My Booking (PNR
    // already visible in the wait above) with no further step here.
    console.log("[enugu-booking] confirming booking submission");
    await clickNext(page, "confirmation-summary", { required: false });

    // Wait for the final success page
    await page
      .locator("text=/booking.*(?:confirmed|successful|completed)|thank you/i")
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(async () => {
        // If the final success page doesn't appear, still check if we have a PNR
        // Some deployments may not show a final success page, but the booking
        // should be confirmed if we got here without an error
        console.warn("[enugu-booking] no final success page detected, but continuing");
      });

    const raw = await page.locator("body").innerText();
    // Best-effort — a screenshot failure must never turn a real successful
    // hold into a failed job, so swallow and fall back to null.
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const result = parseConfirmation(raw, screenshot);

    // Independent verification, not just trusting the in-flow page — see
    // the MMB_URL comment above for exactly why that page alone isn't
    // trustworthy (confirmed via a real run: it can show booking-management
    // nav chrome with no actual booking behind it).
    console.log(`[enugu-booking] verifying PNR "${result.pnr}" via public Manage My Booking lookup`);
    const verified = result.pnr ? await verifyBookingReference(context, result.pnr, request.passenger.lastName) : false;
    if (!verified) {
      throw new Error(
        result.pnr
          ? `Booking submission could not be verified — Enugu Air's Manage My Booking lookup reports no booking found for reference "${result.pnr}" / surname "${request.passenger.lastName}". The hold likely did not complete.`
          : "Booking submission produced no recognizable booking reference — the hold likely did not complete."
      );
    }
    console.log(`[enugu-booking] PNR "${result.pnr}" verified`);
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Confirms a PNR is real via the public Manage My Booking lookup (Surname +
// Booking Reference, no agent login needed) rather than trusting whatever
// page the in-flow agent session happened to land on. Runs in a fresh page
// in the same browser context so it's closed along with everything else.
async function verifyBookingReference(
  context: import("playwright").BrowserContext,
  pnr: string,
  surname: string
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(MMB_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#txtSurname").fill(surname);
    await page.locator("#txtPNR").fill(pnr);
    await page.locator("#btnOk").click();
    // Same non-submit #btnOk / async-postback pattern as the agent login —
    // there's no confirmed "found" marker to wait on (only the negative
    // "Booking not found!" case is verified), so wait for the postback's
    // network activity to settle rather than a fixed sleep.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    return !BOOKING_NOT_FOUND_MARKER.test(bodyText);
  } catch (err) {
    // A verification-mechanism failure (network hiccup, page structure
    // change) must never silently report a fabricated success — only an
    // actual pass through the "not found" check counts as verified.
    console.error(`[enugu-booking] PNR verification threw, treating as unverified: ${err}`);
    return false;
  } finally {
    await page.close().catch(() => {});
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
      // A sold-out fare can still show a price (data-original-amount) but
      // has no clickable "Select this fare" element — same soldOut signal
      // VarsFlightSearch.ts's extractFlightOptions already uses. Confirmed
      // via a real run: picking a sold-out band by price alone hung
      // waiting for .flight-class-select-fare-text that doesn't exist.
      const soldOut = !!card?.querySelector(".seats-none") || /sold out/i.test(card?.textContent ?? "");
      return { band, amount: amount && !soldOut ? parseFloat(amount) : null };
    });
    const available = amounts.filter((a) => a.amount != null);
    if (available.length === 0) return null;
    available.sort((a, b) => (a.amount as number) - (b.amount as number));
    return available[0].band;
  }, fareClasses);

  if (!cheaperBand) {
    const diagnostic = await panel.evaluate((panelEl) =>
      Array.from(panelEl.querySelectorAll("[data-classband]")).map((card) => ({
        band: card.getAttribute("data-classband"),
        hasSelectText: !!card.querySelector(".flight-class-select-fare-text"),
        text: (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      }))
    );
    console.log(`DIAGNOSTIC [enugu-booking] leg ${legIndex} classbands: ${JSON.stringify(diagnostic)}`);
    throw new Error(`Neither of ${fareClasses.join(", ")} is available on leg ${legIndex}`);
  }

  // Confirmed via a real run: "Select this fare" is a custom toggle span
  // (sibling "Selected"/radio-icon spans swap visibility via a "hidden"
  // class) with a zero-size layout box of its own — same underlying
  // pattern as the Return/OneWay and payment-method controls elsewhere in
  // this flow. Playwright's real-mouse-click actionability check fails on
  // it, but the click handler is bound above the text node, so dispatching
  // the event directly via JS works reliably (same fix already proven for
  // those other two controls).
  const clicked = await panel.evaluate((panelEl, band) => {
    const card = panelEl.querySelector<HTMLElement>(`[data-classband="${band}"]`);
    const selectEl = card?.querySelector<HTMLElement>(".flight-class-select-fare-text");
    if (!selectEl) return false;
    selectEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, cheaperBand);

  if (!clicked) {
    throw new Error(`"${cheaperBand}" fare card found but its select element is missing on leg ${legIndex}`);
  }

  await panel
    .locator(`[data-classband="${cheaperBand}"] .flight-class-selected-text`)
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {
      /* best-effort confirmation — some deployments may not toggle this class */
    });
}

async function clickNext(page: import("playwright").Page, stage: string, opts?: { required?: boolean }): Promise<void> {
  const required = opts?.required ?? true;
  const next = page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^next$/i })
    .last();

  try {
    await next.click({ timeout: 15000 });
  } catch (err) {
    // Same custom-toggle-control pattern seen on the Return/OneWay,
    // payment-method, and fare-select controls in this flow — try a
    // JS-dispatched click before giving up, and log every button/link/input
    // candidate on the page so a genuine "no Next button here" case is
    // diagnosable instead of a bare timeout.
    const dispatched = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, a, input[type="submit"], input[type="button"]')
      );
      const match = candidates.find((el) => /^\s*next\s*$/i.test(el.textContent ?? (el as HTMLInputElement).value ?? ""));
      if (!match) return null;
      match.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    });

    if (!dispatched) {
      const candidates = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button, a, input[type="submit"], input[type="button"]'))
          .map((el) => (el.textContent ?? (el as HTMLInputElement).value ?? "").trim())
          .filter(Boolean)
          .slice(0, 30)
      );
      console.log(`DIAGNOSTIC [enugu-booking] stage="${stage}" no Next control found among: ${JSON.stringify(candidates)}`);
      // Confirmed via a real run: after "payment-details" submits the hold,
      // some flights land directly on the Manage My Booking page (PNR
      // already visible — see the caller's success-text wait right before
      // this call) with no further confirm step, while others show one
      // more "Next" here. Since we only reach "confirmation-summary" after
      // that PNR/Manage-Booking text already matched, treat a missing Next
      // there as "already done," not a failure — the booking is real either
      // way, and reporting it as failed here was actively wrong: it told
      // the user their booking didn't go through when it had.
      if (!required) {
        console.log(`[enugu-booking] no further Next at stage="${stage}" — booking already confirmed, continuing`);
        return;
      }
      throw err;
    }
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

function parseConfirmation(raw: string, screenshot: Buffer | null): BookOnHoldResult {
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
    screenshot,
  };
}
