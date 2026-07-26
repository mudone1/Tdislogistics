import { chromium } from "playwright";

// Shared Book-on-Hold automation for airlines running the VARS/Videcom
// booking engine (booking.<airline>.com/.../CustomerPanels/AgentLoginBS.aspx
// -> requirementsBS.aspx -> .../b/FlightCal.aspx). Confirmed identical
// login mechanism (#txtSineCode/#txtPassword/#btnOk) across Enugu Air,
// United Nigeria, Rano Air, and XeJet (see BaseVarsConnector.ts and each
// airline's search wrapper in search/vars-platform/VarsFlightSearch.ts).
// Only Enugu Air has been verified end-to-end through an ACTUAL booking
// (search -> fare select -> passenger details -> payment -> PNR, plus
// independent PNR verification against the public Manage My Booking
// lookup) — United/Rano/XeJet share the login DOM but their booking-flow
// selectors (fare classband names, passenger form field ids, payment
// options) are NOT independently confirmed. Each airline's wrapper module
// documents its own verification status; do not assume "shares the login"
// means "booking works" without a live check per airline.

export interface VarsAirlineBookingConfig {
  logTag: string;
  loginUrl: string;
  requirementsUrl: string;
  // Public "Manage My Booking" lookup (Surname + Booking Reference, no
  // agent login needed) — the independent ground truth for whether a PNR
  // is real. Confirmed for Enugu Air that a fabricated/invalid reference
  // returns the literal text "Booking not found!" here, while the in-flow
  // agent-session page after submitting a hold can land on what LOOKS like
  // a booking-management screen without an actual booking behind it.
  mmbUrl: string;
  airlineLabel: string;
}

const LOGGED_IN_MARKER = "text=/Logged in as:/i";
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
  // Compares these fare classes (by their internal data-classband value) on
  // each leg and picks whichever is cheaper. These names are airline-
  // specific — verified for Enugu Air ("Economy Promo" / "Economy Saver")
  // only. A caller for any other airline must supply names actually
  // confirmed against that airline's real fare page; this module does not
  // guess or fall back to Enugu's names, since picking the wrong classband
  // could silently select a more expensive fare.
  fareClassPreference: [string, string];
  // When a leg's route/date has more than one flight, the caller must
  // resolve that ambiguity (see searchVarsPlatformFlights in
  // VarsFlightSearch.ts to discover the options, and prompt the user)
  // before calling this function — supplying the exact departure time (as
  // shown on the fare page, e.g. "08:45") selects that specific flight's
  // panel instead of defaulting to the first one found. Omit only when
  // that leg's route/date is already known to have exactly one flight.
  // Two separate fields because a round trip's outbound and return legs
  // are independent searches that can each have their own ambiguity.
  preferredDepartureTime?: string;
  preferredReturnTime?: string;
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

