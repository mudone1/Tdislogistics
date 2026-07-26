import { chromium, type Browser, type Page } from "playwright";
import type { FareClassOption, FlightOption, FlightSearchQuery, FlightSearchResult } from "../../core/types";

// Shared automation for airlines running the VARS booking engine
// (booking.<airline>.com/.../CustomerPanels/requirementsBS.aspx ->
// .../b/FlightCal.aspx). Confirmed identical DOM/CSS structure across
// Enugu Air and United Nigeria — same white-label platform, different
// skin. Each airline module is a thin wrapper supplying its own
// requirements URL and display label.

// The date strip only ever pages forward from "today" in ~4-7 day jumps, so this
// is generous enough for any realistic search horizon without looping forever
// if a date is unreachable (e.g. no schedule that far out).
const MAX_DAY_FORWARD_CLICKS = 60;

// Backstop against the caller (a Vercel function with a 60s hard ceiling —
// confirmed live via a production 504 with "Task timed out after 60
// seconds" on /api/assistant/quote) getting killed with zero response. Each
// forward-page attempt can legitimately wait up to 5s for its debounced
// postback (see below) — 60 attempts x 5s would be 300s worst case, so
// MAX_DAY_FORWARD_CLICKS alone doesn't bound wall-clock time. This deadline
// does: it comfortably covers the observed happy path (a real date 5 days
// out resolved in one ~5-12s forward-page attempt) while guaranteeing this
// function fails fast, well inside the 60s budget, for a date genuinely
// beyond an airline's published schedule.
// Left as headroom below 60s: the forward-paging phase this deadline bounds
// is followed by up to 3 target-tab click attempts (12s + 6s + 6s = 24s
// worst case — see navigateToDate), plus ~11-13s of surrounding
// form-fill/submit/extraction overhead (measured live) — 15s + 24s + 13s ≈
// 52s, leaving real margin under the 60s ceiling for network jitter and
// connector-service cold starts.
const DATE_NAVIGATION_DEADLINE_MS = 15000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Resource types that never affect the booking data we scrape — blocking
// them cuts real network/render time per search (measured meaningfully
// faster in profiling: fewer requests waiting on images/fonts/analytics
// that the page loads regardless of whether anyone can see them).
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media"]);
const BLOCKED_HOST_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com",
  "hotjar.com",
  "clarity.ms",
  "bing.com",
];

export interface VarsAirlineConfig {
  logTag: string;
  requirementsUrl: string;
  airlineLabel: string;
}

// One Chromium process per connector-service instance, reused across every
// search — launching a fresh browser per request was real, measurable
// overhead (process startup) on top of the actual page work. Each search
// still gets its own isolated context (cookies/session), just not its own
// OS process. If the shared process dies (crash, manual kill, etc.) the
// next search transparently relaunches it.
let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  sharedBrowser.on("disconnected", () => {
    sharedBrowser = null;
  });
  return sharedBrowser;
}

