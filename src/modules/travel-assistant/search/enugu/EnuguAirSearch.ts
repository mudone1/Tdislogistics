import { chromium, type Page, type FrameLocator } from "playwright";
import type { FlightOption, FlightSearchQuery, FlightSearchResult } from "../../core/types";

const SEARCH_URL = "https://enuguairlines.com/";
const OPEN_DATE_PICKER_SELECTOR = "span >> nth=3";

export async function searchEnuguAirFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    context.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    const page = await context.newPage();

    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("iframe").first();

    await frame.locator("#Origin").selectOption(query.origin);
    // Selecting Origin dynamically repopulates the Destination dropdown
    // (only valid routes from that origin become selectable) — confirmed
    // by the first real test run timing out with "did not find some
    // options" on Destination. Give that repopulation a moment to finish.
    await frame.locator("#Destination").locator(`option[value="${query.destination}"]`).waitFor({ timeout: 10_000 }).catch(() => {});
    await frame.locator("#Destination").selectOption(query.destination);

    await frame.getByText("One Way", { exact: true }).click();

    await selectDate(frame, query.date);

    await frame.getByRole("button", { name: "Continue" }).click();

    const options = await extractFlightOptions(page, frame, query.date);

    await browser.close();

    return { query, options, searchedAt: new Date().toISOString() };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

async function selectDate(frame: FrameLocator, targetDateISO: string) {
  const target = new Date(targetDateISO + "T00:00:00");
  const now = new Date();
  const monthsAhead =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());

  await frame.locator(OPEN_DATE_PICKER_SELECTOR).click();

  for (let i = 0; i < Math.max(0, monthsAhead); i++) {
    await frame.getByTitle("Next").click();
  }

  const day = String(target.getDate());
  await frame.getByRole("link", { name: day, exact: true }).click();
}

async function extractFlightOptions(page: Page, frame: FrameLocator, requestedDate: string): Promise<FlightOption[]> {
  const resultPattern = /\d{1,2}:\d{2}\s+\d{1,2}\s+[A-Za-z]{3}\s+.+\d+h\s*\d+m/;
  const resultLinks = page.getByRole("link", { name: resultPattern });
  const count = await resultLinks.count().catch(() => 0);

  if (count === 0) {
    const bodyText = await page.locator("body").innerText().catch(() => "<failed to read>");
    console.log("DIAGNOSTIC: no result links matched. Visible page text (first 2000 chars):");
    console.log(bodyText.slice(0, 2000));
  }

  const options: FlightOption[] = [];

  for (let i = 0; i < count; i++) {
    const link = resultLinks.nth(i);
    const raw = (await link.textContent().catch(() => "")) ?? "";
    const parsed = parseResultRow(raw, requestedDate);

    await link.click().catch(() => {});

    const rowContainer = page.locator(`#cls_row_${i}_0`);
    const fareInfo = await rowContainer
      .innerText({ timeout: 10000 })
      .then(extractCheapestFare)
      .catch(() => ({ fare: null, status: null }));

    options.push({
      airline: "Enugu Air",
      departureTime: parsed.time,
      date: parsed.date ?? requestedDate,
      durationMinutes: parsed.durationMinutes,
      fare: fareInfo.fare,
      currency: "NGN",
      seatStatus: fareInfo.status,
      raw: raw.trim(),
    });
  }

  return options;
}

function parseResultRow(raw: string, requestedDate: string) {
  const timeMatch = raw.match(/(\d{1,2}:\d{2})/);
  const durationMatch = raw.match(/(\d+)h\s*(\d+)m/);
  const dateMatch = raw.match(/\d{1,2}\s+([A-Za-z]{3})/);

  return {
    time: timeMatch ? timeMatch[1] : "",
    date: dateMatch ? requestedDate : null,
    durationMinutes: durationMatch ? parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10) : null,
  };
}

function extractCheapestFare(containerText: string) {
  const lines = containerText.split("\n").map((l) => l.trim()).filter(Boolean);
  let cheapest = null;

  for (let i = 0; i < lines.length; i++) {
    const priceMatch = lines[i].match(/^([\d,]+)\s*NGN/);
    if (!priceMatch) continue;

    const nearby = lines.slice(Math.max(0, i - 2), i + 1).join(" ").toLowerCase();
    if (nearby.includes("sold out") || nearby.includes("no seats")) continue;

    const price = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(price)) continue;

    const statusLine = lines
      .slice(Math.max(0, i - 2), i + 1)
      .find((l) => /seats? left|available/i.test(l));

    if (!cheapest || price < cheapest.fare) {
      cheapest = { fare: price, status: statusLine || null };
    }
  }

  return cheapest || { fare: null, status: null };
}
