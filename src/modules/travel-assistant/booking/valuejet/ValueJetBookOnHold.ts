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
// Originally built from a written spec (kiu-booking-spec.md, itself
// derived from mobile-app screenshots) with zero live DOM access, then
// corrected against a real screen-recorded agent walkthrough
// (2026-08-08) that exposed several mismatches between the spec and the
// actual kiu.click UI — see the per-step comments below for exactly what
// changed and why. Selectors are still deliberately GENERIC (by visible
// text/label/role, not guessed CSS ids) since even the recording doesn't
// give live DOM access — expect this to keep needing the same
// fix-from-real-diagnostic cycle every other module in this codebase went
// through; every major step below dumps page state into its thrown error
// on failure for exactly that reason.
//
// CORRECTED (was: "stops after Save reservation, no PNR, no TTL, no
// ticketing, pnr always null"): the recording shows a real reference code
// (e.g. "JLTWRI") assigned immediately after "Save reservation", on its
// own confirmation page (URL contains "/ipnr") with both flight segments
// at status "HK" — this is captured as the result's pnr below. Capture
// itself is still best-effort against an unconfirmed selector (see
// capturePnr) — a capture miss on an otherwise-successful save is NOT
// treated as a failure (see connector-service/src/server.ts's VALUEJET
// carve-out), so a null pnr can still occasionally reach callers even
// though ValueJet does generate one.

const LOGIN_URL = "https://kiu.click/login/";

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

// `index` picks the Nth match (0-based) instead of the first — needed for
// Availability mode's round-trip search form, which duplicates the same
// Origin/Destination/Date labels for leg 2.
async function fillByLabel(page: import("playwright").Page, labelPattern: RegExp, value: string, index = 0): Promise<void> {
  await page.getByLabel(labelPattern, { exact: false }).nth(index).fill(value);
}

// request.departureDate/returnDate arrive as ISO "YYYY-MM-DD" throughout
// this codebase — live-verified (2026-08-09) the real field expects
// "MM-DD-YYYY" (its own placeholder text, confirmed via diagnostic dump),
// so filling the raw ISO string in would have landed a wrong or rejected
// value even once the field itself was correctly found.
function toMDYFormat(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate; // unexpected shape — pass through rather than guess
  const [, yyyy, mm, dd] = match;
  return `${mm}-${dd}-${yyyy}`;
}