export async function searchVarsPlatformFlights(
  query: FlightSearchQuery,
  config: VarsAirlineConfig
): Promise<FlightSearchResult> {
  const { logTag, requirementsUrl, airlineLabel } = config;
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  let lastMark = t0;
  const mark = (stage: string) => {
    const now = Date.now();
    timings[stage] = now - lastMark;
    lastMark = now;
  };

  const browser = await getBrowser();
  mark("browserAcquire");

  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  context.on("dialog", (dialog) => {
    console.log(`[${logTag}] DIALOG appeared: "${dialog.message()}" - dismissing`);
    dialog.dismiss().catch(() => {});
  });

  await context.route("**/*", (route) => {
    const req = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) return route.abort();
    if (BLOCKED_HOST_PATTERNS.some((host) => req.url().includes(host))) return route.abort();
    return route.continue();
  });

  try {
    const page = await context.newPage();

    console.log(`[${logTag}] navigating to requirements form`);
    await page.goto(requirementsUrl, { waitUntil: "domcontentloaded" });
    mark("navigateToForm");

    console.log(`[${logTag}] selecting origin: ${query.origin}`);
    // Same fail-fast reasoning as the destination check below: calling
    // selectOption() directly on a value the <select> never offers makes
    // Playwright's actionability retry blindly burn its full ~30s timeout
    // (confirmed on real traffic: XeJet only flies LOS<->ABV, so a KAN
    // origin request hung for 31s before failing with an opaque timeout).
    const originFound = await page
      .locator("#Origin")
      .locator(`option[value="${query.origin}"]`)
      .waitFor({ state: "attached", timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (!originFound) {
      const availableOrigins = await page
        .locator("#Origin option")
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      throw new Error(
        `${airlineLabel} doesn't fly from ${query.origin} (origins offered: ${availableOrigins.join(", ") || "none"})`
      );
    }

    await page.locator("#Origin").selectOption(query.origin);

    // Destination options are repopulated by the origin's change handler, so
    // wait for the target option to actually exist before selecting it.
    // state: "attached" (DOM presence), NOT the default "visible" — a
    // native <option> inside a <select> never reports as visible under
    // Playwright's layout-based check (no bounding box; the OS renders the
    // dropdown outside page layout), so the default was unconditionally
    // eating the full 15s timeout on every single search, across every
    // airline sharing this module. Confirmed via real timing logs: this
    // one line was ~60% of total search time.
    const destinationFound = await page
      .locator("#Destination")
      .locator(`option[value="${query.destination}"]`)
      .waitFor({ state: "attached", timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (!destinationFound) {
      // Fail fast and clearly instead of calling selectOption() on a value
      // that will never exist — Playwright's own internal actionability
      // retry for that blindly burns its full default 30s timeout before
      // giving up. Confirmed on real traffic: XeJet only flies LOS<->ABV,
      // so a KAN destination request took 46s to fail with an opaque
      // Playwright timeout instead of ~8s with a clear "not offered" error.
      const availableDestinations = await page
        .locator("#Destination option")
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      throw new Error(
        `${airlineLabel} doesn't fly ${query.origin} to ${query.destination} (destinations offered from ${query.origin}: ${availableDestinations.join(", ") || "none"})`
      );
    }

    console.log(`[${logTag}] selecting destination: ${query.destination}`);
    await page.locator("#Destination").selectOption(query.destination);

    console.log(`[${logTag}] forcing One Way mode`);
    // The "One Way" control is a Bootstrap .btn-check radio; clicking it via
    // pixel/label coordinates was flaky, but forcing the underlying input's
    // state and dispatching the events its handlers listen for works reliably.
    await page.locator("#ReturnTrip2").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("click", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    mark("fillForm");

    console.log(`[${logTag}] submitting search`);
    await Promise.all([
      page.waitForURL(/FlightCal\.aspx/i, { timeout: 20000 }),
      page.locator("#submitButton").evaluate((el) => (el as HTMLButtonElement).click()),
    ]);
    console.log(`[${logTag}] landed on ${page.url()}`);
    mark("submitAndLoadResults");

    await navigateToDate(page, query.date, logTag);
    mark("dateNavigation");

    const options = await extractFlightOptions(page, query.date, airlineLabel, logTag);
    mark("extraction");

    const totalMs = Date.now() - t0;
    console.log(`[${logTag}] TIMING total=${totalMs}ms ${JSON.stringify(timings)}`);

    return { query, options, searchedAt: new Date().toISOString() };
  } finally {
    await context.close().catch(() => {});
  }
}

async function navigateToDate(page: Page, targetDateISO: string, logTag: string): Promise<void> {
  const targetLabel = toDayTabLabel(targetDateISO);
  const deadline = Date.now() + DATE_NAVIGATION_DEADLINE_MS;

  for (let i = 0; i < MAX_DAY_FORWARD_CLICKS; i++) {
    if (Date.now() > deadline) {
      throw new Error(
        `Gave up navigating to date tab "${targetLabel}" after ${DATE_NAVIGATION_DEADLINE_MS}ms (${i} forward-page attempts) — bailing out early to stay inside the caller's function timeout`
      );
    }
    const tab = page.locator(`a.dayTab[data-newday="${targetLabel}"]`);
    if ((await tab.count().catch(() => 0)) > 0) {
      console.log(`[${logTag}] found date tab for ${targetLabel}, selecting`);
      // Same async-postback lag as the forward-page control below, and
      // confirmed live to be genuinely slow here (12s+ in one observed
      // run) — a fixed 800ms sleep, and even an 8s wait for the tab's
      // "tab-active" class, both returned before the flight listing
      // itself had actually re-rendered, so extraction silently read the
      // PREVIOUS date's flights.
      //
      // A plain "did the content change at all" check (an earlier version
      // of this fix) is NOT sufficient — confirmed live and reproduced
      // twice against Enugu Air: the panel's content can visibly change
      // (satisfying a diff check) while still displaying the PREVIOUS
      // date's flights, because an earlier in-flight postback for the old
      // date can resolve and overwrite the DOM after the new request
      // started, clobbering it back to stale-but-different content. Wait
      // instead for the panel to contain the target day/month text itself
      // (e.g. "31 Jul", matching the format flight rows actually render —
      // see extractFlightOptions' parseResultRow), and scope to the same
      // ".tab-pane.active .flt-panel" the rest of this module reads from,
      // not an unscoped ".flt-panel" that could match a different tab's
      // (possibly hidden, never-updating) panel.
      // A stale in-flight postback can clobber the DOM right after landing,
      // right back to the previous date's content — confirmed live
      // (reproduced 3x against Enugu Air) that a single click-and-wait can
      // still end up showing the previous date even with the content-match
      // check above. Re-click up to twice more if that happens; each retry
      // gets a shorter window since it's recovering from a known bad state
      // rather than waiting out a first-time postback.
      const dayMonth = targetLabel.replace(/\s+\d{4}$/, ""); // "31 Jul 2026" -> "31 Jul"
      let landed = false;
      for (let attempt = 0; attempt < 3 && !landed; attempt++) {
        await tab.first().evaluate((el) => (el as HTMLElement).click());
        landed = await page
          .waitForFunction(
            (needle) => (document.querySelector(".tab-pane.active .flt-panel")?.textContent ?? "").includes(needle),
            dayMonth,
            { timeout: attempt === 0 ? 12000 : 6000 }
          )
          .then(() => true)
          .catch(() => false);
        if (!landed) console.log(`[${logTag}] tab "${targetLabel}" didn't stick (attempt ${attempt + 1}/3), retrying`);
      }
      if (!landed) {
        throw new Error(
          `Clicked date tab "${targetLabel}" 3x but the flight listing never showed "${dayMonth}" — would have silently booked/searched the wrong date`
        );
      }
      return;
    }

    console.log(`[${logTag}] "${targetLabel}" not visible yet, paging forward (attempt ${i + 1})`);
    const forwardArrow = page.locator("button.dayForward:not(.hidden-lg)").first();
    if ((await forwardArrow.count().catch(() => 0)) === 0) {
      throw new Error(
        `No forward control left to reach "${targetLabel}" — this airline's schedule may not extend that far out`
      );
    }

    // Confirmed via a real run (United Nigeria): this control debounces or
    // cancels its own in-flight update if clicked again before the
    // previous click's async postback actually finishes — three rapid
    // clicks on a fixed 800ms sleep each landed mid-flight and produced NO
    // visible change in the tab strip at all, then a fourth click (given
    // time to settle) suddenly revealed several additional days at once.
    // Wait for the currently-last tab's date to actually change before
    // treating this click as done, instead of trusting a fixed sleep —
    // that mismatch was silently burning through attempts without ever
    // registering real progress, and in one observed case exhausted all
    // 60 without ever reaching the target date.
    const lastTabBefore = await page.locator("a.dayTab").last().getAttribute("data-newday").catch(() => null);
    await forwardArrow.evaluate((el) => (el as HTMLElement).click());
    await page
      .waitForFunction(
        (prev) => {
          const tabs = document.querySelectorAll("a.dayTab");
          const last = tabs[tabs.length - 1];
          return !!last && last.getAttribute("data-newday") !== prev;
        },
        lastTabBefore,
        { timeout: 5000 }
      )
      .catch(() => {
        /* no visible change within 5s on this attempt — fine, the next
           loop iteration re-checks from scratch and may just need another
           click (or may finally land on one already in flight) */
      });
  }

  // Reaching here after the fix above is genuinely abnormal (a real page
  // change, or a route with no schedule that far out) — silently
  // returning flight options for whatever date happened to be selected
  // instead would mean a caller (chat search, and now the booking
  // disambiguation flow that feeds a real booking) could act on the wrong
  // date without ever being told. Fail loud instead.
  throw new Error(`Could not find date tab "${targetLabel}" after ${MAX_DAY_FORWARD_CLICKS} forward-page attempts`);
}

function toDayTabLabel(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

async function extractFlightOptions(
  page: Page,
  requestedDate: string,
  airlineLabel: string,
  logTag: string
): Promise<FlightOption[]> {
  const panels = page.locator(".tab-pane.active .flt-panel");
  const count = await panels.count().catch(() => 0);

  if (count === 0) {
    const bodyText = await page.locator("body").innerText().catch(() => "<failed to read>");
    console.log(`DIAGNOSTIC [${logTag}]: no flight panels found. Visible page text (first 2000 chars):`);
    console.log(bodyText.slice(0, 2000));
    return [];
  }

  const options: FlightOption[] = [];

  for (let i = 0; i < count; i++) {
    const panel = panels.nth(i);
    const parsed = await panel.evaluate((panelEl) => {
      const el = panelEl as HTMLElement;
      const text = (sel: string): string | null => el.querySelector(sel)?.textContent?.trim() ?? null;

      const departureTime = text(".cal-Depart-time .time");
      const arrivalTime = text(".cal-Arrive-time .time");
      const durationText = text(".flightDuration");
      const flightNumber = text(".flightnumber");

      const durationMatch = durationText ? durationText.match(/(\d+)h\s*(\d+)m/) : null;
      const durationMinutes = durationMatch
        ? parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10)
        : null;

      const classCards = Array.from(el.querySelectorAll('[class*="classband-panel"]'));
      const fareClasses = classCards.map((card) => {
        const name = card.getAttribute("data-classband") ?? card.querySelector(".class-band-name")?.textContent?.trim() ?? "Unknown";

        const priceEl = card.querySelector("[data-original-amount]");
        const rawAmount = priceEl?.getAttribute("data-original-amount") ?? null;
        const fare = rawAmount ? parseFloat(rawAmount) : null;
        const currency = (priceEl?.getAttribute("data-original-currency") || "ngn").toUpperCase();

        const cardText = card.textContent ?? "";
        const soldOut = !!card.querySelector(".seats-none") || /sold out/i.test(cardText);
        const seatsMatch = card.querySelector(".seats-count")?.textContent?.match(/(\d+)/) ?? null;
        const seatsLeft = seatsMatch ? parseInt(seatsMatch[1], 10) : null;

        const popoverHtml = card.querySelector(".help-tip")?.getAttribute("data-content") ?? "";
        const tmp = document.createElement("div");
        tmp.innerHTML = popoverHtml;
        const policyItems = Array.from(tmp.querySelectorAll("li")).map((li) => li.textContent?.trim() ?? "");
        const refundPolicy = policyItems.find((t) => /refund/i.test(t)) ?? null;
        const baggage = policyItems.find((t) => /baggage/i.test(t)) ?? null;

        return {
          name,
          fare: fare != null && !Number.isNaN(fare) ? fare : null,
          currency,
          soldOut,
          seatsLeft,
          refundPolicy,
          baggage,
        };
      });

      const availableFares = fareClasses.filter((f) => !f.soldOut && f.fare != null).map((f) => f.fare as number);
      const cheapestFare = availableFares.length > 0 ? Math.min(...availableFares) : null;

      const raw = el.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "";

      return {
        flightNumber,
        departureTime,
        arrivalTime,
        durationMinutes,
        cheapestFare,
        fareClasses,
        raw,
      };
    });

    const fareClasses: FareClassOption[] = parsed.fareClasses;

    options.push({
      airline: airlineLabel,
      flightNumber: parsed.flightNumber,
      departureTime: parsed.departureTime ?? "",
      arrivalTime: parsed.arrivalTime,
      date: requestedDate,
      durationMinutes: parsed.durationMinutes,
      fare: parsed.cheapestFare,
      currency: "NGN",
      seatStatus: parsed.cheapestFare == null ? "Sold out" : null,
      fareClasses,
      raw: parsed.raw,
    });
  }

  return options;
}
