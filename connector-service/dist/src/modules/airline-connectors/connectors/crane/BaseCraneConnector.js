import { BaseConnector } from "../base/BaseConnector";
import { ConnectorError } from "../../core/types";
import { SYNC_STEPS } from "../../logs/SyncRunLogger";
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
    config;
    airline;
    displayName;
    constructor(config) {
        super();
        this.config = config;
        this.airline = config.airline;
        this.displayName = config.displayName;
    }
    async login(credentials) {
        const page = this.getPage();
        const { selectors, loginUrl } = this.config;
        await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
        await page.fill(selectors.usernameInput, credentials.username);
        await page.fill(selectors.passwordInput, credentials.password);
        await page.click(selectors.loginButton);
        // Crane portals are typical server-rendered dashboards — wait for the
        // post-login marker rather than a fixed timeout, so slow logins don't
        // false-fail and fast ones don't waste time.
        await page.waitForSelector(selectors.loggedInMarker, { timeout: 20_000 }).catch(() => {
            // isLoggedIn() below does the real verification + throws a clear
            // ConnectorError; this catch just avoids an unhandled rejection here.
        });
    }
    async isLoggedIn() {
        const page = this.getPage();
        const marker = page.locator(this.config.selectors.loggedInMarker);
        return (await marker.count()) > 0;
    }
    async syncBalance() {
        const page = this.getPage();
        const { selectors, menuLabels } = this.config;
        try {
            // Reports → Invoice Management, as specified.
            await page.getByText(menuLabels.reportsMenu, { exact: false }).first().click();
            await page.getByText(menuLabels.invoiceManagementItem, { exact: false }).first().click();
            await page.waitForSelector(selectors.totalBalance, { timeout: 15_000 });
        }
        catch (err) {
            throw new ConnectorError(`Failed to navigate to ${menuLabels.reportsMenu} \u2192 ${menuLabels.invoiceManagementItem}`, SYNC_STEPS.NAVIGATION, this.airline, err);
        }
        const rawBalance = (await page.locator(selectors.totalBalance).first().textContent())?.trim() ?? "";
        const rawCurrency = selectors.currency
            ? (await page.locator(selectors.currency).first().textContent())?.trim()
            : undefined;
        const parsedBalance = parseMoneyString(rawBalance);
        if (parsedBalance === null) {
            throw new ConnectorError(`Could not parse a balance from the page text: "${rawBalance}"`, SYNC_STEPS.BALANCE_RETRIEVED, this.airline);
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
    async logout() {
        const page = this.getPage();
        if (await page.locator(this.config.selectors.logoutButton).count()) {
            await page.click(this.config.selectors.logoutButton);
        }
    }
}
async function textOrUndefined(page, selector) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0)
        return undefined;
    const text = await el.textContent();
    return text?.trim() || undefined;
}
/** Strips currency symbols/commas/whitespace, e.g. "\u20a6 1,204,500.00" -> 1204500. */
function parseMoneyString(raw) {
    const cleaned = raw.replace(/[^0-9.-]/g, "");
    if (!cleaned)
        return null;
    const value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
}
function inferCurrency(raw) {
    if (raw.includes("\u20a6") || /ngn/i.test(raw))
        return "NGN";
    if (raw.includes("$"))
        return "USD";
    return undefined;
}