// Live-verified (2026-08-09): the "Date" label AND "Departure/Travel Date"
// wording both failed on a real booking attempt, and so did a generic
// placeholder*="date" match — the real placeholder is "MM-DD-YYYY", which
// doesn't contain the substring "date" at all. Confirmed via the resulting
// diagnostic dump (inputPlaceholders: ["MM-DD-YYYY", "Date", "0", "0"]).
// Tries the confirmed-real MM-DD-YYYY placeholder pattern FIRST now, kept
// behind the older guesses as fallbacks in case a different KIU deployment
// phrases it differently, before giving up with the same full-page dump
// that made this fix possible.
async function fillDateField(page: import("playwright").Page, logTag: string, isoValue: string, index = 0): Promise<void> {
  const mdyValue = toMDYFormat(isoValue);
  try {
    await page.locator('input[placeholder="MM-DD-YYYY"]').nth(index).fill(mdyValue, { timeout: 8000 });
    return;
  } catch {
    /* try next */
  }
  try {
    await page.getByLabel(/^date$/i, { exact: false }).nth(index).fill(mdyValue, { timeout: 8000 });
    return;
  } catch {
    /* try next */
  }
  try {
    await page.getByLabel(/(departure|travel) date/i, { exact: false }).nth(index).fill(mdyValue, { timeout: 8000 });
    return;
  } catch {
    /* try next */
  }
  try {
    await page.locator('input[placeholder*="date" i]').nth(index).fill(mdyValue, { timeout: 8000 });
    return;
  } catch {
    /* fall through to diagnostic */
  }

  const diagnostic = await page
    .evaluate(() => ({
      labels: Array.from(document.querySelectorAll("label")).map((l) => l.textContent?.trim()).filter(Boolean),
      inputPlaceholders: Array.from(document.querySelectorAll("input")).map((i) => (i as HTMLInputElement).placeholder).filter(Boolean),
      url: window.location.href,
    }))
    .catch((err) => ({ evaluateError: String(err) }));
  console.error(`[${logTag}] no date field matched (placeholder "MM-DD-YYYY", label "Date", label "Departure/Travel Date", or placeholder containing "date"). DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
  throw new Error(`Couldn't find a date field to fill (index ${index}). Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`);
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

  // CORRECTED: the spec assumed a mobile interface and this used to force
  // a 390x844 mobile viewport to match it — but the real agent portal
  // (confirmed via a real screen recording, 2026-08-08) is a full desktop
  // web app: a fixed left sidebar nav, multi-column layout, data tables —
  // nothing about it is mobile-responsive. Running it at mobile width was
  // very likely why the dashboard nav previously collapsed to an
  // icon-only zero-size "Reservations" element (see the dashboard-wait
  // comment below). Drive the automation at desktop width to match the
  // UI it actually is, and only narrow to mobile right before the final
  // screenshot (per explicit product preference — see near the bottom of
  // this function).
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // --- 1. Login ---
    console.log(`[${logTag}] logging in`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    // Live-verified (2026-08-07) real login form: input[name="username"]
    // (type=email) / input[name="password"], both bare of visible <label>
    // text (placeholder-only) — fillByLabel's getByLabel() never matches
    // either, so this goes straight to the confirmed selectors rather than
    // paying for a doomed first attempt.
    await page.locator('input[name="username"]').fill(credentials.username).catch(async () => {
      await fillByLabel(page, /user|email|agent/i, credentials.username).catch(async () => {
        await page.locator('input[type="text"], input[type="email"]').first().fill(credentials.username);
      });
    });
    await page.locator('input[name="password"]').fill(credentials.password).catch(async () => {
      await fillByLabel(page, /password/i, credentials.password).catch(async () => {
        await page.locator('input[type="password"]').first().fill(credentials.password);
      });
    });

    // The earlier generic getByRole/getByText(/log ?in/i) approach matched
    // the WRONG control live: this page also has an unrelated "Log in with
    // Office" SSO checkbox, whose <label> text contains "Log in" and can
    // sort before the real submit button in DOM order — confirmed live via
    // a real failure where getByText(/log ?in/i).first() clicked that
    // label instead of submitting the form, then hung retrying against an
    // unrelated toast/mask overlay it had no business interacting with.
    // Scope strictly to a real <button type="submit"> with EXACT text "Log
    // in" (never "...with Office") to make that mismatch impossible.
    const loginButton = page.locator('button[type="submit"]').filter({ hasText: /^Log in$/ }).first();
    // React disables this button until both fields pass validation — give
    // it a moment to flip enabled after the fills above land.
    await loginButton
      .evaluate((el) => !(el as HTMLButtonElement).disabled, { timeout: 5000 })
      .catch(() => {});
    await loginButton.click({ timeout: 10000 }).catch(async (err) => {
      // A transient toast (observed live: "To ensure the security of your
      // session...") can sit over the button and intercept the click even
      // once it's correctly targeted — dismiss anything with a close
      // control, then retry once with force as a last resort rather than
      // burning the full retry budget on a toast that was always going to
      // auto-dismiss.
      await page
        .locator('[data-pc-section="mask"] button, [data-pc-section="mask"] [aria-label="Close"]')
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
      await page.waitForTimeout(1000);
      await loginButton.click({ timeout: 8000, force: true }).catch(() => {
        throw err;
      });
    });
    // Confirmed live: login itself now succeeds and lands on
    // kiu.click/dashboard/, but the dashboard's own async load (a survey
    // widget — "Help us improve by answering a few, simple questions!" —
    // renders alongside it) routinely takes longer than the 20s this used
    // to wait, even though the "Reservations" button DOES show up soon
    // after — the diagnostic dump from that exact timeout confirmed
    // "Reservations" present in visibleButtons moments later. Wait longer,
    // and target the specific button role rather than any text match
    // (removes any risk of the survey widget's own text colliding, the
    // same class of bug the login-button fix above addressed).
    // Confirmed live (again) via the diagnostic dump from THIS exact
    // timeout: "Reservations" WAS present in visibleButtons — which scans
    // button/a/input broadly — while getByRole("button", ...) still timed
    // out. That only happens if the real element isn't an actual
    // role="button" (e.g. an <a> styled to look like one, common on this
    // dashboard). Matched against the same broad element set the
    // diagnostic itself uses (and clickByText below already relies on),
    // instead of a strict ARIA role that doesn't hold for this page.
    //
    // STILL failed live after THAT fix too, with the IDENTICAL diagnostic —
    // "Reservations" present in visibleButtons, wait still timed out, three
    // attempts running now. That repetition across genuinely different
    // matching mechanisms (role, broad element+anchor, unanchored getByText)
    // means the problem was never the selector — something is actually
    // covering the element so it never satisfies Playwright's "visible"
    // check (non-zero box, not display:none/visibility:hidden/opacity:0),
    // even though its text is present in the DOM either way. The survey
    // widget ("Help us improve...") mentioned in every single diagnostic is
    // the prime suspect — dismiss it first (best-effort: Escape, then any
    // close/dismiss control near that text), and if the wait still fails,
    // the diagnostic now inspects the "Reservations" element directly
    // (computed visibility + whatever's actually at its center point) so a
    // fourth attempt isn't another blind guess.
    await page.keyboard.press("Escape").catch(() => {});
    await page
      .locator('button[aria-label="Close" i], button[aria-label="Dismiss" i], [class*="close" i][role="button"]')
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Root cause found live via the diagnostic added for the 4th attempt:
    // ".first()" DID resolve — to the WRONG element. The dashboard has
    // multiple leaf elements whose text is exactly "Reservations": a
    // zero-size ({x:0,y:0,width:0,height:0}) <span> that sorts first in DOM
    // order (looks like hidden nav-badge/tooltip text, nothing to do with
    // any overlay), and the real, fully visible dashboard card
    // (applicationCard__title, non-zero rect) further down. getByText(...)
    // .first() always grabbed the zero-size one, so waitFor({state:
    // "visible"}) was correctly timing out on THAT element forever — not a
    // selector-matching problem, not an overlay, just the wrong match. Walk
    // every "Reservations" match and use the first one with an actual
    // non-zero box instead of blindly trusting DOM order.
    const reservationsCandidates = page.getByText(/reservations/i);
    const candidateCount = await reservationsCandidates.count().catch(() => 0);
    let reservationsTarget: ReturnType<typeof page.getByText> | null = null;
    for (let i = 0; i < candidateCount; i++) {
      const candidate = reservationsCandidates.nth(i);
      const box = await candidate.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        reservationsTarget = candidate;
        break;
      }
    }
    if (reservationsTarget) {
      await reservationsTarget.waitFor({ state: "visible", timeout: 40000 }).catch(() => {
        reservationsTarget = null;
      });
    }
    if (!reservationsTarget) {
      const reservationsDiagnostic = await page
        .evaluate(() => {
          const candidates = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
            (el) => el.children.length === 0 && (el.textContent ?? "").trim().toLowerCase() === "reservations"
          );
          return candidates.slice(0, 5).map((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const topElementAtCenter = document.elementFromPoint(centerX, centerY);
            return {
              tag: el.tagName,
              className: el.className,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              elementCoveringItsCenter: topElementAtCenter
                ? { tag: topElementAtCenter.tagName, className: (topElementAtCenter as HTMLElement).className }
                : null,
            };
          });
        })
        .catch(() => "<evaluate failed>");
      console.error(`[${logTag}] "Reservations" element diagnostic: ${JSON.stringify(reservationsDiagnostic)}`);
      return failWithDiagnostic(
        page,
        logTag,
        `Dashboard never appeared after login (no visible "Reservations" element found). State: ${JSON.stringify(reservationsDiagnostic).slice(0, 800)}`
      );
    }

    // --- 2. Open Reservation Module ---
    // Click the SAME element the wait just confirmed is visible — reusing
    // the generic clickByText(/reservations?/i) helper here would hit the
    // exact ".first()-picks-the-wrong-one" bug just fixed above all over
    // again.
    console.log(`[${logTag}] opening reservation module`);
    await reservationsTarget.click({ timeout: 10000 }).catch(() => failWithDiagnostic(page, logTag, `Couldn't click "Reservations" on the dashboard`));
    // CORRECTED (2026-08-09, live): this click can throw even when the
    // navigation it triggers actually succeeds — a diagnostic captured
    // right at this exact failure showed the URL had already moved to
    // /new-reservation despite the thrown error (a detached-element/
    // navigation race, not a real click failure). Only treat this as
    // fatal if we're NOT already on that page.
    await clickByText(page, /new reservation/i).catch(async () => {
      if (!/new-reservation/i.test(page.url())) {
        await failWithDiagnostic(page, logTag, `Couldn't find "New Reservation"`);
      }
    });

    // CORRECTED (2026-08-09, live): a leftover unsaved reservation on this
    // agent account — from an earlier interrupted run, or genuinely
    // abandoned by a human agent — blocks the New Reservation flow behind
    // a "You have an active booking" prompt with two actions: "New
    // Reservation" (discard, start fresh) and "Edit Booking" (resume the
    // stale one). Always choose "New Reservation" — a fresh search must
    // never silently resume an unrelated stale booking. Scoped to the
    // prompt's own container (found by walking up until "Edit Booking" is
    // also present) so this can't collide with the sidebar's identically
    // worded "New Reservation" nav link.
    const activeBookingAnchor = page.getByText(/you have an active booking/i).first();
    const hasStalePrompt = await activeBookingAnchor.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasStalePrompt) {
      console.warn(`[${logTag}] discarding a stale/incomplete reservation left on this agent account`);
      const modal = await walkUpUntil(activeBookingAnchor, (text) => /edit booking/i.test(text));
      const scope = modal ?? page.locator("body");
      await scope
        .getByText(/^new reservation$/i)
        .first()
        .click({ timeout: 5000 })
        .catch(() => failWithDiagnostic(page, logTag, `Found a stale "active booking" prompt but couldn't dismiss it`));
      await page.waitForTimeout(800);
    }

    // --- 3/4. Search flights ---
    reportStage("SEARCHING");
    console.log(`[${logTag}] searching ${request.origin}->${request.destination}`);
    // CORRECTED: the spec's single Origin/Destination/Date/"Date Of
    // Return" form is the "Shopping" sale-type tab — but that tab never
    // shows the letter-coded class-inventory buttons (T3, H9, JC, ...)
    // this module's whole fare-selection algorithm depends on. The
    // recording explicitly switches to the "Availability" tab first,
    // which is also the one whose search form matches the spec's own
    // class-inventory screenshots. Select it explicitly rather than
    // trusting whatever sale type happens to be selected by default.
    await clickByText(page, /^availability$/i).catch(() =>
      failWithDiagnostic(page, logTag, `Couldn't find the "Availability" sale-type tab`)
    );
    await page.waitForTimeout(300);

    // Leg 1 (outbound) — Origin/Destination/Date are the first instance of
    // each of these labels on the page even in round-trip mode (leg 2, if
    // added below, duplicates the same labels further down).
    await fillByLabel(page, /^origin/i, request.origin);
    await fillByLabel(page, /^destination/i, request.destination);
    // CORRECTED: Availability mode's date field is labeled plainly "Date"
    // (not "Departure Date"/"Travel Date" as the spec assumed) — matched
    // first here since it's confirmed live; the old wording kept as a
    // fallback in case a different KIU deployment phrases it that way.
    await fillDateField(page, logTag, request.departureDate);

    if (isRoundTrip) {
      // CORRECTED: Availability mode has no single "Date Of Return" field
      // at all — a round trip is built by clicking "+" to add a SECOND
      // leg row (its own Origin/Destination/Date), reversed from leg 1,
      // confirmed live. No confirmed selector for the add-leg control
      // (icon-only, no visible text) — try several plausible ways to find
      // it before giving up loudly.
      const addLegButton = page
        .locator('button, [role="button"]')
        .filter({ has: page.locator('svg, [class*="plus" i], [class*="add" i]') })
        .last();
      const clickedAdd = await addLegButton
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!clickedAdd) {
        await page
          .getByRole("button", { name: /^\+$/ })
          .last()
          .click({ timeout: 5000 })
          .catch(() => failWithDiagnostic(page, logTag, `Couldn't find the "add leg" (+) button for the return leg`));
      }
      await page.waitForTimeout(300);
      // Leg 2 fields are the SECOND instance of each label — explicitly
      // filled (not relied upon to auto-populate) even though the
      // recording showed KIU pre-filling them from leg 1's reversed
      // route, since that auto-fill is a UI convenience tied to the real
      // autocomplete interaction and isn't guaranteed to fire the same
      // way when driven programmatically.
      await fillByLabel(page, /^origin/i, request.destination, 1);
      await fillByLabel(page, /^destination/i, request.origin, 1);
      await fillDateField(page, logTag, request.returnDate!, 1);
    }

    // CORRECTED: passenger-count fields are labeled "ADT"/"CHD"/"INF"
    // (abbreviations), not spelled out "Adult"/"Child"/"Infant" — the old
    // getByLabel(/Adult/i)-based helper would never match. Confirmed live
    // as plain number inputs directly below their abbreviated label, not
    // a <select> or a stepper.
    await setPassengerCountAvailability(page, "ADT", adults);
    if (children > 0) await setPassengerCountAvailability(page, "CHD", children);
    if (infants > 0) await setPassengerCountAvailability(page, "INF", infants);

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
    const saveButton = page.getByRole("button", { name: /^save reservation$/i }).first();
    await saveButton.click({ timeout: 15000 }).catch(() => clickByText(page, /save reservation/i));
    // Single click only, then wait for the save to actually settle — per
    // spec's explicit "never click Save repeatedly while it's processing".
    // CORRECTED: confirmed live (2026-08-08) a successful save navigates to
    // a dedicated confirmation/itinerary page (URL contains "/ipnr") — wait
    // for that first as the strongest signal, then the text-based wait
    // (unchanged) as a second check in case some deployments don't
    // navigate the same way.
    await page.waitForURL(/ipnr/i, { timeout: 30000 }).catch(() => {
      /* URL-based wait is a bonus signal, not required — the text wait below still catches a genuine failure */
    });
    await page
      .getByText(/reservation saved|itinerary|manage/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => failWithDiagnostic(page, logTag, "Reservation save never confirmed"));

    // --- 11. Capture the reference code ---
    // CORRECTED: was assumed impossible ("no PNR by design") — confirmed
    // live the confirmation page shows a real short reference code (e.g.
    // "JLTWRI") right at the top, next to print/email icons. Best-effort:
    // a capture miss here doesn't mean the save failed (see
    // connector-service/src/server.ts's VALUEJET carve-out), so this never
    // throws.
    const pnr = await capturePnr(page, logTag);

    // --- 12. Post-save verification (best-effort — a missing confirmation
    // signal here doesn't undo an already-successful save, so this never
    // throws; it only affects what ends up in `raw` for visibility) ---
    const diagnostic = await pageDiagnostic(page).catch(() => ({ bodyText: "" }));
    const raw = String((diagnostic as { bodyText?: string }).bodyText ?? "");

    // Final confirmation screenshot in mobile view (explicit product
    // preference) — everything above this point ran at desktop width to
    // match the real portal, so narrow down only now, after every real
    // interaction is already done.
    await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
    await page.waitForTimeout(300);
    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);

    return {
      pnr,
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

// CORRECTED: Availability mode's "Number Of Passengers" fields are labeled
// with abbreviations ("ADT"/"CHD"/"INF") sitting directly above a plain
// number input — confirmed live (2026-08-08) — not spelled-out
// "Adult"/"Child"/"Infant" text associated via a semantic <label for>, and
// not a stepper either. Try the semantic-label approach first anyway (in
// case a different KIU deployment does associate it properly), then fall
// back to the confirmed real layout: locate the abbreviation text, then
// the input immediately following it.
async function setPassengerCountAvailability(
  page: import("playwright").Page,
  code: "ADT" | "CHD" | "INF",
  count: number
): Promise<void> {
  const fullWord = code === "ADT" ? "Adult" : code === "CHD" ? "Child" : "Infant";
  const filledByLabel = await page
    .getByLabel(new RegExp(fullWord, "i"), { exact: false })
    .first()
    .fill(String(count))
    .then(() => true)
    .catch(() => false);
  if (filledByLabel) return;

  const input = page
    .getByText(new RegExp(`^${code}$`, "i"))
    .first()
    .locator("xpath=following::input[1]");
  await input.fill(String(count)).catch(() => {
    // Best-effort — ADT already defaults to 1 and CHD/INF to 0, so a
    // failed fill for a value matching that default is a silent no-op
    // anyway. A real mismatch (e.g. 2 adults requested but the form still
    // shows 1) will surface loudly downstream when only one passenger form
    // appears on the Passengers step.
    console.warn(`[valuejet-kiu-booking] couldn't set ${code} passenger count to ${count}`);
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

// Generic "walk up from a text anchor until an ancestor's own text
// satisfies some predicate" helper — used whenever a real container class
// name isn't known (never independently confirmed against a live DOM
// inspection, only a screen recording), so scoping a click/read to "the
// right container" has to be derived structurally instead of guessed.
// Stops at the SMALLEST satisfying ancestor rather than overshooting, so
// a scoped search inside it doesn't accidentally span multiple unrelated
// sections of the page.
async function walkUpUntil(
  anchor: ReturnType<import("playwright").Page["getByText"]>,
  predicate: (text: string) => boolean,
  maxLevels = 8
): Promise<ReturnType<import("playwright").Page["getByText"]> | null> {
  for (let up = 1; up <= maxLevels; up++) {
    const ancestor = anchor.locator(`xpath=ancestor::*[${up}]`);
    const text = (await ancestor.textContent().catch(() => "")) ?? "";
    if (predicate(text)) return ancestor;
  }
  return null;
}

// Confirmed live (2026-08-08 recording): each flight row's class
// inventory really is rendered as individually clickable buttons whose
// own text is the exact code (e.g. "T3", "H9", "JC") — clicking one
// toggles it into a selected/checked state. That part of the spec's
// design (read raw inventory text, apply the priority algorithm, click
// the chosen code) holds up. What's unconfirmed is the exact row
// container — walks up from each flight-number badge to find one, since
// no real class name was ever observed to guess from. A real row's text
// contains the flight-number badge itself plus several class-code tokens
// (e.g. "T3 D6 S9 B9 H9 K9..." per spec 5.3/5.4) — stop at the smallest
// ancestor with at least 3, rather than overshooting into a container
// spanning multiple flights (which would make the later
// getByText(chosenClass) click ambiguous between rows).
async function walkUpToRowContainer(
  page: import("playwright").Page,
  badge: ReturnType<typeof page.getByText>
): Promise<ReturnType<typeof page.getByText> | null> {
  return walkUpUntil(badge, (text) => (text.match(/\b[A-Z]{1,2}(?:C|\d{1,2})\b/g) ?? []).length >= 3);
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
  // Strategy A: the original guessed class-name selector — cheap, keep
  // trying it first in case it's right.
  let rows: ReturnType<typeof page.getByText>[] = [];
  const guessed = page.locator('[class*="flight" i], [class*="itinerary" i]').filter({ hasText: /\b[A-Z]{2}\d{2,4}\b/ });
  const guessedCount = await guessed.count().catch(() => 0);
  if (guessedCount > 0) {
    rows = Array.from({ length: guessedCount }, (_, i) => guessed.nth(i));
  } else {
    // Strategy B (2026-08-08 correction): derive rows by walking up from
    // each flight-number badge instead of guessing a container class name
    // — every flight row is anchored by an exact "VK200"-shaped token.
    const badges = page.getByText(/^[A-Z]{2}\d{2,4}$/);
    const badgeCount = await badges.count().catch(() => 0);
    for (let i = 0; i < badgeCount; i++) {
      const row = await walkUpToRowContainer(page, badges.nth(i));
      if (row) rows.push(row);
    }
  }

  if (rows.length === 0) await failWithDiagnostic(page, logTag, `No ${legLabel} flight rows found on the results page`);

  let rowIndex = 0;
  if (preferredTime && rows.length > 1) {
    // CORRECTED (2026-08-09, live): a real search returned 4 options and a
    // requested "06:45" matched none of them — confirmed live (video,
    // 2026-08-08) that KIU renders departure times WITHOUT a colon
    // ("0645"), while preferredTime arrives here formatted "HH:MM". A
    // plain substring check can never match across that formatting gap
    // regardless of how many real options exist. Compare digits-only on
    // both sides (falling back to the raw substring check too, in case a
    // different KIU deployment does include the colon).
    const digitsOnly = (s: string) => s.replace(/\D/g, "");
    const normalizedPreferred = digitsOnly(preferredTime);
    const texts = await Promise.all(rows.map((r) => r.textContent().catch(() => "")));
    const matchIndex = texts.findIndex((t) => {
      const text = t ?? "";
      return text.includes(preferredTime) || digitsOnly(text).includes(normalizedPreferred);
    });
    if (matchIndex === -1) {
      await failWithDiagnostic(
        page,
        logTag,
        `No ${legLabel} flight departs at "${preferredTime}" (${rows.length} option(s) shown, none matched)`
      );
    }
    rowIndex = matchIndex;
  } else if (rows.length > 1 && !preferredTime) {
    await failWithDiagnostic(
      page,
      logTag,
      `${rows.length} ${legLabel} flights found but no preferred time was given — resolve the ambiguity before booking`
    );
  }

  const row = rows[rowIndex];
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
    .getByText(new RegExp(`^${chosenClass}\\d+$`))
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

  // CORRECTED: "Country Prefix" is its own required (*) field — a
  // country-search dropdown, not free text — confirmed live (2026-08-08)
  // to sit right next to "Number". The old comment assumed this was
  // "already-defaulted"; it isn't, and leaving it empty would very likely
  // block the Phone section's own Confirm click on a required-field
  // validation error. Every booking so far is Nigeria-specific (route,
  // currency, phone format), same assumption VarsBookOnHold.ts's own phone
  // handling already makes, so this is hardcoded rather than derived from
  // the number itself.
  const prefixInput = page.getByLabel(/country prefix/i, { exact: false }).first();
  await prefixInput.click({ timeout: 5000 }).catch(() => {});
  await prefixInput.fill("Nigeria").catch(() => {});
  await page
    .getByText(/nigeria.*\+234|\+234.*nigeria/i)
    .first()
    .click({ timeout: 5000 })
    .catch(() => failWithDiagnostic(page, logTag, `Couldn't select "Nigeria (+234)" from the Country Prefix dropdown`));

  // Phone number itself — local digits only, the country prefix above
  // covers the +234.
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

  // CORRECTED: confirming email + phone does NOT auto-advance past the
  // Contact step — a separate "Confirm reservation" button is required to
  // reach the Confirmation/Save-reservation page, confirmed live
  // (2026-08-08) to skip "Extra Services" entirely. The old code jumped
  // straight from here to clicking "Save reservation", which isn't even
  // rendered yet at this point — this would have failed outright the
  // first time a real booking got this far.
  await page
    .getByRole("button", { name: /^confirm reservation$/i })
    .first()
    .click({ timeout: 10000 })
    .catch(() => failWithDiagnostic(page, logTag, `Couldn't find "Confirm reservation"`));
  await page.waitForTimeout(500);
}

// Confirmed live (2026-08-08 recording): after "Save reservation"
// succeeds, KIU navigates to a confirmation page (URL contains "/ipnr")
// showing a short (5-8 character) uppercase alphanumeric reference code
// right at the top — e.g. "JLTWRI" — next to print/email icons, and again
// nearby in "Created at <date> by <agent>" text. No confirmed selector for
// the exact element (a real DOM inspection was never done, only the
// recording), so this tries a few plausible containers before falling
// back to a body-text scan anchored near "Created at". Best-effort only —
// see the call site for why a capture miss must never be fatal.
async function capturePnr(page: import("playwright").Page, logTag: string): Promise<string | null> {
  try {
    const candidateContainer = page
      .locator('[class*="tag" i], [class*="locator" i], [class*="reference" i], h1, h2, h3')
      .filter({ hasText: /^[A-Z0-9]{5,8}$/ });
    const candidateCount = await candidateContainer.count().catch(() => 0);
    for (let i = 0; i < candidateCount; i++) {
      const text = (await candidateContainer.nth(i).textContent().catch(() => null))?.trim();
      if (text && /^[A-Z0-9]{5,8}$/.test(text)) return text;
    }

    // Fallback: scan visible body text for a standalone 6-character
    // uppercase code near "Created at", the nearby text confirmed live.
    const bodyText = (await page.evaluate(() => document.body.innerText).catch(() => "")) ?? "";
    const createdAtIndex = bodyText.search(/created at/i);
    const window = createdAtIndex >= 0 ? bodyText.slice(Math.max(0, createdAtIndex - 80), createdAtIndex) : bodyText.slice(0, 300);
    const match = window.match(/\b[A-Z0-9]{6}\b/);
    if (match) return match[0];
  } catch (err) {
    console.warn(`[${logTag}] PNR capture threw, continuing without one:`, err);
  }
  console.warn(`[${logTag}] couldn't confidently capture a reference code from the confirmation page`);
  return null;
}

// Spec 9.1 (confirmed live, still starts collapsed regardless of
// viewport): the Total Quote row starts collapsed — expand, read,
// collapse again, leaving the screen in its pre-save state. Never sums
// per-passenger fares manually; only trusts what KIU itself displays as
// the total.
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
