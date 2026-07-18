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
    context.on("dialog", (dialog) => {
      console.log(`[enugu] DIALOG appeared: "${dialog.message()}" - dismissing`);
      dialog.dismiss().catch(() => {});
    });
    const page = await context.newPage();

    console.log("[enugu] navigating to search page");
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("iframe").first();

    console.log(`[enugu] selecting origin: ${query.origin}`);
    await frame.locator("#Origin").selectOption(query.origin);
    console.log("[enugu] origin selected");

    await frame.locator("#Destination").locator(`option[value="${query.destination}"]`).waitFor({ timeout: 25000 }).catch(() => {});
    console.log(`[enugu] selecting destination: ${query.destination}`);
    await frame.locator("#Destination").selectOption(query.destination);
    console.log("[enugu] destination selected");

    console.log("[enugu] clicking One Way");
    await frame.getByText("One Way", { exact: true }).click();
    console.log("[enugu] One Way clicked");

    await selectDate(frame, query.date);

    console.log(`[enugu] current page url before Continue click: ${page.url()}`);
    const continueBtn = frame.getByRole("button", { name: "Continue" });
    const continueVisible = await continueBtn.isVisible().catch(() => false);
    console.log(`[enugu] Continue button visible: ${continueVisible}`);

    const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await continueBtn.click();
    console.log("[enugu] Continue clicked");

    const popup = await popupPromise;
    let activePage = page;
    if (popup && popup !== page) {
      console.log(`[enugu] a NEW PAGE/POPUP opened: ${popup.url()}`);
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      activePage = popup;
    } else {
      console.log("[enugu] no new page/popup opened - staying on original page");
    }

    await activePage.waitForTimeout(3000);
    console.log(`[enugu] current page url after Continue click: ${activePage.url()}`);

    const options = await extractFlightOptions(activePage, frame, query.date);

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

  console.log("[enugu] opening date picker");
  await frame.locator(OPEN_DATE_PICKER_SELECTOR).click();
  console.log("[enugu] date picker opened (assumed)");

  for (let i = 0; i < Math.max(0, monthsAhead); i++) {
    await frame.getByTitle("Next").click();
  }

  const day = String(target.getDate());
  console.log(`[enugu] clicking day: ${day}`);
  const dayCount = await frame.getByRole("link", { name: day, exact: true }).count().catch(() => -1);
  console.log(`[enugu] number of links matching day "${day}": ${dayCount}`);
  await frame.getByRole("link", { name: day, exact: true }).first().click();
  console.log("[enugu] day clicked");
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
    options.push(parseResultRow(raw, requestedDate));
  }

  return options;
}

function parseResultRow(raw: string, requestedDate: string): FlightOption {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const allTimes = [...raw.matchAll(/\d{1,2}:\d{2}/g)].map((m) => m[0]);
  const durationMatch = raw.match(/(\d+)h\s*(\d+)m/);
  const flightNumberMatch = raw.match(/\b([A-Z]{2}\d{3,4})\b/);

  const fromIndex = lines.findIndex((l) => l.toLowerCase() === "from");
  const fareLine = fromIndex >= 0 ? lines[fromIndex + 1] : undefined;

  let fare = null;
  let seatStatus = null;
  if (fareLine) {
    const priceMatch = fareLine.match(/([\d,]+)\s*NGN/);
    if (priceMatch) {
      fare = parseFloat(priceMatch[1].replace(/,/g, ""));
    } else {
      seatStatus = fareLine;
    }
  }

  return {
    airline: "Enugu Air",
    flightNumber: flightNumberMatch ? flightNumberMatch[1] : null,
    departureTime: allTimes[0] || "",
    arrivalTime: allTimes[1] || null,
    date: requestedDate,
    durationMinutes: durationMatch ? parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10) : null,
    fare,
    currency: "NGN",
    seatStatus,
    raw: raw.trim(),
  };
}
