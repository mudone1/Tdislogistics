import { BaseConnector } from "../base/BaseConnector";
import type { AirlineKey, BalanceReading, DecryptedCredentials } from "../../core/types";
import { ConnectorError } from "../../core/types";
import type { VarsConnectorConfig } from "./VarsConnectorConfig";

// VERIFIED via live DOM inspection of a real logged-in session against
// Enugu Air (https://booking.enuguairlines.com) — a VARS/Videcom-style
// ASP.NET WebForms agent portal, a completely different platform from the
// Crane airlines (Aero/AirPeace/Arik/Ibom/NGEagle), hence extending
// BaseConnector directly rather than BaseCraneConnector. The three other
// VARS airlines (United Nigeria, XeJet, Rano Air) were confirmed to share
// the exact same pre-login DOM (#txtSineCode/#txtPassword/#btnOk field
// ids) via direct inspection of each one's public login page — the
// post-login/balance flow below is carried over from the one live
// session actually tested (Enugu Air) on the assumption the shared
// booking-engine skin holds there too, same as it does for flight search
// (see travel-assistant/search/vars-platform/VarsFlightSearch.ts). If
// Test Connection succeeds through login but fails at BALANCE_RETRIEVED
// for one of the other three, that's the part to re-verify per-airline.
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
const LOGGED_IN_MARKER = "text=/Logged in as:/i";
const CREDIT_LIMIT_TEXT = "text=/Agent Credit Limit\\s*=\\s*[\\d,]+/i";
const CREDIT_LIMIT_PATTERN = /Agent Credit Limit\s*=\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{2,4})/i;

export abstract class BaseVarsConnector extends BaseConnector {
  readonly airline: AirlineKey;
  readonly displayName: string;
  private readonly loginUrl: string;

  constructor(config: VarsConnectorConfig) {
    super();
    this.airline = config.airline;
    this.displayName = config.displayName;
    this.loginUrl = config.loginUrl;
  }

  async login(credentials: DecryptedCredentials): Promise<void> {
    const page = this.getPage();
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });

    this.lastDialogMessage = null; // clear any leftover message from an earlier attempt
    await page.locator("#txtSineCode").fill(credentials.username);
    await page.locator("#txtPassword").fill(credentials.password);
    await page.locator("#btnOk").click();

    // #btnOk drives an async postback rather than a plain form submit, so
    // there's no reliable navigation event to await — poll for the
    // logged-in marker, but also fail fast (and non-retryably) the
    // moment a dialog appears, since that's how this portal surfaces a
    // rejected login. Sine codes/passwords get rotated every 2-3 months
    // — a rejected login almost always means the stored credential is
    // stale, not a fluke, so hammering the live portal with 3 retries on
    // the same bad password is both pointless and risks the airline's
    // own lockout policy.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (this.lastDialogMessage) {
        throw new ConnectorError(
          `Login rejected — portal said: "${this.lastDialogMessage}". This almost always means the stored ` +
            `password is stale (Sine code/password are reset every 2-3 months) — update credentials in Admin ` +
            `and confirm they're correct before trying again; retrying automatically here would just repeat ` +
            `the same failed login against the live portal.`,
          "LOGIN_STARTED",
          this.airline,
          undefined,
          true
        );
      }
      if (await page.locator(LOGGED_IN_MARKER).isVisible().catch(() => false)) return;
      await page.waitForTimeout(300);
    }

    throw new ConnectorError("Login did not reach an authenticated state within 20s", "LOGIN_STARTED", this.airline);
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
