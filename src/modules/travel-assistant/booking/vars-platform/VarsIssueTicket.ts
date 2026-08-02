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
    // Confirmed live (real diagnostic dump): landing on the right page
    // (Dashboard.aspx) alone isn't enough — the "Find Booking" click still
    // doesn't reveal the modal. Try several distinct interaction patterns
    // rather than assuming one: (1) hover then click, in case this is a
    // CSS :hover-revealed dropdown a bare click() doesn't fully trigger the
    // hover-state prerequisites for; (2) a Playwright click on the second
    // DOM match (trigger vs. revealed item both read "Find Booking"); (3) a
    // raw JS-dispatched click as a last resort, for custom widgets that
    // don't respond to Playwright's synthetic pointer events the same way
    // they do to a real mouse. Each is a no-op if the previous one already
    // worked (checked via the Record Locator field appearing).
    const trigger = page.getByText("Find Booking", { exact: true }).first();
    await trigger.hover().catch(() => {});
    await trigger.click().catch(() => {});

    const recordLocatorField = page
      .getByLabel(/Record Locator/i)
      .or(page.locator('input[name*="ecord" i], input[id*="ecord" i], input[name*="pnr" i], input[id*="pnr" i], input[placeholder*="ecord" i], input[placeholder*="pnr" i]'))
      .first();

    let foundField = await recordLocatorField.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);

    if (!foundField) {
      for (const scope of [".dropdown-menu", ".dropdown", ".submenu", ".navbar-nav", "ul", "nav"]) {
        const item = page.locator(scope).getByText("Find Booking", { exact: true }).last();
        if (await item.count().catch(() => 0)) {
          await item.click({ timeout: 3000 }).catch(() => {});
          foundField = await recordLocatorField.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
          if (foundField) break;
        }
      }
    }

    if (!foundField) {
      // Last resort — a raw JS click on whatever the SECOND "Find Booking"
      // text match actually is (any element type, not just links/buttons),
      // bypassing Playwright's hover/visibility actionability checks
      // entirely in case those are what's actually blocking it.
      await page.evaluate(() => {
        const matches = Array.from(document.querySelectorAll("a,button,li,span,div")).filter(
          (el) => el.textContent?.trim() === "Find Booking" && el.children.length === 0
        );
        const target = matches[1] ?? matches[0];
        target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      foundField = await recordLocatorField.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    }

    console.log(`[${logTag}] filling Basic Find PNR modal`);
    if (!foundField) {
      // Diagnostic goes INTO the thrown message, not just console.error —
      // this surfaces all the way to the chat error text (no Railway log
      // access needed to see it), so the very next failure shows exactly
      // what's on the page instead of a bare timeout again. Dumps every
      // element whose text mentions "find" or "booking" (not just headings)
      // since the earlier diagnostic missed nav-bar links entirely.
      const diagnostic = await page.evaluate(() => {
        const navLike = Array.from(document.querySelectorAll("a,button,li"))
          .filter((el) => /find|booking/i.test(el.textContent ?? "") && el.textContent!.trim().length < 40)
          .map((el) => ({
            tag: el.tagName,
            text: el.textContent?.trim(),
            class: el.className,
            href: (el as HTMLAnchorElement).href ?? null,
          }))
          .slice(0, 15);
        return {
          url: window.location.href,
          navLike,
          inputs: Array.from(document.querySelectorAll("input")).map((el) => ({
            id: el.id,
            name: el.name,
            type: el.type,
            placeholder: el.placeholder,
          })),
        };
      });
      console.error(`DIAGNOSTIC [${logTag}] Record Locator field never appeared: ${JSON.stringify(diagnostic)}`);
      throw new Error(`Could not find the Record Locator field to search PNR "${pnr}". Page state: ${JSON.stringify(diagnostic).slice(0, 1400)}`);
    }
    await recordLocatorField.fill(pnr);

    // Confirmed live: the first "Search"-labeled match on this page is
    // `<a href="#search" data-toggle="tab">Search</a>` — a Bootstrap TAB
    // switcher, not the form's real submit control, and it stays
    // permanently invisible (its own tab is never the active one), so a
    // direct click on it just times out. Press Enter in the field first —
    // the natural submission trigger for a single-field search form, and
    // it can't accidentally hit an unrelated tab-nav link the way a
    // text-based button search can.
    await recordLocatorField.press("Enter");
    let navigated = await page.waitForURL(/ManageBooking\.aspx/i, { timeout: 8000 }).then(() => true).catch(() => false);

    if (!navigated) {
      // Enter didn't submit — fall back to an explicit control, but
      // restricted to real submit/button elements (never a plain <a>,
      // which is what the known-bad tab-toggle link is) so it can't match
      // that same dead end again.
      const searchButton = page
        .locator('button, input[type="submit"], input[type="button"]')
        .filter({ hasText: /^search$/i })
        .first();
      await searchButton.click({ timeout: 10000 }).catch((err) => {
        console.warn(`[${logTag}] restricted Search button click failed too: ${err}`);
      });
      navigated = await page.waitForURL(/ManageBooking\.aspx/i, { timeout: 15000 }).then(() => true).catch(() => false);
    }

    if (!navigated) {
      // Neither Enter nor the restricted button click actually submitted —
      // confirmed live twice now that the search silently fails to
      // progress (landing back on a near-blank Dashboard state). Diagnose
      // PRECISELY here, at the submission step itself, rather than letting
      // the generic PNR-verification check downstream report a vaguer
      // failure several steps later.
      const diagnostic = await page.evaluate(() => {
        const clickable = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button']"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden";
          })
          .map((el) => ({
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 40) || (el as HTMLInputElement).value,
            class: el.className,
          }))
          .filter((el) => el.text)
          .slice(0, 25);
        const recordField = document.querySelector<HTMLInputElement>('input[name*="ecord" i], input[id*="ecord" i], input[name*="pnr" i], input[id*="pnr" i]');
        return {
          url: window.location.href,
          recordFieldStillPresent: !!recordField,
          recordFieldValue: recordField?.value ?? null,
          visibleClickableElements: clickable,
        };
      });
      console.error(`DIAGNOSTIC [${logTag}] PNR search never submitted: ${JSON.stringify(diagnostic)}`);
      throw new Error(`Filled PNR "${pnr}" into the Record Locator field but neither Enter nor a button click actually submitted the search. Page state: ${JSON.stringify(diagnostic).slice(0, 1400)}`);
    }

    console.log(`[${logTag}] waiting for Manage Booking page (navigated=${navigated})`);
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
