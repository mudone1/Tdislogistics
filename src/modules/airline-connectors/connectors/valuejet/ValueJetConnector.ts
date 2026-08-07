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
// Login form: input[name="username"] (type=email) / input[name="password"],
// a type=submit "Log in" button. CORRECTED after the first live "Test
// Connection" run (2026-08-07): this is a Vue/PrimeVue app, not React as
// originally assumed (the earlier "page.fill() dispatches the input events
// React listens for" reasoning doesn't actually apply here, though fill()
// still works fine for a standard Vue v-model input) — confirmed from the
// real failure's call log showing PrimeVue's own component markers
// (data-pc-name, data-pc-section="mask"). The actual failure wasn't a
// permanently-disabled button; it was a PrimeVue dialog mask
// (data-pc-section="mask", a real modal backdrop, not decorative) sitting
// on top of the form and intercepting every click for the full 30s
// timeout — the button itself was fine. dismissBlockingOverlay() below
// makes a best-effort attempt to close it (Escape, then any visible
// accept/close/continue button) before proceeding; a diagnostic dump on
// failure captures the overlay's actual content if this guess is wrong.
//
// Everything AFTER submit is UNVERIFIED — reaching it requires a real agent
// login, which needs credentials only the user has (entered via the
// Airline Connectors tab, never via this session). isLoggedIn()/
// syncBalance() below are a best-effort first pass with heavy diagnostic
// logging on failure, matching the same "log real evidence, don't guess
// blind" approach BaseCraneConnector uses.

// PrimeVue's own dialog-mask marker — appears for ANY real modal (cookie
// consent, terms/update prompt, session notice, etc.), not just a
// specific known one. Escape first (closes most PrimeVue dialogs without
// needing to find a specific button), then fall back to whatever
// accept/close/continue-shaped button is actually visible inside it.
async function dismissBlockingOverlay(page: import("playwright").Page, tag: string): Promise<void> {
  const mask = page.locator('[data-pc-section="mask"]').first();
  if (!(await mask.count().catch(() => 0))) return;

  console.log(`${tag} a dialog mask is present — attempting to dismiss it before continuing`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  if (await mask.count().catch(() => 0)) {
    const dismissButton = page
      .locator('button, [role="button"]')
      .filter({ hasText: /accept|agree|close|continue|got it|ok|dismiss|proceed/i })
      .first();
    if (await dismissButton.count().catch(() => 0)) {
      await dismissButton.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  if (await mask.count().catch(() => 0)) {
    const maskText = await mask.innerText().catch(() => "<failed to read mask text>");
    console.log(`${tag} dialog mask still present after dismiss attempts — DIAGNOSTIC text: ${maskText.slice(0, 1000)}`);
  } else {
    console.log(`${tag} dialog mask dismissed`);
  }
}

export class ValueJetConnector extends BaseConnector {
  readonly airline: AirlineKey = "VALUEJET";
  readonly displayName = "ValueJet";

  async login(credentials: DecryptedCredentials): Promise<void> {
    const page = this.getPage();
    const tag = `[${this.airline}:login]`;

    console.log(`${tag} navigating to login page: ${LOGIN_URL}`);
    // networkidle (not just domcontentloaded) — a Vue SPA's real UI mounts
    // after its JS bundle finishes loading, not at domcontentloaded; the
    // first live run's dialog-mask-blocks-everything failure is consistent
    // with interacting before the app (and whatever first-load dialog it
    // shows) had actually settled.
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" }).catch(async () => {
      console.log(`${tag} networkidle wait timed out, proceeding anyway`);
    });
    await dismissBlockingOverlay(page, tag);

    console.log(`${tag} filling username`);
    await page.fill('input[name="username"]', credentials.username);
    console.log(`${tag} filling password`);
    await page.fill('input[name="password"]', credentials.password);

    const loginButton = page.locator('button[type="submit"]', { hasText: "Log in" });
    console.log(`${tag} waiting for Log in button to enable`);
    await loginButton
      .evaluate((el) => !(el as HTMLButtonElement).disabled, { timeout: 5000 })
      .catch(() => {});

    // A dialog can also appear AFTER the fields are filled (e.g. a
    // validation/session prompt) — check again right before the click,
    // the actual point that failed live.
    await dismissBlockingOverlay(page, tag);

    console.log(`${tag} clicking Log in`);
    await loginButton.click({ timeout: 15_000 }).catch(async (err) => {
      // Same "embed real page state in the thrown error" pattern used
      // throughout the travel-assistant booking modules — the raw
      // Playwright call log already showed WHICH element was blocking the
      // click; this adds WHAT that element actually says, so a repeat
      // failure is diagnosable without needing this modal to reproduce.
      const mask = page.locator('[data-pc-section="mask"]').first();
      const maskPresent = (await mask.count().catch(() => 0)) > 0;
      const maskText = maskPresent ? await mask.innerText().catch(() => "<failed to read>") : null;
      const buttonDisabled = await loginButton.evaluate((el) => (el as HTMLButtonElement).disabled).catch(() => null);
      console.error(
        `${tag} Log in click failed — url: ${page.url()}, maskPresent: ${maskPresent}, buttonDisabled: ${buttonDisabled}, maskText: ${maskText?.slice(0, 1000)}`
      );
      throw err;
    });

    // React/Vue SPA either way — no full page navigation to wait on, just give the app
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
