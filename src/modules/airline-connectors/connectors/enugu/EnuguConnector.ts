import { BaseConnector } from "../base/BaseConnector";
import type { BalanceReading, DecryptedCredentials } from "../../core/types";
import { ConnectorError } from "../../core/types";

// VERIFIED via live DOM inspection of a real logged-in session
// (https://booking.enuguairlines.com) — a VARS/Videcom-style ASP.NET
// WebForms agent portal, a completely different platform from the Crane
// airlines (Aero/AirPeace/Arik/Ibom), hence extending BaseConnector
// directly rather than BaseCraneConnector (see connectors/README.md).
//
// - Login fields: #txtSineCode (the agent "Sine code", VARS/Videcom's
//   term for an agent sign-in id — not a username in the usual sense)
//   and #txtPassword. #btnOk is a plain <input type="button">, not a
//   submit — it has its own click handler that does an async postback,
//   so login() waits for the logged-in marker rather than a navigation
//   event.
// - There's no dedicated "balance" page — the current balance only
//   shows inside the "Replenish Account" modal (Account menu ->
//   Replenish Account), as "Agent Credit Limit = <amount> NGN" in a
//   bare <h3> with no id/class. That modal also has a live "Pay NOW"
//   button right next to Cancel — syncBalance() must close it via
//   Cancel specifically, never anything that could submit a payment.
const LOGIN_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx";
const LOGGED_IN_MARKER = "text=/Logged in as:/i";
const CREDIT_LIMIT_TEXT = "text=/Agent Credit Limit\\s*=\\s*[\\d,]+/i";
const CREDIT_LIMIT_PATTERN = /Agent Credit Limit\s*=\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{2,4})/i;

export class EnuguConnector extends BaseConnector {
  readonly airline = "ENUGU" as const;
  readonly displayName = "Enugu Air";

  async login(credentials: DecryptedCredentials): Promise<void> {
    const page = this.getPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    await page.locator("#txtSineCode").fill(credentials.username);
    await page.locator("#txtPassword").fill(credentials.password);
    await page.locator("#btnOk").click();

    // #btnOk drives an async postback rather than a plain form submit, so
    // there's no reliable navigation event to await — wait directly for
    // the marker isLoggedIn() also checks.
    await page.locator(LOGGED_IN_MARKER).waitFor({ state: "visible", timeout: 20000 });
  }

  async isLoggedIn(): Promise<boolean> {
    const page = this.getPage();
    return page
      .locator(LOGGED_IN_MARKER)
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async syncBalance(): Promise<BalanceReading> {
    const page = this.getPage();

    await page.locator('role=link[name="Account"]').click();
    await page.locator('role=link[name="Replenish Account"]').click();

    const creditLimitLocator = page.locator(CREDIT_LIMIT_TEXT).first();
    await creditLimitLocator.waitFor({ state: "visible", timeout: 15000 });
    const text = await creditLimitLocator.textContent();

    // Close the modal via Cancel specifically — it sits right next to a
    // live "Pay NOW" button, and this must never risk clicking that.
    const cancelButton = page.locator('role=button[name="Cancel"]');
    await cancelButton.click().catch(() => {
      /* best-effort close — a stale/re-rendered modal shouldn't fail the whole sync */
    });

    const match = text ? CREDIT_LIMIT_PATTERN.exec(text) : null;
    if (!match) {
      throw new ConnectorError(
        `Could not parse "Agent Credit Limit" text: "${text ?? "(empty)"}"`,
        "BALANCE_RETRIEVED",
        this.airline
      );
    }

    const totalBalance = parseFloat(match[1].replace(/,/g, ""));
    const currency = match[2].toUpperCase();
    return { totalBalance, currency };
  }

  async logout(): Promise<void> {
    const page = this.getPage();
    // role=...[name=/regex/] isn't reliably supported (confirmed the hard
    // way on the Ibom connector — see its comments); using the plain text
    // engine here for the same reason, since the accessible name includes
    // the logged-in agent's name after the colon and isn't a fixed string.
    await page.locator(LOGGED_IN_MARKER).click();
    await page.locator('a:has-text("Sine out")').click();
  }
}
