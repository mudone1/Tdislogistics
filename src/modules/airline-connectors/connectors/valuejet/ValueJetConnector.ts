import { BaseConnector } from "../base/BaseConnector";
import type { AirlineKey, BalanceReading, DecryptedCredentials } from "../../core/types";
import { ConnectorError } from "../../core/types";
import { SYNC_STEPS } from "../../logs/SyncRunLogger";

const LOGIN_URL = "https://kiu.click/login/";

// ValueJet's B2B agent portal — a KIU System Solutions white-label app,
// completely separate from both the VARS/Videcom platform (Enugu/United/
// Rano/XeJet) and the Crane platform (Air Peace/Aero/Arik/Ibom/NG Eagle),
// and ALSO separate from ValueJet's own public B2C booking site
// (flyvaluejet.com — see ValueJetSearch.ts) that flight-search uses. Do not
// confuse the two: this file is for the login-gated balance-sync side only.
//
// Login form VERIFIED via live DOM inspection (2026-08-07): a modern React
// SPA, not a legacy ASP.NET/JSF app like the other platforms —
// input[name="username"] (type=email) / input[name="password"], a
// type=submit "Log in" button that starts disabled until both fields have
// valid content (standard React form validation, no manual enable step
// needed since page.fill() dispatches the input events React listens for).
//
// Everything AFTER submit is UNVERIFIED — reaching it requires a real agent
// login, which needs credentials only the user has (entered via the
// Airline Connectors tab, never via this session). isLoggedIn()/
// syncBalance() below are a best-effort first pass with heavy diagnostic
// logging on failure, matching the same "log real evidence, don't guess
// blind" approach BaseCraneConnector uses — the first live "Test
// Connection" run's logs are expected to reveal what needs fixing here.
export class ValueJetConnector extends BaseConnector {
  readonly airline: AirlineKey = "VALUEJET";
  readonly displayName = "ValueJet";

  async login(credentials: DecryptedCredentials): Promise<void> {
    const page = this.getPage();
    const tag = `[${this.airline}:login]`;

    console.log(`${tag} navigating to login page: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    console.log(`${tag} filling username`);
    await page.fill('input[name="username"]', credentials.username);
    console.log(`${tag} filling password`);
    await page.fill('input[name="password"]', credentials.password);

    const loginButton = page.locator('button[type="submit"]', { hasText: "Log in" });
    console.log(`${tag} waiting for Log in button to enable`);
    await loginButton
      .evaluate((el) => !(el as HTMLButtonElement).disabled, { timeout: 5000 })
      .catch(() => {});

    console.log(`${tag} clicking Log in`);
    await loginButton.click();

    // React SPA — no full page navigation to wait on, just give the app
    // time to authenticate and route to its dashboard.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log(`${tag} settled at url: ${page.url()}`);
  }

  async isLoggedIn(): Promise<boolean> {
    const page = this.getPage();
    const tag = `[${this.airline}:isLoggedIn]`;

    // Best-effort heuristic: a failed login stays on /login/ (with an
    // inline error), a successful one routes away from it. Real dashboard
    // markers can replace this once a live login run reveals the actual
    // post-login page structure.
    const stillOnLogin = page.url().includes("/login");
    if (stillOnLogin) {
      console.log(`${tag} still on login page — url: ${page.url()}`);
      const visibleText = await page.locator("body").innerText().catch(() => "<failed to read text>");
      console.log(`${tag} DIAGNOSTIC — visible page text (first 2000 chars):\n${visibleText.slice(0, 2000)}`);
      return false;
    }
    console.log(`${tag} navigated away from /login — url: ${page.url()}`);
    return true;
  }

  async syncBalance(): Promise<BalanceReading> {
    const page = this.getPage();
    const tag = `[${this.airline}:syncBalance]`;

    // UNVERIFIED — no confirmed selector for ValueJet's balance/wallet
    // display yet (requires a real login to observe). Best-effort: scan
    // for a naira-formatted number anywhere on whatever page login landed
    // on, and dump full diagnostics if that comes up empty so the real
    // structure can be read directly from the logs instead of guessed.
    const balanceLocator = page.locator("text=/₦\\s?[\\d,]+(\\.\\d{2})?/").first();
    const found = (await balanceLocator.count().catch(() => 0)) > 0;

    if (!found) {
      console.log(`${tag} no naira-formatted balance found on page — url: ${page.url()}`);
      const bodyHtml = await page.locator("body").innerHTML().catch(() => "<failed to get body>");
      console.log(`${tag} DIAGNOSTIC: body HTML length: ${bodyHtml.length} chars`);
      console.log(`${tag} DIAGNOSTIC: body HTML (first 6000 chars):\n${bodyHtml.slice(0, 6000)}`);
      throw new ConnectorError(
        "Could not find a balance figure on the post-login page — selectors need updating once the real dashboard layout is known (see DIAGNOSTIC log)",
        SYNC_STEPS.BALANCE_RETRIEVED,
        this.airline
      );
    }

    const rawBalance = (await balanceLocator.textContent())?.trim() ?? "";
    const parsedBalance = parseMoneyString(rawBalance);
    if (parsedBalance === null) {
      throw new ConnectorError(
        `Could not parse a balance from the page text: "${rawBalance}"`,
        SYNC_STEPS.BALANCE_RETRIEVED,
        this.airline
      );
    }

    return { totalBalance: parsedBalance, currency: "NGN" };
  }

  async logout(): Promise<void> {
    const page = this.getPage();
    const logoutControl = page.locator('button:has-text("Log out"), button:has-text("Logout"), a:has-text("Log out")').first();
    if ((await logoutControl.count().catch(() => 0)) > 0) {
      await logoutControl.click().catch(() => {});
    }
  }
}

/** Strips currency symbols/commas/whitespace, e.g. "₦ 1,204,500.00" -> 1204500. */
function parseMoneyString(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}
