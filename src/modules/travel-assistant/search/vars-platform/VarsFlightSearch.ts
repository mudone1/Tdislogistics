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
    await page
      .locator("#Destination")
      .locator(`option[value="${query.destination}"]`)
      .waitFor({ state: "attached", timeout: 15000 })
      .catch(() => {});
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

  for (let i = 0; i < MAX_DAY_FORWARD_CLICKS; i++) {
    const tab = page.locator(`a.dayTab[data-newday="${targetLabel}"]`);
    if ((await tab.count().catch(() => 0)) > 0) {
      console.log(`[${logTag}] found date tab for ${targetLabel}, selecting`);
      await tab.first().evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(800);
      return;
    }

    console.log(`[${logTag}] "${targetLabel}" not visible yet, paging forward (attempt ${i + 1})`);
    const forwardArrow = page.locator("button.dayForward:not(.hidden-lg)").first();
    if ((await forwardArrow.count().catch(() => 0)) === 0) break;
    await forwardArrow.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(800);
  }

  console.log(
    `[${logTag}] gave up looking for "${targetLabel}" after ${MAX_DAY_FORWARD_CLICKS} page attempts - using whatever date is currently selected`
  );
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
