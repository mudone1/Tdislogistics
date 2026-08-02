import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { establishSession, type BookOnHoldCredentials, type VarsAirlineBookingConfig } from "./VarsBookOnHold";

// Ticket-issuing automation for airlines running the VARS/Videcom booking
// engine — a SEPARATE flow from bookVarsPlatformOnHold (which only ever
// creates a "Book Now, Pay Later" HOLD). This module reuses the same
// login/session mechanism (establishSession) but drives the "Find Booking"
// -> PNR lookup -> "Pay Now" -> payment -> issue sequence instead.
//
// Reconstructed from two screen recordings ("how to call up a PNR and make
// payment", "how to pay for a recently booked on hold ticket") plus one
// real screenshot of the actual post-payment success page (a THIRD source
// the recordings themselves never reached — both recordings cut off right
// after the final password/Next submission, before any success page
// appeared). Confirmed from the screenshot: after a real payment succeeds,
// the top nav gains a "Get Ticket" item, a red "Void Booking" button
// appears next to the PNR heading, the "Manage My Booking" panel says
// "Your booking is confirmed...", and a "Payment Summary" box shows
// Invoice / date / amount. No separate ticket number distinct from the PNR
// was visible anywhere — this airline appears to treat the PNR itself as
// the ticket reference once issued, so ticketNumber stays null unless a
// live run finds one.
//
// UNVERIFIED beyond that one screenshot: the exact selector reliability of
// "Find Booking" (a hover-dropdown menu whose top-level trigger and
// revealed submenu item share the identical visible text "Find Booking",
// per the recording — handled below by preferring a dropdown-menu-scoped
// match), and everything about "Void Booking" (no recording or screenshot
// of that flow exists yet — this module's voidBooking() is a best-effort
// first attempt that logs a full diagnostic dump of the confirmation
// dialog/page it lands on, since nothing here has been independently
// confirmed).

export interface IssueTicketResult {
  pnr: string;
  ticketNumber: string | null;
  amountPaid: number | null;
  currency: string | null;
  raw: string;
  screenshot: Buffer | null;
}

export interface VoidBookingResult {
  pnr: string;
  voided: boolean;
  raw: string;
  screenshot: Buffer | null;
}

const LOGGED_OUT_OR_ERROR = /booking not found|session expired|please log in/i;

