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

// Milestone hook — fired synchronously right as each stage of the
// automation begins, so a caller (connector-service's book-hold route) can
// mirror it into BookingJob.stage for the chat pollers to pick up. Kept as
// a plain string union (not importing @prisma/client's BookingStage type)
// so this browser-automation module has no dependency on the Prisma
// client — the values are still exactly the enum's members, checked by
// the one caller that writes them to the DB.
export type BookingStageName =
  | "SEARCHING"
  | "FLIGHT_FOUND"
  | "FILLING_PASSENGER_DETAILS"
  | "REVIEWING_ITINERARY"
  | "CREATING_HOLD";

export type OnBookingStage = (stage: BookingStageName) => void;

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

// Confirmed against Enugu Air's real passenger-title <select> options (the
// selectOption({ label }) call below throws if the label doesn't exist on
// that dropdown) — assumed, not yet independently verified, for the other
// VARS airlines sharing this same engine. The caller must resolve any other
// honorific (a supported-title check + gender-based fallback, or merging it
// into the passenger's name) before calling in — see
// ConversationOrchestrator.ts's passenger-title resolution.
export const ENUGU_SUPPORTED_TITLES = ["Mr", "Mrs", "Ms", "Dr", "Miss", "Mstr", "Prof", "Rev"] as const;

export interface BookOnHoldPassenger {
  title: string; // one of ENUGU_SUPPORTED_TITLES above
  firstName: string;
  lastName: string;
  mobileNumber: string; // local format, no leading 0 or country code — the +234 prefix is fixed on the form
  email: string;
}

// A passenger beyond the lead one on a multi-passenger PNR. Confirmed live
// (via screen recording) that the portal renders a DIFFERENT form per
// passenger type:
// - ADULT: title/firstName/lastName + their OWN mobile number field (no
//   email — email is collected once, from the lead passenger only). Per
//   explicit product direction, additional adults share the lead
//   passenger's phone number (the same value is typed into their own
//   mobile field, not left blank).
// - CHILD / INFANT: title/firstName/lastName + Date of Birth instead of a
//   mobile number — no phone/email field exists for these types at all.
//   The portal enforces the age band purely via the date-picker's allowed
//   year range (Child: roughly 2-12 years old; Infant: under 2), not a
//   validation message — dateOfBirth must already fall in the right band.
export interface AdditionalBookOnHoldPassenger {
  type?: "ADULT" | "CHILD" | "INFANT"; // defaults to ADULT when omitted
  title: string; // ADULT: one of ENUGU_SUPPORTED_TITLES; CHILD: Mstr/Mr/Miss/Ms; INFANT: usually Mr
  firstName: string;
  lastName: string;
  // Required for CHILD/INFANT, ignored for ADULT. "YYYY-MM-DD".
  dateOfBirth?: string;
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
  // "PREMIUM" compares every Premium Economy/Premium Economy Flex/
  // Business/Business Flex classband found on the fare page (matched by
  // keyword, not exact name — see selectCheapestFare) and books the
  // cheapest available one, ignoring fareClassPreference entirely. Omit or
  // "ECONOMY" keeps today's default behavior unchanged.
  cabinClass?: "ECONOMY" | "PREMIUM";
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
  // Passengers beyond the lead one, same PNR — see
  // AdditionalBookOnHoldPassenger for what's needed per type. Omit for a
  // single-passenger hold (today's default, unchanged). When present, the
  // Adults/Children/Infants counts on the search form are set from this
  // array's type breakdown (lead passenger always counts as one ADULT)
  // before Search runs.
  additionalPassengers?: AdditionalBookOnHoldPassenger[];
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

// Caches authenticated session cookies (Playwright's storageState) per
// airline, keyed by config.logTag, for the lifetime of the connector-service
// process — this is the one part of this system that IS a long-running
// process (unlike the Next.js/Vercel side calling into it), so this is a
// safe place for this pattern. Deliberately does NOT keep a live
// Browser/Context/Page alive across bookings — that risks unbounded memory
// growth, zombie Chromium processes if the service restarts uncleanly, or a
// shared page silently ending up in a broken state no one notices until the
// next booking mysteriously fails. Instead, every booking still gets a
// brand-new, fully disposable browser+context (closed in `finally` exactly
// as before) — the only thing reused is the cookie jar, seeded into that
// fresh context via `storageState`. If the cache is empty, stale by the
// heuristic below, or the live probe finds it's actually expired, this
// degrades to exactly today's behavior: a full fresh login. It only ever
// saves time; it can't make a booking less reliable than before.
const sessionCache = new Map<
  string,
  { storageState: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>; savedAt: number }
>();
// A conservative guess, not independently confirmed against the real VARS
// portal's actual session lifetime — used only as a cheap first-pass filter
// to skip an obviously-stale entry without even trying it. The real check
// is always the live LOGGED_IN_MARKER probe below; this number being wrong
// in either direction only costs a little speed, never correctness.
const SESSION_MAX_AGE_MS = 25 * 60 * 1000;

// Establishes a logged-in page, reusing a cached session when one exists
// and still checks out live, otherwise falling back to a full login —
// identical mechanism/selectors as before, just conditionally skipped.
export async function establishSession(
  browser: import("playwright").Browser,
  loginUrl: string,
  requirementsUrl: string,
  credentials: BookOnHoldCredentials,
  logTag: string,
  // Confirmed live: cache was keyed by logTag ALONE (e.g. "enugu-booking"),
  // shared across every account and every job in the process — a queued
  // pool job could reuse a DIFFERENT account's cookies, or a session the
  // server had already superseded by a later login, and get rejected
  // downstream (a real "Invalid password" at the payment step traced back
  // to exactly this). Keying by account username fixes the cross-account
  // mixup; forceFreshLogin additionally skips the cache entirely — used by
  // the worker pool per explicit product direction: every pooled booking
  // gets a brand-new login, never a reused session, full stop.
  forceFreshLogin = false
): Promise<{ context: import("playwright").BrowserContext; page: import("playwright").Page }> {
  const cacheKey = `${logTag}:${credentials.username}`;
  const cached = forceFreshLogin ? undefined : sessionCache.get(cacheKey);
  const cacheUsable = !!cached && Date.now() - cached.savedAt < SESSION_MAX_AGE_MS;

  const newContext = () => {
    const ctx = browser.newContext({
      viewport: { width: 1280, height: 900 },
      ...(cacheUsable ? { storageState: cached!.storageState } : {}),
    });
    return ctx;
  };

  let context = await newContext();
  context.on("dialog", (dialog) => {
    console.log(`[${logTag}] dialog appeared: "${dialog.message()}"`);
    dialog.dismiss().catch(() => {});
  });
  let page = await context.newPage();

  if (cacheUsable) {
    // Probe with a short timeout — if the cached cookies are still good
    // this resolves almost immediately (no login form to wait through); if
    // they've expired, fail fast rather than eating the full 20s
    // login-marker timeout for a session already suspected dead.
    console.log(`[${logTag}] trying cached session`);
    await page.goto(requirementsUrl, { waitUntil: "domcontentloaded" });
    const stillLoggedIn = await page
      .locator(LOGGED_IN_MARKER)
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);

    if (stillLoggedIn) {
      console.log(`[${logTag}] cached session still valid, skipped login`);
      return { context, page };
    }

    console.log(`[${logTag}] cached session expired, logging in fresh`);
    sessionCache.delete(cacheKey);
    await context.close().catch(() => {});
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.on("dialog", (dialog) => {
      console.log(`[${logTag}] dialog appeared: "${dialog.message()}"`);
      dialog.dismiss().catch(() => {});
    });
    page = await context.newPage();
  }

