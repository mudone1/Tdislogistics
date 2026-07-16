import { BaseConnector } from "../base/BaseConnector";
import type { AirlineKey, BalanceReading, DecryptedCredentials } from "../../core/types";
import { ConnectorError } from "../../core/types";
import { SYNC_STEPS } from "../../logs/SyncRunLogger";
import type { CraneConnectorConfig } from "./CraneConnectorConfig";

/**
 * Shared connector for every airline on the Crane booking platform
 * (Air Peace, Aero, Arik, Ibom, NG Eagle in Phase 1). Child classes only
 * provide a CraneConnectorConfig — see AirPeaceConnector.ts etc. for the
 * five-line implementations.
 *
 * This is the *only* place Crane login/navigation logic is written. Fixing
 * a bug or adapting to a Crane UI change here fixes it for all five
 * airlines at once.
 */
export class BaseCraneConnector extends BaseConnector {
  readonly airline: AirlineKey;
  readonly displayName: string;

  constructor(protected readonly config: CraneConnectorConfig) {
    super();
    this.airline = config.airline;
    this.displayName = config.displayName;
  }

  async login(credentials: DecryptedCredentials): Promise<void> {
    const page = this.getPage();
    const { selectors, loginUrl, postLoginUrl } = this.config;
    const tag = `[${this.airline}:login]`;

    console.log(`${tag} navigating to login page: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    console.log(`${tag} filling username`);
    // Matching the exact recorded sequence: explicit click to focus first,
    // then fill — some legacy login forms initialize hidden session state
    // on focus, which a direct .fill() (which auto-focuses too, but
    // without necessarily firing the same event sequence) can skip.
    await page.locator(selectors.usernameInput).click();
    await page.waitForTimeout(300);
    await page.fill(selectors.usernameInput, credentials.username);
    await page.waitForTimeout(400);
    await page.locator(selectors.usernameInput).press("Tab").catch(() => {});
    await page.waitForTimeout(300);
    console.log(`${tag} filling password`);
    await page.locator(selectors.passwordInput).click();
    await page.waitForTimeout(300);
    await page.fill(selectors.passwordInput, credentials.password);
    await page.waitForTimeout(500);

    // Confirmed via Playwright codegen against the real Ibom Air login
    // page: clicking Login opens a NEW POPUP WINDOW with the authenticated
    // dashboard, rather than navigating the same page. Since every Crane
    // connector shares this login flow, capture that popup here (once) so
    // isLoggedIn()/syncBalance() downstream automatically operate on the
    // right page for all five airlines. If a given airline turns out NOT
    // to use a popup, this just resolves to null after the timeout and
    // falls through to using the original page as before.
    const popupPromise = page.waitForEvent("popup", { timeout: 15_000 }).catch(() => null);
    console.log(`${tag} clicking login button`);
    await page.click(selectors.loginButton);
    const popup = await popupPromise;
    console.log(`${tag} popup ${popup ? "opened: " + popup.url() : "did NOT open within 15s"}`);
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      this.page = popup;
      console.log(`${tag} popup finished loading, url now: ${this.page.url()}`);
      // Give the app's own JS time to drive any redirect it wants to do
      // on its own — the previous approach of forcing a navigation
      // ourselves turned out to break the app's server-side view state.
      await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await this.page.waitForTimeout(3000);
      console.log(`${tag} popup settled naturally, url now: ${this.page.url()}`);
      // Read the actual VISIBLE TEXT of wherever we land — if this is an
      // error page, the real displayed message (access denied, location
      // restriction, session issue, etc.) will show up here directly,
      // instead of us continuing to guess from raw HTML/CSS noise.
      const visibleText = await this.page.locator("body").innerText().catch(() => "<failed to read text>");
      console.log(`${tag} VISIBLE PAGE TEXT (first 2000 chars):\n${visibleText.slice(0, 2000)}`);
    }

    // Some airlines' popup opens to a blank/intermediate page rather than
    // the real dashboard — an explicit navigation is needed first.
    if (postLoginUrl) {
      console.log(`${tag} navigating to postLoginUrl: ${postLoginUrl}`);
      await this.getPage()
        .goto(postLoginUrl, { waitUntil: "domcontentloaded" })
        .then(() => console.log(`${tag} postLoginUrl navigation succeeded`))
        .catch((err) => console.log(`${tag} postLoginUrl navigation FAILED (continuing anyway):`, err instanceof Error ? err.message : err));
    }

    // Crane portals are typical server-rendered dashboards — wait for the
    // post-login marker rather than a fixed timeout, so slow logins don't
    // false-fail and fast ones don't waste time.
    console.log(`${tag} waiting up to 20s for loggedInMarker: ${selectors.loggedInMarker}`);
    await this.getPage().waitForSelector(selectors.loggedInMarker, { timeout: 20_000 })
      .then(() => console.log(`${tag} loggedInMarker FOUND`))
      .catch(async () => {
        console.log(`${tag} loggedInMarker NOT found within 20s — current url: ${this.getPage().url()}`);
        // Stop guessing, get real evidence: how many links exist at all,
        // how many elements contain "report" anywhere (case-insensitive,
        // regardless of visibility), and a raw HTML snippet so the actual
        // DOM structure can be read directly instead of inferred.
        const diagPage = this.getPage();
        const linkCount = await diagPage.locator("a").count().catch(() => -1);
        const reportCount = await diagPage.locator("text=/report/i").count().catch(() => -1);
        const bodyHtml = await diagPage.locator("body").innerHTML().catch(() => "<failed to get body>");
        console.log(`${tag} DIAGNOSTIC: total <a> links on page: ${linkCount}`);
        console.log(`${tag} DIAGNOSTIC: elements containing "report" (any case, any visibility): ${reportCount}`);
        console.log(`${tag} DIAGNOSTIC: body HTML length: ${bodyHtml.length} chars`);
        // Look specifically for anything that looks like a sidebar/menu
        // toggle — common PrimeFaces class names for exactly this widget.
        for (const kw of ["menu", "sidebar", "toggle", "hamburger", "layout-menu", "collapse"]) {
          const count = await diagPage.locator(`[class*="${kw}" i]`).count().catch(() => -1);
          if (count > 0) console.log(`${tag} DIAGNOSTIC: ${count} element(s) with class containing "${kw}"`);
        }
        console.log(`${tag} DIAGNOSTIC: body HTML (first 6000 chars):\n${bodyHtml.slice(0, 6000)}`);
      // isLoggedIn() below does the real verification + throws a clear
      // ConnectorError; this catch just avoids an unhandled rejection here.
    });
  }

  async isLoggedIn(): Promise<boolean> {
    const page = this.getPage();
    const marker = page.locator(this.config.selectors.loggedInMarker);
    return (await marker.count()) > 0;
  }

  async syncBalance(): Promise<BalanceReading> {
    const page = this.getPage();
    const { selectors, menuLabels } = this.config;
    const tag = `[${this.airline}:syncBalance]`;

    try {
      // Reports → Invoice Management. Confirmed via codegen against the
      // real Ibom Air portal that these are actual <a role="link"> nav
      // items (a JSF/PrimeFaces-style app), not plain text — role-based
      // matching is more precise than a generic text search here.
      console.log(`${tag} clicking ${menuLabels.reportsMenu} link, current url: ${page.url()}`);
      await page.getByRole("link", { name: menuLabels.reportsMenu }).first().click();
      console.log(`${tag} clicking ${menuLabels.invoiceManagementItem} link, current url: ${page.url()}`);
      await page.getByRole("link", { name: menuLabels.invoiceManagementItem }).first().click();
      console.log(`${tag} waiting up to 15s for totalBalance: ${selectors.totalBalance}, current url: ${page.url()}`);
      await page.waitForSelector(selectors.totalBalance, { timeout: 15_000 });
      console.log(`${tag} totalBalance FOUND`);
    } catch (err) {
      console.log(`${tag} FAILED at current url: ${page.url()} —`, err instanceof Error ? err.message : err);
      throw new ConnectorError(
        `Failed to navigate to ${menuLabels.reportsMenu} \u2192 ${menuLabels.invoiceManagementItem}`,
        SYNC_STEPS.NAVIGATION,
        this.airline,
        err
      );
    }

    const rawBalance = (await page.locator(selectors.totalBalance).first().textContent())?.trim() ?? "";
    const rawCurrency = selectors.currency
      ? (await page.locator(selectors.currency).first().textContent())?.trim()
      : undefined;

    const parsedBalance = parseMoneyString(rawBalance);
    if (parsedBalance === null) {
      throw new ConnectorError(
        `Could not parse a balance from the page text: "${rawBalance}"`,
        SYNC_STEPS.BALANCE_RETRIEVED,
        this.airline
      );
    }

    const partnerCard = await textOrUndefined(page, selectors.partnerCard);
    const invoiceReference = await textOrUndefined(page, selectors.invoiceReference);
    const srName = await textOrUndefined(page, selectors.srName);

    return {
      totalBalance: parsedBalance,
      currency: rawCurrency ?? inferCurrency(rawBalance) ?? "NGN",
      partnerCard,
      invoiceReference,
      srName,
    };
  }

  async logout(): Promise<void> {
    const page = this.getPage();
    if (await page.locator(this.config.selectors.logoutButton).count()) {
      await page.click(this.config.selectors.logoutButton);
    }
  }
}

async function textOrUndefined(page: import("playwright").Page, selector: string): Promise<string | undefined> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return undefined;
  const text = await el.textContent();
  return text?.trim() || undefined;
}

/** Strips currency symbols/commas/whitespace, e.g. "\u20a6 1,204,500.00" -> 1204500. */
function parseMoneyString(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function inferCurrency(raw: string): string | undefined {
  if (raw.includes("\u20a6") || /ngn/i.test(raw)) return "NGN";
  if (raw.includes("$")) return "USD";
  return undefined;
}