// Opens a browser, logs in (or reuses a cached session, same as booking),
// navigates Find Booking -> Basic Find PNR -> searches the given PNR, and
// verifies the resulting page actually shows THAT exact PNR before
// returning — never proceeds to payment on an unverified/mismatched page.
// Caller is responsible for closing the returned browser.
export async function openBookingByPnr(
  credentials: BookOnHoldCredentials,
  pnr: string,
  config: VarsAirlineBookingConfig
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const { logTag, loginUrl, requirementsUrl } = config;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const { context, page } = await establishSession(browser, loginUrl, requirementsUrl, credentials, logTag);

    console.log(`[${logTag}] opening Find Booking for PNR "${pnr}"`);
    // The nav trigger and the revealed dropdown item share the same visible
    // text ("Find Booking") per the recording — hover/click the trigger
    // first, then scope the actual click to a dropdown/submenu container so
    // it doesn't just re-click the trigger itself.
    const trigger = page.getByText("Find Booking", { exact: true }).first();
    await trigger.click();
    const submenuItem = page.locator(".dropdown-menu, .dropdown, .submenu").getByText("Find Booking", { exact: true }).first();
    await submenuItem.click({ timeout: 8000 }).catch(async () => {
      // Fallback: some deployments render the dropdown without a
      // conventional Bootstrap class — try the second "Find Booking" match
      // on the page instead (the first is the trigger itself).
      const matches = page.getByText("Find Booking", { exact: true });
      const count = await matches.count();
      if (count < 2) {
        const visibleNav = await page.evaluate(() => document.body.innerText.slice(0, 1500));
        console.error(`DIAGNOSTIC [${logTag}] only ${count} "Find Booking" match(es) found. Page text: ${visibleNav}`);
        throw new Error(`Could not find the "Find Booking" dropdown submenu item. Page text: ${visibleNav.slice(0, 400)}`);
      }
      await matches.nth(1).click();
    });

    console.log(`[${logTag}] filling Basic Find PNR modal`);
    const recordLocatorField = page
      .getByLabel(/Record Locator/i)
      .or(page.locator('input[name*="ecord" i], input[id*="ecord" i], input[name*="pnr" i], input[id*="pnr" i], input[placeholder*="ecord" i], input[placeholder*="pnr" i]'))
      .first();
    const foundField = await recordLocatorField
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    if (!foundField) {
      // Diagnostic goes INTO the thrown message, not just console.error —
      // this surfaces all the way to the chat error text (no Railway log
      // access needed to see it), so the very next failure shows exactly
      // what's on the page instead of a bare timeout again.
      const diagnostic = await page.evaluate(() => ({
        url: window.location.href,
        inputs: Array.from(document.querySelectorAll("input")).map((el) => ({
          id: el.id,
          name: el.name,
          type: el.type,
          placeholder: el.placeholder,
        })),
        visibleHeadings: Array.from(document.querySelectorAll("h1,h2,h3,h4,.modal-title,label")).map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 20),
      }));
      console.error(`DIAGNOSTIC [${logTag}] Record Locator field never appeared: ${JSON.stringify(diagnostic)}`);
      throw new Error(`Could not find the Record Locator field to search PNR "${pnr}". Page state: ${JSON.stringify(diagnostic).slice(0, 1200)}`);
    }
    await recordLocatorField.fill(pnr);
    await page
      .locator('button, a, input[type="submit"], input[type="button"]')
      .filter({ hasText: /^search$/i })
      .first()
      .click();

    console.log(`[${logTag}] waiting for Manage Booking page`);
    await page.waitForURL(/ManageBooking\.aspx/i, { timeout: 20000 }).catch(() => {
      /* some deployments may not change the URL casing/path exactly — proceed and let the verification below fail loudly if it truly didn't navigate */
    });
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const bodyText = await page.locator("body").innerText();
    if (LOGGED_OUT_OR_ERROR.test(bodyText)) {
      throw new Error(`PNR "${pnr}" lookup failed — portal reported an error. Page text: ${bodyText.slice(0, 500)}`);
    }

    // PNR VERIFICATION — mandatory, per explicit product direction: never
    // proceed to payment unless the page actually shows the exact PNR that
    // was requested. Checked against multiple independent spots seen in the
    // recording (the green heading, "Confirmation Reference: X", and the
    // top-right nav badge) — any ONE matching is sufficient, since a
    // deployment might render only some of them, but if NONE match, abort.
    const pnrVisible = await page.evaluate((expected) => {
      const text = document.body.innerText;
      return text.includes(expected);
    }, pnr);
    if (!pnrVisible) {
      const diagnostic = bodyText.replace(/\s+/g, " ").trim().slice(0, 1000);
      throw new Error(
        `PNR verification failed — requested "${pnr}" but the portal page doesn't show it anywhere. Refusing to proceed to payment. Page text: ${diagnostic}`
      );
    }
    console.log(`[${logTag}] PNR "${pnr}" verified on Manage Booking page`);

    return { browser, context, page };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