  console.log(`[${logTag}] logging in`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#txtSineCode").fill(credentials.username);
  await page.locator("#txtPassword").fill(credentials.password);
  await page.locator("#btnOk").click();
  await page.locator(LOGGED_IN_MARKER).waitFor({ state: "visible", timeout: 20000 });
  // Written regardless of forceFreshLogin — this fresh login is real and
  // correctly keyed per-account now, so it's still a valid, safe cache
  // entry for some OTHER (non-pooled) caller on this same account later.
  // forceFreshLogin only ever skips the READ above, never the write.
  sessionCache.set(cacheKey, { storageState: await context.storageState(), savedAt: Date.now() });

  // Always return with the page already sitting on requirementsUrl, same
  // as the cached-session path above — the caller never needs to know or
  // branch on which path was taken.
  //
  // Confirmed live (Rano Air): a direct goto to the agent-portal
  // requirements URL without a "VARSSessionID" query param 404s server-side
  // (redirects to .../CustomerPanels/Requirements.aspx, which doesn't
  // exist) even with valid session cookies — this deployment's routing
  // apparently keys off the URL param, not just the cookie, unlike Enugu
  // Air (no such param at all, works fine without it) and United Nigeria
  // (has the param post-login but doesn't actually require it). Carrying
  // forward whatever VARSSessionID the login redirect landed on (present
  // for United and Rano, absent for Enugu) covers all three without
  // needing an airline-specific branch here.
  await page.goto(withCarriedSessionId(requirementsUrl, page.url()), { waitUntil: "domcontentloaded" });
  return { context, page };
}

// Sets the Adults/Children/Infants counts on the search form before the
// initial Search/Continue click. Confirmed live (Enugu Air, via screen
// recording) that this exact "Refine Search" panel has three separate
// dropdowns labeled precisely "Adults :", "Children :", "Infants :" — #Adults
// is tried first for each as the most likely id given the platform's plain
// "#Origin"/"#Destination" naming convention, with broader fallbacks tried
// after. Fails LOUDLY with a diagnostic dump rather than silently proceeding
// with the form's default counts while claiming to book more/fewer — a
// wrong silent guess here would risk holding the wrong number of seats (or
// the wrong passenger mix) for real money.
async function setPassengerCounts(
  page: import("playwright").Page,
  counts: { adults: number; children: number; infants: number },
  logTag: string
): Promise<void> {
  const fields: Array<{ key: keyof typeof counts; candidates: string[] }> = [
    { key: "adults", candidates: ["#Adults", "#NoOfAdults", "#txtAdults", "#ddlAdults", "select[name='Adults']", "select[name*='dult' i]"] },
    { key: "children", candidates: ["#Children", "#NoOfChildren", "#txtChildren", "#ddlChildren", "select[name='Children']", "select[name*='hild' i]"] },
    { key: "infants", candidates: ["#Infants", "#NoOfInfants", "#txtInfants", "#ddlInfants", "select[name='Infants']", "select[name*='nfant' i]"] },
  ];

  for (const field of fields) {
    const value = counts[field.key];
    // Adults defaults to 1 on the form already; Children/Infants default to
    // 0 — only touch a dropdown when a non-default count is actually needed,
    // same "don't exercise a control that's never been confirmed unless we
    // have to" caution as before.
    const isDefault = field.key === "adults" ? value <= 1 : value <= 0;
    if (isDefault) continue;

    let found = false;
    for (const sel of field.candidates) {
      const locator = page.locator(sel);
      if (await locator.count().catch(() => 0)) {
        await locator.selectOption(String(value)).catch(() => locator.fill(String(value)));
        console.log(`[${logTag}] set ${field.key} count to ${value} via "${sel}"`);
        found = true;
        break;
      }
    }
    if (found) continue;

    const diagnostic = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("select, input"))
        .map((el) => ({ tag: el.tagName, id: el.id, name: (el as HTMLInputElement).name }))
        .filter((f) => f.id || f.name)
    );
    console.error(`DIAGNOSTIC [${logTag}] no ${field.key} control found among: ${JSON.stringify(diagnostic).slice(0, 2000)}`);
    throw new Error(
      `${value} ${field.key} requested but no ${field.key}-count control was found on the search form — this needs a one-time live check of the real field id before this passenger mix can be booked on this airline.`
    );
  }
}