export async function bookVarsPlatformOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest,
  config: VarsAirlineBookingConfig
): Promise<BookOnHoldResult> {
  const { logTag, loginUrl, requirementsUrl, mmbUrl, airlineLabel } = config;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.on("dialog", (dialog) => {
      console.log(`[${logTag}] dialog appeared: "${dialog.message()}"`);
      dialog.dismiss().catch(() => {});
    });
    const page = await context.newPage();

    // --- Login (identical mechanism across every VARS airline) ---
    console.log(`[${logTag}] logging in`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#txtSineCode").fill(credentials.username);
    await page.locator("#txtPassword").fill(credentials.password);
    await page.locator("#btnOk").click();
    await page.locator(LOGGED_IN_MARKER).waitFor({ state: "visible", timeout: 20000 });

    // --- Search (same public CustomerPanels flow, now under the agent session) ---
    console.log(`[${logTag}] searching ${request.origin}->${request.destination}`);
    await page.goto(requirementsUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#Origin").selectOption(request.origin);
    await page.locator("#Destination").selectOption(request.destination);
    // The Return/One Way control is a Bootstrap .btn-check radio — its
    // <label> sits visually on top and intercepts pointer events, so a
    // plain click() fails Playwright's actionability check (confirmed via
    // a real run against Enugu Air: "label ... intercepts pointer events").
    // Same fix already proven for this exact control in
    // VarsFlightSearch.ts's "One Way" button.
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

    // Two different search-form URLs across VARS deployments use two
    // different submit controls for the exact same #Origin/#Destination/
    // #departuredate form fields: CustomerPanels/requirementsBS.aspx has a
    // "Continue" button, while the real agent-portal entry point
    // (Dashboard.aspx -> "Standard Booking" -> agentSearch.aspx — the one
    // that actually surfaces the password-gated "Book Now, Pay Later"
    // accordion below, confirmed live) has a "#refineSearchButton" instead.
    const refineButton = page.locator("#refineSearchButton");
    if (await refineButton.count().catch(() => 0)) {
      await refineButton.first().click();
    } else {
      await page
        .locator('button, a, input[type="submit"], input[type="button"]')
        .filter({ hasText: /^continue$/i })
        .first()
        .click();
    }
    await page.waitForURL(/FlightCal\.aspx/i, { timeout: 20000 }).catch(() => {
      /* some VARS deployments don't change the URL for this step — proceed and let the panel wait below fail loudly if it truly didn't navigate */
    });

    // --- Fare selection: cheapest of the two given classbands, per leg ---
    const legCount = request.returnDate ? 2 : 1;
    await page.locator(".tab-pane.active .flt-panel").first().waitFor({ state: "visible", timeout: 15000 });
    for (let leg = 0; leg < legCount; leg++) {
      // leg 0 is outbound, leg 1 (round trip only) is the return — each is
      // an independent search with its own possible ambiguity, so each
      // gets its own preferred time rather than reusing one value for both.
      const preferredTime = leg === 0 ? request.preferredDepartureTime : request.preferredReturnTime;
      await selectCheapestFare(page, leg, request.fareClassPreference, preferredTime, logTag);
    }

    await clickNext(page, "fare-selection", logTag);

    // --- Products page: remove any auto-added add-ons (e.g. Travel Insurance) ---
    await page.locator(".RemoveProductButton2").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {
      /* nothing auto-added — fine */
    });
    const removeButtons = page.locator(".RemoveProductButton2");
    const removeCount = await removeButtons.count();
    for (let i = 0; i < removeCount; i++) {
      // Confirmed via a real run (United Nigeria): a loading spinner
      // ("#spinnerModal.in") can intercept the click here even though the
      // button itself is visible/enabled — wait for it to clear both
      // before and after, and don't let one failed removal (still
      // best-effort — a leftover add-on isn't worth aborting the booking
      // over) abort the loop.
      await page.locator("#spinnerModal.in").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      // Always click index 0 — each removal re-renders the list and shifts indices.
      await removeButtons
        .first()
        .click({ timeout: 10000 })
        .catch((err) => console.warn(`[${logTag}] remove-product click ${i} failed, continuing: ${err}`));
      await page.locator("#spinnerModal.in").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    await clickNext(page, "products", logTag);

    // --- Passenger details ---
    console.log(`[${logTag}] filling passenger details`);
    await page.locator("#passenger1firstname").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#passenger1title").selectOption({ label: request.passenger.title });
    await page.locator("#passenger1firstname").fill(request.passenger.firstName);
    await page.locator("#passenger1lastname").fill(request.passenger.lastName);
    await page.locator("#passenger1mobilephonenumber").fill(request.passenger.mobileNumber.replace(/^0+/, ""));
    await page.locator("#passenger1emailaddress").fill(request.passenger.email);
    await page.locator("#passenger1emailaddressverification").fill(request.passenger.email);
    await page.locator("#passenger1specialservicerequest0").click();

    // The payment section is a Bootstrap accordion (#pay-accordion) of
    // payment-option panels (Invoice/Pay Now/Book Now Pay Later — the
    // underlying radio VALUE strings are airline-specific, e.g. Enugu uses
    // "BuyNowPayLater" while United/Rano use "NoPaymentRequered" for the
    // same hold option — so match by the stable, airline-independent panel
    // heading TEXT instead). The radio input itself is CSS-hidden
    // (zero-size) with no wrapping <label> — confirmed live that the real,
    // human-facing control is the ".panel-heading" above it, and clicking
    // it (a genuine click, not the radio) reveals a REQUIRED
    // "#txtAgentPassword" field that must be filled with the agent's own
    // login password before the hold can actually be submitted. Skipping
    // this (as an earlier version of this code did, via direct
    // radio.checked + dispatchEvent) submitted with that field empty —
    // functionally created a real PNR in one live test, but does not match
    // the actual portal flow and risks breaking if that leniency is ever
    // tightened server-side.
    // The heading click TOGGLES the panel (Bootstrap accordion) — if
    // "Book Now, Pay Later" already happens to be the default-expanded
    // option (confirmed live it isn't always "Invoice" by default, unlike
    // the one case this was first verified against), clicking it again
    // would COLLAPSE it and hide the password field instead of revealing
    // it. Only click if the field isn't already visible.
    const passwordField = page.locator("#txtAgentPassword");
    if (!(await passwordField.isVisible().catch(() => false))) {
      await page
        .locator(".panel-heading", { hasText: /book now,?\s*pay later/i })
        .first()
        .click();
      await passwordField.waitFor({ state: "visible", timeout: 10000 });
    }
    await passwordField.fill(credentials.password);

    // The heading click above only expands/collapses the accordion panel —
    // confirmed live it does NOT also select the underlying radio (the
    // submit call came back "ErrorMsg":"Select Form Of Payment" even with
    // the panel expanded and password filled). Explicitly set the radio
    // within that same panel, same direct-state-set approach as before
    // (plain .click() doesn't reliably stick on this CSS-hidden control),
    // but scoped to whichever radio lives inside the "Book Now, Pay Later"
    // panel rather than a hardcoded value string — airline-specific values
    // (Enugu: "BuyNowPayLater", United/Rano: "NoPaymentRequered") would
    // otherwise need per-airline hardcoding here.
    const radioSet = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll<HTMLElement>(".panel-heading")).find((el) =>
        /book now,?\s*pay later/i.test(el.textContent ?? "")
      );
      const panel = heading?.closest(".panel");
      const radio = panel?.querySelector<HTMLInputElement>('input[name="optpaymentformofpayment"]');
      if (!radio) return false;
      radio.checked = true;
      radio.dispatchEvent(new Event("click", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    if (!radioSet) {
      throw new Error('Could not find the "Book Now, Pay Later" payment radio to select');
    }

    await page.evaluate(() => {
      const tnc = document.getElementById("chkAgreeTermsAndConditions") as HTMLInputElement | null;
      if (tnc && !tnc.checked) tnc.click();
    });

    // --- Submit the hold ---
    // The submit click triggers a PaymentWS.asmx/ValidateBooking call that
    // reports success/failure with a real (if sometimes generic) message —
    // e.g. "Select Form Of Payment" caught a missing radio selection, and
    // "Validation Failed<br/>Surname ... invalid" caught a bad passenger
    // name during live testing. Surface that message on failure instead of
    // only finding out 30s later that the confirmation page never showed.
    console.log(`[${logTag}] submitting hold`);
    let validationError: string | null = null;
    const validationListener = async (res: import("playwright").Response) => {
      if (!/ValidateBooking/i.test(res.url())) return;
      try {
        const data = JSON.parse(await res.text());
        const payload = data.d ?? data;
        if (payload?.Result && payload.Result !== "OK") {
          validationError = payload.ErrorMsg || payload.PassengerDetailsErrorMsg || payload.PaymentDetailsErrorMsg || "Unknown validation error";
        }
      } catch {
        /* non-JSON or unexpected shape — let the confirmation-page wait below report the failure */
      }
    };
    page.on("response", validationListener);
    await clickNext(page, "payment-details", logTag);
    await page.waitForTimeout(2000);
    page.off("response", validationListener);
    if (validationError) {
      throw new Error(`Booking validation failed: ${validationError}`);
    }

    // Wait for the confirmation summary page to appear
    await page
      .locator("text=/PNR|Booking Reference|TTL Payment Instructions|Manage My Booking/i")
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(async (err) => {
        const diagnostic = await page.evaluate(() => ({
          url: window.location.href,
          visibleButtons: Array.from(
            document.querySelectorAll<HTMLElement>('button, a, input[type="submit"], input[type="button"]')
          )
            .map((el) => (el.textContent ?? (el as HTMLInputElement).value ?? "").trim())
            .filter(Boolean),
          bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1500),
        }));
        console.error(`[${logTag}] confirmation page never appeared. DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
        throw err;
      });

    // Click the final Confirm/Submit button to actually complete the booking —
    // not required: some flights land straight on Manage My Booking (PNR
    // already visible in the wait above) with no further step here.
    console.log(`[${logTag}] confirming booking submission`);
    await clickNext(page, "confirmation-summary", logTag, { required: false });

    // Wait for the final success page
    await page
      .locator("text=/booking.*(?:confirmed|successful|completed)|thank you/i")
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(async () => {
        // If the final success page doesn't appear, still check if we have a PNR
        // Some deployments may not show a final success page, but the booking
        // should be confirmed if we got here without an error
        console.warn(`[${logTag}] no final success page detected, but continuing`);
      });

    const raw = await page.locator("body").innerText();
    // Best-effort — a screenshot failure must never turn a real successful
    // hold into a failed job, so swallow and fall back to null.
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const result = parseConfirmation(raw, screenshot);

    // Independent verification, not just trusting the in-flow page — see
    // the mmbUrl comment above for exactly why that page alone isn't
    // trustworthy (confirmed for Enugu Air: it can show booking-management
    // nav chrome with no actual booking behind it).
    console.log(`[${logTag}] verifying PNR "${result.pnr}" via public Manage My Booking lookup`);
    const verified = result.pnr
      ? await verifyBookingReference(context, mmbUrl, result.pnr, request.passenger.lastName, logTag)
      : false;
    if (!verified) {
      throw new Error(
        result.pnr
          ? `Booking submission could not be verified — ${airlineLabel}'s Manage My Booking lookup reports no booking found for reference "${result.pnr}" / surname "${request.passenger.lastName}". The hold likely did not complete.`
          : "Booking submission produced no recognizable booking reference — the hold likely did not complete."
      );
    }
    console.log(`[${logTag}] PNR "${result.pnr}" verified`);
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
  mmbUrl: string,
  pnr: string,
  surname: string,
  logTag: string
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(mmbUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#txtSurname").fill(surname);
    await page.locator("#txtPNR").fill(pnr);
    await page.locator("#btnOk").click();
    // Same non-submit #btnOk / async-postback pattern as the agent login —
    // there's no confirmed "found" marker to wait on (only the negative
    // "Booking not found!" case is verified for Enugu Air), so wait for the
    // postback's network activity to settle rather than a fixed sleep.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    return !BOOKING_NOT_FOUND_MARKER.test(bodyText);
  } catch (err) {
    // A verification-mechanism failure (network hiccup, page structure
    // change) must never silently report a fabricated success — only an
    // actual pass through the "not found" check counts as verified.
    console.error(`[${logTag}] PNR verification threw, treating as unverified: ${err}`);
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
  fareClasses: [string, string],
  preferredDepartureTime: string | undefined,
  logTag: string
): Promise<void> {
  const panels = page.locator(".tab-pane.active .flt-panel");
  const panelCount = await panels.count();

  // With more than one flight for this leg, the caller must have already
  // resolved which one to book (see preferredDepartureTime doc above) —
  // proceeding without it risks silently booking the wrong departure time.
  let panelIndex = legIndex;
  if (panelCount > 1) {
    if (!preferredDepartureTime) {
      throw new Error(
        `${panelCount} flights found for leg ${legIndex} but no preferredDepartureTime was given — resolve the ` +
          `ambiguity (list the options via searchVarsPlatformFlights and ask the user) before booking.`
      );
    }
    const matchedIndex = await panels.evaluateAll((els, targetTime) =>
      els.findIndex((el) => el.querySelector(".cal-Depart-time .time")?.textContent?.trim() === targetTime)
    , preferredDepartureTime);
    if (matchedIndex === -1) {
      const available = await panels.evaluateAll((els) =>
        els.map((el) => el.querySelector(".cal-Depart-time .time")?.textContent?.trim() ?? "unknown")
      );
      throw new Error(
        `No flight on leg ${legIndex} departs at "${preferredDepartureTime}" (available: ${available.join(", ")})`
      );
    }
    panelIndex = matchedIndex;
  }

  const panel = panels.nth(panelIndex);
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
    console.log(`DIAGNOSTIC [${logTag}] leg ${legIndex} classbands: ${JSON.stringify(diagnostic)}`);
    throw new Error(`Neither of ${fareClasses.join(", ")} is available on leg ${legIndex}`);
  }

  // Two confirmed-different selection mechanisms across VARS deployments:
  // Enugu Air uses a "Select this fare" custom toggle span (sibling
  // "Selected"/radio-icon spans swap visibility via a "hidden" class) with
  // a zero-size layout box of its own — Playwright's real-mouse-click
  // actionability check fails on it, but the click handler is bound above
  // the text node, so dispatching the event directly via JS works
  // reliably. United Nigeria's deployment has no such inner element at
  // all (confirmed via live DOM inspection) — there, the classband-panel
  // itself is the click target (it's tabindex="0", i.e. built to be
  // focusable/clickable as a whole unit), gaining a "panel-active" class
  // on click. Try Enugu's mechanism first since it's the one proven
  // through an actual completed booking; fall back to United's.
  const clicked = await panel.evaluate((panelEl, band) => {
    const card = panelEl.querySelector<HTMLElement>(`[data-classband="${band}"]`);
    if (!card) return false;
    const selectEl = card.querySelector<HTMLElement>(".flight-class-select-fare-text");
    if (selectEl) {
      selectEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, cheaperBand);

  if (!clicked) {
    throw new Error(`"${cheaperBand}" fare card not found on leg ${legIndex}`);
  }

  // Best-effort confirmation — whichever signal this deployment actually
  // uses (Enugu's toggled span, or United's "panel-active" class on the
  // card itself). Non-blocking either way: a deployment using neither just
  // times out and proceeds, same as before.
  await Promise.race([
    panel.locator(`[data-classband="${cheaperBand}"] .flight-class-selected-text`).waitFor({ state: "visible", timeout: 8000 }),
    panel.locator(`[data-classband="${cheaperBand}"].panel-active`).waitFor({ state: "attached", timeout: 8000 }),
  ]).catch(() => {
    /* best-effort confirmation — some deployments may not signal selection this way */
  });
}

async function clickNext(
  page: import("playwright").Page,
  stage: string,
  logTag: string,
  opts?: { required?: boolean }
): Promise<void> {
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
      console.log(`DIAGNOSTIC [${logTag}] stage="${stage}" no Next control found among: ${JSON.stringify(candidates)}`);
      // Confirmed for Enugu Air: after "payment-details" submits the hold,
      // some flights land directly on the Manage My Booking page (PNR
      // already visible — see the caller's success-text wait right before
      // this call) with no further confirm step, while others show one
      // more "Next" here. Since we only reach "confirmation-summary" after
      // that PNR/Manage-Booking text already matched, treat a missing Next
      // there as "already done," not a failure.
      if (!required) {
        console.log(`[${logTag}] no further Next at stage="${stage}" — booking already confirmed, continuing`);
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
