import { chromium } from "playwright";
import type {
  BookOnHoldCredentials,
  BookOnHoldRequest,
  BookOnHoldResult,
  BookingStageName,
  OnBookingStage,
} from "../vars-platform/VarsBookOnHold";

export type { BookOnHoldCredentials, BookOnHoldRequest, BookOnHoldResult, OnBookingStage };

// ValueJet's agent reservation system runs on the KIU platform
// (kiu.click) — a completely different engine from the VARS/Videcom
// carriers (Enugu/United/Rano/XeJet), with its own 4-stage wizard
// (Flights -> Passengers -> Extra Services -> Confirmation), its own
// letter-coded fare classes with a price-priority ordering rather than
// named classbands, and its own passenger/contact form layout. Nothing is
// shared with VarsBookOnHold.ts beyond the request/result TYPES (kept
// identical so connector-service's generic BOOK_ON_HOLD_HANDLERS/
// executeBookingAutomation machinery doesn't need any per-airline
// special-casing beyond registering this handler).
//
// Built from a written spec (kiu-booking-spec.md, itself derived from
// mobile-app screenshots), not a live DOM inspection — unlike every other
// booking module in this codebase, which was hardened against a real
// portal through several live-test iterations. Selectors here are
// deliberately GENERIC (by visible text/label/role, not guessed CSS ids),
// per the spec's own explicit guidance ("target elements by label/
// function, not fixed coordinates/position"). Expect this to need the
// same fix-from-real-diagnostic cycle every other module in this codebase
// went through — every major step below dumps page state into its thrown
// error on failure for exactly that reason.
//
// Explicitly, per spec: STOPS AFTER "Save reservation" — no PNR, no TTL,
// no ticketing. The result's pnr is always null; callers must not treat a
// null pnr here as failure the way they would for a VARS-platform hold
// (see connector-service/src/server.ts's VALUEJET carve-out).

const LOGIN_URL = "https://kiu.click/login/";
const DASHBOARD_MARKER = /dashboard|reservations/i;

// Premium cabin classes, cheapest-first (spec 5.1) — D is the cheapest
// Premium tier, J the most expensive. Never default to J just because
// it's listed first on the page.
const PREMIUM_CLASS_PRIORITY = ["D", "W", "C", "J"] as const;
// Economy classes, cheapest-first (spec 5.2).
const ECONOMY_CLASS_PRIORITY = ["T", "Q", "O", "N", "M", "L", "K", "H", "B", "S"] as const;

interface ClassInventoryEntry {
  code: string;
  seats: number;
  closed: boolean;
}

// Parses a flight row's raw class-inventory text (e.g. "J3 C2 W4 D1 S9 B9
// H9 K9 L9 M5 N2 O1 QC TC") into structured entries — spec 5.3/5.4: the
// number after the letter is seats remaining; a class ending in "C"
// instead of a number is closed regardless of the number of seats it
// might otherwise show.
export function parseClassInventory(text: string): ClassInventoryEntry[] {
  const entries: ClassInventoryEntry[] = [];
  const pattern = /\b([A-Z])(C|\d+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, code, value] = match;
    if (value === "C") {
      entries.push({ code, seats: 0, closed: true });
    } else {
      const seats = parseInt(value, 10);
      entries.push({ code, seats, closed: seats === 0 });
    }
  }
  return entries;
}

// The selection algorithm itself (spec 5.5) — always resolves to the
// lowest-priced AVAILABLE class inside the requested cabin, never the
// first one listed. Returns null if every class in that cabin is
// closed/sold out on this flight.
export function selectClassCode(inventory: ClassInventoryEntry[], cabinClass: "ECONOMY" | "PREMIUM"): string | null {
  const priority = cabinClass === "PREMIUM" ? PREMIUM_CLASS_PRIORITY : ECONOMY_CLASS_PRIORITY;
  const byCode = new Map(inventory.map((e) => [e.code, e]));
  for (const code of priority) {
    const entry = byCode.get(code);
    if (entry && !entry.closed && entry.seats > 0) return code;
  }
  return null;
}