function withCarriedSessionId(targetUrl: string, currentPageUrl: string): string {
  const sessionId = new URL(currentPageUrl).searchParams.get("VARSSessionID");
  if (!sessionId) return targetUrl;
  const url = new URL(targetUrl);
  if (!url.searchParams.has("VARSSessionID")) url.searchParams.set("VARSSessionID", sessionId);
  return url.toString();
}

export async function bookVarsPlatformOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest,
  config: VarsAirlineBookingConfig,
  onStage?: OnBookingStage,
  // See establishSession's own doc — the worker pool sets this true so a
  // pooled booking never reuses a cached session (a stale/superseded one
  // traced back to a real "Invalid password" failure at the payment step).
  forceFreshLogin = false
): Promise<BookOnHoldResult> {
  const { logTag, loginUrl, requirementsUrl, mmbUrl, airlineLabel } = config;
  const reportStage = (stage: BookingStageName) => {
    try {
      onStage?.(stage);
    } catch (err) {
      // A stage-reporting hiccup (e.g. a DB write failing) must never abort
      // the booking itself — the automation is the thing that actually
      // matters, progress messaging is best-effort on top of it.
      console.warn(`[${logTag}] onStage(${stage}) callback threw, continuing:`, err);
    }
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const { context, page } = await establishSession(browser, loginUrl, requirementsUrl, credentials, logTag, forceFreshLogin);

    // --- Search (same public CustomerPanels flow, now under the agent
    // session) --- establishSession already leaves the page sitting on
    // requirementsUrl either way (cached-session probe, or the fresh-login
    // path's own navigation there) — no re-navigation needed here.
    reportStage("SEARCHING");
    console.log(`[${logTag}] searching ${request.origin}->${request.destination}`);
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

    const extraAdults = request.additionalPassengers?.filter((p) => !p.type || p.type === "ADULT").length ?? 0;
    const childrenCount = request.additionalPassengers?.filter((p) => p.type === "CHILD").length ?? 0;
    const infantsCount = request.additionalPassengers?.filter((p) => p.type === "INFANT").length ?? 0;
    const totalPassengers = 1 + extraAdults + childrenCount + infantsCount;
    await setPassengerCounts(page, { adults: 1 + extraAdults, children: childrenCount, infants: infantsCount }, logTag);

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
    // Was a flat 15s with no diagnostic on failure — confirmed live (a real
    // "Lagos to Abuja tomorrow" search) that this is genuinely too tight
    // under real portal latency, and the failure carried zero page-state
    // info to root-cause from (just Playwright's own generic timeout
    // text). Raised to match the other multi-step-search waits in this
    // file (20-30s), and now dumps page state into the thrown error same
    // as every other failure point fixed this session.
    await page
      .locator(".tab-pane.active .flt-panel")
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(async (err) => {
        const diagnostic = await page.evaluate(() => ({
          url: window.location.href,
          tabPaneCount: document.querySelectorAll(".tab-pane").length,
          activeTabPaneCount: document.querySelectorAll(".tab-pane.active").length,
          bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1200),
        }));
        console.error(`[${logTag}] flight results panel never appeared. DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
        throw new Error(
          `Flight results never appeared after searching ${request.origin}->${request.destination}. Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`
        );
      });
    reportStage("FLIGHT_FOUND");
    // Summed as a FALLBACK total — the hold's own confirmation page doesn't
    // always show a "Total Payable" line the same way the actual payment
    // page does (confirmed live: the wording differs), so parseConfirmation
    // falls back to this real, DOM-read fare sum rather than leaving the
    // amount blank whenever its own regex doesn't find a match.
    let fareAmountFallback = 0;
    const PREMIUM_BUSINESS_FALLBACK: FareSelection = {
      mode: "category",
      keywords: ["premium", "business"],
      categoryLabel: "Premium/Business",
    };
    const fareSelection: FareSelection =
      request.cabinClass === "PREMIUM"
        ? PREMIUM_BUSINESS_FALLBACK
        : { mode: "explicit", classbands: request.fareClassPreference };
    for (let leg = 0; leg < legCount; leg++) {
      // leg 0 is outbound, leg 1 (round trip only) is the return — each is
      // an independent search with its own possible ambiguity, so each
      // gets its own preferred time rather than reusing one value for both.
      const preferredTime = leg === 0 ? request.preferredDepartureTime : request.preferredReturnTime;
      let selectedFare;
      try {
        selectedFare = await selectCheapestFare(page, leg, fareSelection, preferredTime, logTag);
      } catch (err) {
        // Economy is the default and Premium/Business is request-only — EXCEPT
        // when Economy is sold out entirely, in which case Premium/Business is
        // the only seat actually available on this route, so fall back to it
        // rather than failing the hold outright. Narrowly matched to the
        // specific "nothing available" error (selectCheapestFare's own
        // message) so an unrelated failure (e.g. unresolved time ambiguity)
        // still propagates instead of being silently retried.
        const economySoldOut =
          fareSelection.mode === "explicit" && err instanceof Error && /are available on leg/.test(err.message);
        if (!economySoldOut) throw err;
        console.log(
          `[${logTag}] leg ${leg}: Economy sold out, falling back to Premium/Business as the only remaining cabin — ${
            err instanceof Error ? err.message : err
          }`
        );
        selectedFare = await selectCheapestFare(page, leg, PREMIUM_BUSINESS_FALLBACK, preferredTime, logTag);
      }
      fareAmountFallback += selectedFare.amount;
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
      // Reduced from 300ms — the spinner-hidden wait above already
      // confirms the removal's postback finished; this is just a small
      // margin for the list DOM to re-render before the next iteration's
      // index-0 click, not a real settle time we've seen fail at 150ms.
      await page.waitForTimeout(150);
    }

    await clickNext(page, "products", logTag);

    // --- Passenger details ---
    reportStage("FILLING_PASSENGER_DETAILS");
    console.log(`[${logTag}] filling passenger details`);
    await page.locator("#passenger1firstname").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#passenger1title").selectOption({ label: request.passenger.title });
    await page.locator("#passenger1firstname").fill(request.passenger.firstName);
    await page.locator("#passenger1lastname").fill(request.passenger.lastName);
    await page.locator("#passenger1mobilephonenumber").fill(request.passenger.mobileNumber.replace(/^0+/, ""));
    await page.locator("#passenger1emailaddress").fill(request.passenger.email);
    await page.locator("#passenger1emailaddressverification").fill(request.passenger.email);
    await page.locator("#passenger1specialservicerequest0").click();

    // Additional passengers on the same PNR — same form, indexed fields
    // (passenger2title/firstname/lastname, passenger3..., following the
    // confirmed passenger1 naming convention), but the fields touched per
    // passenger depend on type (confirmed live via screen recording):
    // - ADULT: also has its own mobilephonenumber field — filled with the
    //   LEAD passenger's number per explicit product direction (shared
    //   contact info), not left blank.
    // - CHILD/INFANT: has Date of Birth instead of a phone field — no
    //   phone/email exists for these types at all.
    if (request.additionalPassengers?.length) {
      for (let i = 0; i < request.additionalPassengers.length; i++) {
        const idx = i + 2;
        const p = request.additionalPassengers[i];
        const type = p.type ?? "ADULT";
        console.log(`[${logTag}] filling passenger ${idx} details (${type})`);
        await page.locator(`#passenger${idx}title`).selectOption({ label: p.title });
        await page.locator(`#passenger${idx}firstname`).fill(p.firstName);
        await page.locator(`#passenger${idx}lastname`).fill(p.lastName);
        if (type === "ADULT") {
          await page.locator(`#passenger${idx}mobilephonenumber`).fill(request.passenger.mobileNumber.replace(/^0+/, ""));
        } else {
          if (!p.dateOfBirth) {
            throw new Error(`Passenger ${idx} is a ${type} but has no dateOfBirth set — required for this passenger type.`);
          }
          await fillPassengerDateOfBirth(page, idx, p.dateOfBirth, logTag);
        }
      }
    }

    reportStage("REVIEWING_ITINERARY");

    // The payment section is a Bootstrap accordion (#pay-accordion) of
    // payment-option panels. The VISIBLE panel-heading TEXT for the hold
    // option is wildly different per airline — confirmed live: Enugu says
    // "Book Now, Pay Later", United says "I want to book on hold", Rano
    // says "I want to Buy Now Pay Later" — so matching on heading text (an
    // earlier version of this code did, hardcoded to Enugu's exact
    // wording) silently finds NOTHING on United/Rano. The underlying radio
    // VALUE, by contrast, is confirmed identical across all three:
    // "BuyNowPayLater". Match on that instead — airline-independent by
    // construction, and it can never resolve to "Invoice" or any other
    // option since we're searching for this exact literal value, not
    // "whichever panel looks right".
    const holdRadioSelector = 'input[name="optpaymentformofpayment"][value="BuyNowPayLater"]';
    const holdRadioCount = await page.locator(holdRadioSelector).count();
    if (holdRadioCount === 0) {
      // No page.evaluate diagnostic existed here before — this failure
      // point threw completely blind (confirmed live: a run under the
      // worker pool's queue failed here with zero data to root-cause from).
      // Same "embed diagnostic in the thrown message" pattern already
      // proven for the Record Locator and confirmation-wait failures —
      // dumps URL, every payment-option radio actually present, and
      // visible page text, so the next occurrence is diagnosable from the
      // chat error text alone.
      const diagnostic = await page.evaluate(() => ({
        url: window.location.href,
        paymentRadios: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="optpaymentformofpayment"]')).map((r) => ({
          value: r.value,
          checked: r.checked,
        })),
        visibleHeadings: Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, .panel-heading")).map((h) =>
          (h.textContent ?? "").trim()
        ).filter(Boolean).slice(0, 20),
        bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1200),
      }));
      console.error(`[${logTag}] "BuyNowPayLater" payment option missing. DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
      throw new Error(
        `No "BuyNowPayLater" payment option found on this page — refusing to guess at a different one. Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`
      );
    }

    // The radio input itself is CSS-hidden (zero-size) with no wrapping
    // <label> — the real, human-facing control is the ".panel-heading"
    // above it, and clicking it (a genuine click, not the radio) reveals a
    // REQUIRED "#txtAgentPassword" field that must be filled with the
    // agent's own login password before the hold can actually be
    // submitted. Skipping this (as an earlier version of this code did,
    // via direct radio.checked + dispatchEvent with no heading click)
    // submitted with that field empty — functionally created a real PNR in
    // one live test, but does not match the actual portal flow and risks
    // breaking if that leniency is ever tightened server-side.
    // The heading click TOGGLES the panel (Bootstrap accordion) — if the
    // hold option already happens to be the default-expanded one
    // (confirmed live it isn't always "Invoice" by default), clicking it
    // again would COLLAPSE it and hide the password field instead of
    // revealing it. Only click if the field isn't already visible.
    const passwordField = page.locator("#txtAgentPassword");
    if (!(await passwordField.isVisible().catch(() => false))) {
      // Plain JS closest()/querySelector() here rather than a Playwright
      // xpath ancestor lookup — confirmed live that an xpath like
      // ancestor::*[contains(@class,'panel')] matches the WRONG (too
      // narrow) ancestor, since "panel-body"/"panel-heading" themselves
      // contain the substring "panel". closest(".panel") does real
      // word-boundary class-token matching and doesn't have that problem.
      const headingClicked = await page.evaluate((selector) => {
        const radio = document.querySelector<HTMLInputElement>(selector);
        const panel = radio?.closest(".panel");
        const heading = panel?.querySelector<HTMLElement>(".panel-heading");
        if (!heading) return false;
        heading.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }, holdRadioSelector);
      if (!headingClicked) {
        throw new Error('Found the "BuyNowPayLater" radio but not its enclosing panel-heading to click');
      }
      await passwordField.waitFor({ state: "visible", timeout: 10000 });
    }
    await passwordField.fill(credentials.password);

    // The heading click above only expands/collapses the accordion panel —
    // confirmed live it does NOT also select the underlying radio (the
    // submit call came back "ErrorMsg":"Select Form Of Payment" even with
    // the panel expanded and password filled). Explicitly set it — same
    // direct-state-set approach as before (plain .click() doesn't reliably
    // stick on this CSS-hidden control).
    await page.locator(holdRadioSelector).first().evaluate((radio: HTMLInputElement) => {
      radio.checked = true;
      radio.dispatchEvent(new Event("click", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    });

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
    reportStage("CREATING_HOLD");
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
    // Short sanity buffer only — NOT the sole safety net for catching a
    // validation error. Previously this was a flat, unconditional 2000ms
    // wait on every single booking, after which the listener was detached;
    // that could also silently miss a slower validation response arriving
    // just after the 2s cutoff. Now the listener stays attached through the
    // confirmation-page wait below too, and is checked again there — so
    // this is both faster in the common case and strictly more robust for
    // a slow validation response, not a speed/safety tradeoff.
    await page.waitForTimeout(500);
    if (validationError) {
      page.off("response", validationListener);
      throw new Error(`Booking validation failed: ${validationError}`);
    }

    // Wait for the confirmation summary page to appear. Scaled by party
    // size — confirmed live that a multi-passenger hold (especially with
    // children, each needing their own record validated server-side) can
    // genuinely take longer than the flat 30s a single-passenger hold
    // needs. First scaling attempt (+12s/passenger, capped 90s) still
    // wasn't enough for a real 5-passenger family booking, so this is more
    // generous — +20s per passenger beyond the first, capped at 150s — and
    // still bounded so a genuinely stuck/malformed request fails in
    // reasonable time rather than hanging indefinitely. This is an async
    // background job (connector-service), not a request holding an HTTP
    // connection open, so a longer wait here has no other infrastructure
    // ceiling to worry about.
    const confirmationTimeoutMs = Math.min(30000 + (totalPassengers - 1) * 20000, 150000);
    console.log(`[${logTag}] waiting up to ${confirmationTimeoutMs}ms for confirmation (party size ${totalPassengers})`);
    await page
      .locator("text=/PNR|Booking Reference|TTL Payment Instructions|Manage My Booking/i")
      .first()
      .waitFor({ state: "visible", timeout: confirmationTimeoutMs })
      .catch(async (err) => {
        if (validationError) throw new Error(`Booking validation failed: ${validationError}`);
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
        // Diagnostic goes INTO the thrown message (not just console.error)
        // so it surfaces all the way to the chat error text — no server-log
        // access needed to see what was actually on the page when this
        // gave up, same reasoning as the issue-ticket diagnostics.
        throw new Error(
          `Confirmation page never appeared after ${confirmationTimeoutMs}ms (party size ${totalPassengers}). Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`
        );
      });
    page.off("response", validationListener);
    if (validationError) {
      throw new Error(`Booking validation failed: ${validationError}`);
    }

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
    // Parse the PNR out of the raw text immediately (cheap regex, no
    // screenshot needed for it) so verification can start right away —
    // it runs on its own fresh page in the same context, fully independent
    // of the screenshot below, so there's no reason to run them one after
    // the other. Previously this was sequential: wait for the screenshot,
    // THEN separately wait for verification (full navigation + form fill +
    // networkidle). Running them concurrently costs only the slower of the
    // two instead of the sum of both.
    const pnr = parseConfirmation(raw, null, fareAmountFallback).pnr;

    // Independent verification, not just trusting the in-flow page — see
    // the mmbUrl comment above for exactly why that page alone isn't
    // trustworthy (confirmed for Enugu Air: it can show booking-management
    // nav chrome with no actual booking behind it).
    console.log(`[${logTag}] verifying PNR "${pnr}" via public Manage My Booking lookup (in parallel with screenshot capture)`);
    const [screenshot, verified] = await Promise.all([
      // Best-effort — a screenshot failure must never turn a real
      // successful hold into a failed job, so swallow and fall back to null.
      page.screenshot({ fullPage: true }).catch(() => null),
      pnr ? verifyBookingReference(context, mmbUrl, pnr, request.passenger.lastName, logTag) : Promise.resolve(false),
    ]);
    const result = parseConfirmation(raw, screenshot, fareAmountFallback);
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

// Sets a Child/Infant passenger's Date of Birth. Confirmed live (via screen
// recording) that this control is a text box + calendar-icon date picker —
// the SAME jQuery UI datepicker widget already used for departuredate/
// returndate above, just on a different field id (not independently
// confirmed — every id here is a best-effort guess following the confirmed
// passengerNfirstname/lastname naming convention). The portal enforces the
// age band by restricting the picker's own year dropdown (Child: ~2014-2024,
// Infant: ~2024-2026 relative to "today" in the recording) rather than a
// validation message — so an out-of-band dateOfBirth would simply fail to
// set here rather than surface a clean error; the caller is responsible for
// supplying a plausible date for the passenger's stated type.
async function fillPassengerDateOfBirth(page: import("playwright").Page, idx: number, dateISO: string, logTag: string): Promise<void> {
  const { y, m, d } = dateParts(dateISO);
  const candidates = [`#passenger${idx}dateofbirth`, `#passenger${idx}dob`, `#Passenger${idx}DateOfBirth`];
  for (const sel of candidates) {
    if (await page.locator(sel).count().catch(() => 0)) {
      const ok = await page.evaluate(
        ({ selector, y, m, d }) => {
          const w = window as unknown as { $: (sel: string) => { datepicker: (op: string, d: Date) => void } };
          try {
            w.$(selector).datepicker("setDate", new Date(y, m, d));
            return true;
          } catch {
            return false;
          }
        },
        { selector: sel, y, m, d }
      );
      if (ok) {
        console.log(`[${logTag}] set passenger ${idx} date of birth (${dateISO}) via "${sel}"`);
        return;
      }
    }
  }
  throw new Error(
    `Could not find/set a Date of Birth control for passenger ${idx} (tried ${candidates.join(", ")}) — this needs a one-time live check of the real field id before Child/Infant bookings can work on this airline.`
  );
}