// From an already-opened, PNR-verified Manage Booking page, clicks "Pay
// Now", captures the fare total BEFORE submitting payment (per explicit
// product direction — the amount is already on the page prior to the final
// submit), fills the agent's own portal password (confirmed via the
// recording — the same re-authentication pattern as Book Now Pay Later,
// not a card/CVV field), and submits. Success detection is deliberately
// broad and defensive (see module doc comment) since no recording captured
// this exact page; whatever's actually found is included in `raw` either
// way so a first live run is fully diagnosable.
export async function payAndIssueTicket(
  page: Page,
  pnr: string,
  agentPassword: string,
  logTag: string
): Promise<IssueTicketResult> {
  console.log(`[${logTag}] clicking Pay Now for PNR "${pnr}"`);
  await page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^pay now$/i })
    .first()
    .click();

  await page.waitForURL(/mmbpayment\.aspx/i, { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  // Fare amount — extracted here, BEFORE any payment-method/password
  // interaction, per explicit product direction.
  const preSubmitText = await page.locator("body").innerText();
  const totalMatch = preSubmitText.match(/Total Payable:?\s*([\d,]+)\s*([A-Z]{3})/i);
  const amountPaid = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : null;
  const currency = totalMatch ? totalMatch[2].toUpperCase() : null;
  console.log(`[${logTag}] fare extracted before payment: ${amountPaid ?? "unknown"} ${currency ?? ""}`);

  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.waitFor({ state: "visible", timeout: 10000 });
  await passwordField.fill(agentPassword);

  console.log(`[${logTag}] submitting payment for PNR "${pnr}" — THIS COMPLETES A REAL PAYMENT`);
  const nextButton = page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^next\s*▸?$/i })
    .first();
  await nextButton.click();

  // Generous timeout — the recordings showed a real ~40-45s backend
  // processing delay on this exact step even for a plain hold; a real
  // payment submission is plausibly similar or slower.
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {
    console.warn(`[${logTag}] networkidle wait timed out after payment submit — checking page state anyway`);
  });

  const raw = await page.locator("body").innerText();
  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);

  // Broad, best-effort success signals — see module doc comment for why
  // none of these are independently confirmed except via one real
  // screenshot. Logged regardless so the FIRST live run is fully
  // diagnosable even if none of these match.
  const looksIssued =
    /void booking/i.test(raw) ||
    /get ticket/i.test(raw) ||
    /booking is confirmed/i.test(raw) ||
    /payment summary/i.test(raw) ||
    /ticket(ed)? (number|no\.?)/i.test(raw);

  if (!looksIssued) {
    console.error(`DIAGNOSTIC [${logTag}] no success signal found after payment submit. Page text: ${raw.replace(/\s+/g, " ").trim().slice(0, 2000)}`);
    throw new Error(
      `Payment was submitted for PNR "${pnr}" but no success indicator was found on the resulting page — this needs manual verification on the portal before assuming the ticket is (or isn't) issued. Do not retry blindly; retrying a real payment submission risks a duplicate charge.`
    );
  }

  const ticketNumberMatch = raw.match(/ticket(?:ed)?\s*(?:number|no\.?)\s*[:\-]?\s*([A-Z0-9]{6,15})/i);

  console.log(`[${logTag}] PNR "${pnr}" appears issued — success signal matched`);
  return {
    pnr,
    ticketNumber: ticketNumberMatch ? ticketNumberMatch[1] : null,
    amountPaid,
    currency,
    raw,
    screenshot,
  };
}

// Best-effort VOID of a just-issued (or held) booking, for cleaning up a
// live test. UNVERIFIED — no recording exists of this flow at all; this
// clicks the "Void Booking" button seen in the post-payment screenshot and
// then dumps a full diagnostic of whatever follows (a confirmation dialog,
// a reason-code form, a second page — genuinely unknown), so the FIRST
// live run tells us exactly what to build against. Never silently reports
// success — only a page that explicitly stops showing "Void Booking" (i.e.
// the booking no longer looks active) is treated as voided.
export async function voidBooking(page: Page, pnr: string, logTag: string): Promise<VoidBookingResult> {
  console.log(`[${logTag}] attempting Void Booking for PNR "${pnr}" (unverified flow — first live attempt)`);
  const voidButton = page.locator("button, a").filter({ hasText: /^void booking$/i }).first();
  await voidButton.waitFor({ state: "visible", timeout: 10000 });
  await voidButton.click();

  // Unknown confirmation step — try the common shapes (a confirm button in
  // a modal/dialog, or a native browser confirm() dialog) without assuming
  // either is correct.
  page.once("dialog", (dialog) => {
    console.log(`[${logTag}] native dialog appeared on void: "${dialog.message()}" — accepting`);
    dialog.accept().catch(() => {});
  });
  const confirmButton = page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^(confirm|yes|ok|void)$/i })
    .first();
  await confirmButton.click({ timeout: 5000 }).catch(() => {
    console.log(`[${logTag}] no separate confirm button found — void click alone may have been sufficient, or a native dialog handled it`);
  });

  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  const raw = await page.locator("body").innerText();
  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const stillActive = /void booking/i.test(raw);

  console.log(`DIAGNOSTIC [${logTag}] page text after void attempt: ${raw.replace(/\s+/g, " ").trim().slice(0, 2000)}`);

  return { pnr, voided: !stillActive, raw, screenshot };
}