async function pageDiagnostic(page: import("playwright").Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    url: window.location.href,
    visibleButtons: Array.from(document.querySelectorAll<HTMLElement>('button, a, input[type="submit"], input[type="button"]'))
      .map((el) => (el.textContent ?? (el as HTMLInputElement).value ?? "").trim())
      .filter(Boolean)
      .slice(0, 40),
    bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1500),
  }));
}

async function failWithDiagnostic(page: import("playwright").Page, logTag: string, message: string): Promise<never> {
  const diagnostic = await pageDiagnostic(page).catch(() => ({ note: "page.evaluate itself failed" }));
  console.error(`[${logTag}] ${message}. DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
  throw new Error(`${message}. Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`);
}

// Generic "click whichever visible control matches this text" helper —
// used throughout since KIU's exact element types (button vs. link vs.
// div-acting-as-button) aren't independently confirmed.
async function clickByText(page: import("playwright").Page, pattern: RegExp, opts?: { timeout?: number }): Promise<void> {
  const locator = page.getByText(pattern, { exact: false }).first();
  await locator.click({ timeout: opts?.timeout ?? 15000 });
}

async function fillByLabel(page: import("playwright").Page, labelPattern: RegExp, value: string): Promise<void> {
  await page.getByLabel(labelPattern, { exact: false }).first().fill(value);
}

export async function bookValueJetOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest,
  onStage?: OnBookingStage
): Promise<BookOnHoldResult> {
  const logTag = "valuejet-kiu-booking";
  const reportStage = (stage: BookingStageName) => {
    try {
      onStage?.(stage);
    } catch (err) {
      console.warn(`[${logTag}] onStage(${stage}) callback threw, continuing:`, err);
    }
  };

  const cabinClass: "ECONOMY" | "PREMIUM" = request.cabinClass === "PREMIUM" ? "PREMIUM" : "ECONOMY";
  const isRoundTrip = !!request.returnDate;
  const additionalAdults = request.additionalPassengers?.filter((p) => !p.type || p.type === "ADULT").length ?? 0;
  const children = request.additionalPassengers?.filter((p) => p.type === "CHILD").length ?? 0;
  const infants = request.additionalPassengers?.filter((p) => p.type === "INFANT").length ?? 0;
  const adults = 1 + additionalAdults;

  // Spec's own screenshots are the mobile interface, and explicitly warns
  // desktop may position (or even structure) controls differently —
  // matching that viewport gives the best chance of hitting the same UI
  // the spec was written against.
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();

    // --- 1. Login ---
    console.log(`[${logTag}] logging in`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await fillByLabel(page, /user|email|agent/i, credentials.username).catch(async () => {
      // Fallback for a plain unlabeled input pair, common on simple login forms.
      await page.locator('input[type="text"], input[type="email"]').first().fill(credentials.username);
    });
    await fillByLabel(page, /password/i, credentials.password).catch(async () => {
      await page.locator('input[type="password"]').first().fill(credentials.password);
    });
    await page
      .getByRole("button", { name: /log ?in|sign ?in/i })
      .first()
      .click()
      .catch(() => clickByText(page, /log ?in|sign ?in/i));
    await page
      .getByText(DASHBOARD_MARKER)
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => failWithDiagnostic(page, logTag, "Dashboard never appeared after login"));

    // --- 2. Open Reservation Module ---
    console.log(`[${logTag}] opening reservation module`);
    await clickByText(page, /reservations?/i).catch(() => failWithDiagnostic(page, logTag, `Couldn't find "Reservations" on the dashboard`));
    await clickByText(page, /new reservation/i).catch(() => failWithDiagnostic(page, logTag, `Couldn't find "New Reservation"`));

    // --- 3/4. Search flights ---
    reportStage("SEARCHING");
    console.log(`[${logTag}] searching ${request.origin}->${request.destination}`);
    await fillByLabel(page, /origin|from/i, request.origin);
    await fillByLabel(page, /destination|to/i, request.destination);
    await fillByLabel(page, /(departure|travel) date/i, request.departureDate);
    if (isRoundTrip) {
      await fillByLabel(page, /return date/i, request.returnDate!);
    }
    await setPassengerCount(page, "Adult", adults);
    if (children > 0) await setPassengerCount(page, "Child", children);
    if (infants > 0) await setPassengerCount(page, "Infant", infants);

    if (isRoundTrip) {
      // Spec 4.3: click "Flights" to auto-add the return sector with the
      // same passenger count — a distinct action from the final search
      // submission below.
      await clickByText(page, /^flights$/i).catch(() => {
        /* some KIU deployments may not need this extra step for a round trip — non-fatal, the Next-click loop below still surfaces a real problem if the return leg genuinely never got added */
      });
    }

    await clickNextUntilFlightsShown(page, logTag);
    reportStage("FLIGHT_FOUND");

    // --- 5/6. Select outbound (and return) flight + class ---
    console.log(`[${logTag}] selecting outbound flight/class (cabin=${cabinClass})`);
    await selectFlightAndClass(page, logTag, cabinClass, request.preferredDepartureTime, "outbound");
    if (isRoundTrip) {
      console.log(`[${logTag}] selecting return flight/class`);
      await selectFlightAndClass(page, logTag, cabinClass, request.preferredReturnTime, "return");
    }
    await clickByText(page, /finish and go to passengers/i).catch(() =>
      failWithDiagnostic(page, logTag, `Couldn't find "Finish and go to Passengers"`)
    );

    // --- 7. Passenger entry ---
    reportStage("FILLING_PASSENGER_DETAILS");
    console.log(`[${logTag}] filling passenger details`);
    await fillPassenger(page, logTag, {
      lastName: request.passenger.lastName,
      firstName: request.passenger.firstName,
      type: "ADULT",
    });
    for (const p of request.additionalPassengers ?? []) {
      await fillPassenger(page, logTag, { lastName: p.lastName, firstName: p.firstName, type: p.type ?? "ADULT" });
    }

    // --- 8. Contact information ---
    console.log(`[${logTag}] filling contact information`);
    await fillContactInfo(page, logTag, request.passenger.email, request.passenger.mobileNumber);

    // --- 9. Pre-save verification ---
    reportStage("REVIEWING_ITINERARY");
    console.log(`[${logTag}] capturing total quote`);
    const totalPayable = await captureTotalQuote(page, logTag);

    // --- 10. Save ---
    reportStage("CREATING_HOLD");
    console.log(`[${logTag}] saving reservation`);
    const saveButton = page.getByRole("button", { name: /save reservation/i }).first();
    await saveButton.click({ timeout: 15000 }).catch(() => clickByText(page, /save reservation/i));
    // Single click only, then wait for the save to actually settle — per
    // spec's explicit "never click Save repeatedly while it's processing".
    await page
      .getByText(/reservation saved|itinerary|manage/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => failWithDiagnostic(page, logTag, "Reservation save never confirmed"));

    // --- 11. Post-save verification (best-effort — a missing confirmation
    // signal here doesn't undo an already-successful save, so this never
    // throws; it only affects what ends up in `raw` for visibility) ---
    const diagnostic = await pageDiagnostic(page).catch(() => ({ bodyText: "" }));
    const raw = String((diagnostic as { bodyText?: string }).bodyText ?? "");

    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);

    return {
      pnr: null, // explicitly out of scope for this spec — see module doc comment
      holdExpiresAt: null,
      totalPayable,
      currency: totalPayable != null ? "NGN" : null,
      raw,
      screenshot,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function setPassengerCount(page: import("playwright").Page, label: "Adult" | "Child" | "Infant", count: number): Promise<void> {
  const pattern = new RegExp(label, "i");
  const control = page.getByLabel(pattern, { exact: false }).first();
  await control.selectOption(String(count)).catch(async () => {
    // A stepper (+/- buttons) rather than a <select> — click "+" (count-1)
    // times from whatever the default is (Adult defaults to 1, others to 0).
    const defaultValue = label === "Adult" ? 1 : 0;
    const clicksNeeded = count - defaultValue;
    if (clicksNeeded <= 0) return;
    const incrementButton = page
      .locator(`text=${label}`)
      .locator("xpath=following::button[1]")
      .first();
    for (let i = 0; i < clicksNeeded; i++) {
      await incrementButton.click({ timeout: 5000 }).catch(() => {});
    }
  });
}

// Clicks "Next" repeatedly (spec 4.4) until the flight-results list is
// showing, rather than assuming a fixed number of intermediate steps —
// the spec itself says "click Next until KIU shows available flights"
// without enumerating how many clicks that takes.
async function clickNextUntilFlightsShown(page: import("playwright").Page, logTag: string): Promise<void> {
  const MAX_CLICKS = 6;
  for (let i = 0; i < MAX_CLICKS; i++) {
    const flightsVisible = await page
      .getByText(/\b[A-Z]{2}\d{2,4}\b/) // a flight-number-shaped token, e.g. "VK215"
      .first()
      .isVisible()
      .catch(() => false);
    if (flightsVisible) return;
    const nextButton = page.getByRole("button", { name: /^next$/i }).first();
    const hasNext = await nextButton.isVisible().catch(() => false);
    if (!hasNext) break;
    await nextButton.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const flightsVisible = await page
    .getByText(/\b[A-Z]{2}\d{2,4}\b/)
    .first()
    .isVisible()
    .catch(() => false);
  if (!flightsVisible) await failWithDiagnostic(page, logTag, "Flight results never appeared after clicking Next");
}

// Finds the flight row matching preferredTime (if given — otherwise the
// first row) and applies the class-priority selection algorithm (spec
// 5.5) against that row's inventory text.
async function selectFlightAndClass(
  page: import("playwright").Page,
  logTag: string,
  cabinClass: "ECONOMY" | "PREMIUM",
  preferredTime: string | undefined,
  legLabel: string
): Promise<void> {
  const rows = page.locator('[class*="flight" i], [class*="itinerary" i]').filter({ hasText: /\b[A-Z]{2}\d{2,4}\b/ });
  const rowCount = await rows.count();
  if (rowCount === 0) await failWithDiagnostic(page, logTag, `No ${legLabel} flight rows found on the results page`);

  let rowIndex = 0;
  if (preferredTime && rowCount > 1) {
    const texts = await rows.allTextContents();
    const matchIndex = texts.findIndex((t) => t.includes(preferredTime));
    if (matchIndex === -1) {
      await failWithDiagnostic(
        page,
        logTag,
        `No ${legLabel} flight departs at "${preferredTime}" (${rowCount} option(s) shown, none matched)`
      );
    }
    rowIndex = matchIndex;
  } else if (rowCount > 1 && !preferredTime) {
    await failWithDiagnostic(
      page,
      logTag,
      `${rowCount} ${legLabel} flights found but no preferred time was given — resolve the ambiguity before booking`
    );
  }

  const row = rows.nth(rowIndex);
  const rowText = await row.textContent().catch(() => "");
  const inventory = parseClassInventory(rowText ?? "");
  const chosenClass = selectClassCode(inventory, cabinClass);
  if (!chosenClass) {
    await failWithDiagnostic(
      page,
      logTag,
      `No available ${cabinClass} class found on the ${legLabel} flight (inventory: ${JSON.stringify(inventory)})`
    );
  }

  console.log(`[${logTag}] ${legLabel}: selected class ${chosenClass} (cabin=${cabinClass})`);
  await row
    .getByText(new RegExp(`\\b${chosenClass}\\d+\\b`))
    .first()
    .click({ timeout: 10000 })
    .catch(() => failWithDiagnostic(page, logTag, `Found class ${chosenClass} in the ${legLabel} row's text but couldn't click it`));
}

async function fillPassenger(
  page: import("playwright").Page,
  logTag: string,
  passenger: { lastName: string; firstName: string; type: "ADULT" | "CHILD" | "INFANT" }
): Promise<void> {
  await fillByLabel(page, /last ?name|surname/i, passenger.lastName);
  await fillByLabel(page, /first ?name|given ?name/i, passenger.firstName);
  const typeControl = page.getByLabel(/passenger type/i, { exact: false }).first();
  await typeControl.selectOption({ label: passenger.type === "ADULT" ? "Adult" : passenger.type === "CHILD" ? "Child" : "Infant" }).catch(
    () => clickByText(page, new RegExp(passenger.type === "ADULT" ? "Adult" : passenger.type === "CHILD" ? "Child" : "Infant", "i"))
  );
  await page
    .getByRole("button", { name: /^confirm$/i })
    .first()
    .click({ timeout: 10000 })
    .catch(() => failWithDiagnostic(page, logTag, `Couldn't confirm passenger ${passenger.firstName} ${passenger.lastName}`));
  // Give KIU's own postback/auto-advance a moment before the next
  // passenger's fields are targeted — same reasoning as the settle waits
  // used throughout VarsBookOnHold.ts for this platform's postback style.
  await page.waitForTimeout(500);
}

async function fillContactInfo(page: import("playwright").Page, logTag: string, email: string, phoneLocal: string): Promise<void> {
  // Email
  await fillByLabel(page, /email/i, email).catch(() => failWithDiagnostic(page, logTag, "Couldn't find the Email Address field"));
  await page
    .getByRole("button", { name: /^confirm$/i })
    .first()
    .click({ timeout: 10000 })
    .catch(() => {
      /* some layouts may auto-save email without a separate Confirm — non-fatal */
    });
  await page.waitForTimeout(500);

  // Phone — local number only, per spec (country prefix is a separate,
  // already-defaulted control).
  const digitsOnly = phoneLocal.replace(/\D/g, "");
  await fillByLabel(page, /^number$|phone number/i, digitsOnly).catch(() =>
    failWithDiagnostic(page, logTag, "Couldn't find the Phone Number field")
  );
  await page
    .getByRole("button", { name: /^confirm$/i })
    .first()
    .click({ timeout: 10000 })
    .catch(() => {
      /* see email note above */
    });
  await page.waitForTimeout(500);
}

// Spec 9.1: the Total Quote row starts collapsed on mobile — expand,
// read, collapse again, leaving the screen in its pre-save state. Never
// sums per-passenger fares manually; only trusts what KIU itself displays
// as the total.
async function captureTotalQuote(page: import("playwright").Page, logTag: string): Promise<number | null> {
  const totalRow = page.getByText(/total quote/i).first();
  const rowVisible = await totalRow.isVisible().catch(() => false);
  if (!rowVisible) {
    console.warn(`[${logTag}] "Total Quote" row not found — proceeding without a captured total`);
    return null;
  }

  // The expand arrow is described as sitting at the top-right of the row —
  // no confirmed selector for it, so try the row itself first (many mobile
  // accordions toggle on tapping the row/header directly), then a nearby
  // icon-like element as a fallback.
  await totalRow.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  const amountText = await page
    .getByText(/total quote[^0-9]*([\d,]+(?:\.\d{2})?)/i)
    .first()
    .textContent()
    .catch(() => null);

  let total: number | null = null;
  if (amountText) {
    const match = amountText.match(/([\d,]+(?:\.\d{2})?)/);
    if (match) total = parseFloat(match[1].replace(/,/g, ""));
  }

  // Collapse again, returning to the pre-save state, per spec 9.1 step 5.
  await totalRow.click({ timeout: 5000 }).catch(() => {});

  if (total == null) {
    console.warn(`[${logTag}] found the Total Quote row but couldn't parse an amount from it`);
  }
  return total;
}