// Two selection modes: "explicit" is the original behavior — compare
// exactly the two named classbands (airline-verified, e.g. Enugu's
// "Economy Promo"/"Economy Saver") and pick whichever is cheaper.
// "category" is for Premium/Business cabin requests — the exact
// data-classband codes for those tiers were never live-verified (and the
// visible fare-card names have already been seen to drift from the coded
// value, e.g. "Economy Saver" vs. a page showing "Economy Standard"), so
// instead of guessing exact strings, every classband card on the panel is
// enumerated and matched by keyword against its readable name — safer
// than risking a wrong-tier silent selection.
type FareSelection =
  | { mode: "explicit"; classbands: string[] }
  | { mode: "category"; keywords: string[]; categoryLabel: string };

async function selectCheapestFare(
  page: import("playwright").Page,
  legIndex: number,
  fareSelection: FareSelection,
  preferredDepartureTime: string | undefined,
  logTag: string
): Promise<{ band: string; amount: number }> {
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
  // Enumerate every classband card on the panel (not just the two
  // originally-named ones) — needed for "category" mode, and harmless for
  // "explicit" mode since it's filtered right back down to the same named
  // pair. Card identity is tracked by index rather than the data-classband
  // attribute value, since that attribute isn't guaranteed present on
  // every deployment/tier (VarsFlightSearch.ts already falls back to a
  // ".class-band-name" text element for the same reason).
  const winner = await panel.evaluate((panelEl, selection) => {
    const cards = Array.from(panelEl.querySelectorAll<HTMLElement>('[class*="classband-panel"]'));
    const candidates = cards.map((card, index) => {
      const name =
        card.getAttribute("data-classband") ?? card.querySelector(".class-band-name")?.textContent?.trim() ?? "Unknown";
      const priceEl = card.querySelector<HTMLElement>("[data-original-amount]");
      const rawAmount = priceEl?.getAttribute("data-original-amount");
      // A sold-out fare can still show a price (data-original-amount) but
      // has no clickable "Select this fare" element — same soldOut signal
      // VarsFlightSearch.ts's extractFlightOptions already uses. Confirmed
      // via a real run: picking a sold-out band by price alone hung
      // waiting for .flight-class-select-fare-text that doesn't exist.
      const soldOut = !!card.querySelector(".seats-none") || /sold out/i.test(card.textContent ?? "");
      const amount = rawAmount && !soldOut ? parseFloat(rawAmount) : null;
      return { index, name, amount };
    });
    const matching =
      selection.mode === "explicit"
        ? candidates.filter((c) => selection.classbands.includes(c.name))
        : candidates.filter((c) => selection.keywords.some((kw) => c.name.toLowerCase().includes(kw)));
    const available = matching.filter((c) => c.amount != null);
    if (available.length === 0) return null;
    available.sort((a, b) => (a.amount as number) - (b.amount as number));
    return available[0] as { index: number; name: string; amount: number };
  }, fareSelection);

  if (!winner) {
    const diagnostic = await panel.evaluate((panelEl) =>
      Array.from(panelEl.querySelectorAll('[class*="classband-panel"]')).map((card) => ({
        name: card.getAttribute("data-classband") ?? card.querySelector(".class-band-name")?.textContent?.trim() ?? "Unknown",
        hasSelectText: !!card.querySelector(".flight-class-select-fare-text"),
        text: (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      }))
    );
    const wanted =
      fareSelection.mode === "explicit"
        ? fareSelection.classbands.join(", ")
        : `${fareSelection.categoryLabel} (matching: ${fareSelection.keywords.join("/")})`;
    console.log(`DIAGNOSTIC [${logTag}] leg ${legIndex} classbands: ${JSON.stringify(diagnostic)}`);
    throw new Error(
      `None of the requested fares (${wanted}) are available on leg ${legIndex}. On-page classbands: ${diagnostic
        .map((d) => d.name)
        .join(", ")}`
    );
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
  const clicked = await panel.evaluate((panelEl, cardIndex) => {
    const cards = Array.from(panelEl.querySelectorAll<HTMLElement>('[class*="classband-panel"]'));
    const card = cards[cardIndex];
    if (!card) return false;
    const selectEl = card.querySelector<HTMLElement>(".flight-class-select-fare-text");
    if (selectEl) {
      selectEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, winner.index);

  if (!clicked) {
    throw new Error(`"${winner.name}" fare card not found on leg ${legIndex}`);
  }

  // Best-effort confirmation — whichever signal this deployment actually
  // uses (Enugu's toggled span, or United's "panel-active" class on the
  // card itself). Non-blocking either way: a deployment using neither just
  // times out and proceeds, same as before.
  const winnerCard = panel.locator('[class*="classband-panel"]').nth(winner.index);
  await Promise.race([
    winnerCard.locator(".flight-class-selected-text").waitFor({ state: "visible", timeout: 8000 }),
    // United's mechanism marks the card ITSELF active (not a descendant) —
    // checked for presence anywhere on the panel rather than pinned to
    // winner.index, since this is a best-effort, non-blocking signal only.
    panel.locator('[class*="classband-panel"].panel-active').first().waitFor({ state: "attached", timeout: 8000 }),
  ]).catch(() => {
    /* best-effort confirmation — some deployments may not signal selection this way */
  });

  return { band: winner.name, amount: winner.amount };
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

function parseConfirmation(raw: string, screenshot: Buffer | null, fareAmountFallback?: number): BookOnHoldResult {
  // VARS confirmation pages show the PNR as a short, standalone
  // alphanumeric code near "Manage My Booking" — same pattern documented
  // in the XEJET SOP screenshots for this shared platform (e.g.
  // "AAPR6Z"). Best-effort regex; `raw` is always returned in full so a
  // failed match is still diagnosable rather than a silent black box.
  const pnrMatch = raw.match(/\b([A-Z0-9]{5,8})\b(?=\s*(?:\n|$|\s{2,}))/);
  const holdMatch = raw.match(/held until\s+([0-9A-Za-z: ]+?)(?:\s*\(|\.|$)/i);
  // "Total Payable: X NGN" is confirmed on the actual PAYMENT page
  // (mmbpayment.aspx) but NOT reliably present with that exact wording on
  // the HOLD's own confirmation page — a couple of broader phrasings are
  // tried too before falling back to the fare amount actually read from
  // the fare-selection step's DOM (data-original-amount), which is real
  // captured data rather than a guess, so the amount is never silently
  // blank just because this page's wording doesn't match "Total Payable".
  const totalMatch =
    raw.match(/Total Payable:?\s*([\d,]+)\s*([A-Z]{3})/i) ??
    raw.match(/Amount outstanding:?\s*([\d,]+)\s*([A-Z]{3})/i) ??
    raw.match(/Flights? Total:?\s*([\d,]+)\s*([A-Z]{3})/i);

  const totalPayable = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : (fareAmountFallback ?? null);
  const currency = totalMatch ? totalMatch[2].toUpperCase() : fareAmountFallback != null ? "NGN" : null;

  return {
    pnr: pnrMatch ? pnrMatch[1] : null,
    holdExpiresAt: holdMatch ? holdMatch[1].trim() : null,
    totalPayable,
    currency,
    raw,
    screenshot,
  };
}
