import { chromium, type Page } from "playwright";
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

export interface VarsAirlineConfig {
  logTag: string;
  requirementsUrl: string;
  airlineLabel: string;
}

export async function searchVarsPlatformFlights(
  query: FlightSearchQuery,
  config: VarsAirlineConfig
): Promise<FlightSearchResult> {
  const { logTag, requirementsUrl, airlineLabel } = config;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    context.on("dialog", (dialog) => {
      console.log(`[${logTag}] DIALOG appeared: "${dialog.message()}" - dismissing`);
      dialog.dismiss().catch(() => {});
    });
    const page = await context.newPage();

    console.log(`[${logTag}] navigating to requirements form`);
    await page.goto(requirementsUrl, { waitUntil: "domcontentloaded" });

    console.log(`[${logTag}] selecting origin: ${query.origin}`);
    await page.locator("#Origin").selectOption(query.origin);

    // Destination options are repopulated by the origin's change handler, so
    // wait for the target option to actually exist before selecting it.
    await page
      .locator("#Destination")
      .locator(`option[value="${query.destination}"]`)
      .waitFor({ timeout: 15000 })
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

    console.log(`[${logTag}] submitting search`);
    await Promise.all([
      page.waitForURL(/FlightCal\.aspx/i, { timeout: 20000 }),
      page.locator("#submitButton").evaluate((el) => (el as HTMLButtonElement).click()),
    ]);
    console.log(`[${logTag}] landed on ${page.url()}`);

    await navigateToDate(page, query.date, logTag);

    const options = await extractFlightOptions(page, query.date, airlineLabel, logTag);

    await browser.close();

    return { query, options, searchedAt: new Date().toISOString() };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
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
