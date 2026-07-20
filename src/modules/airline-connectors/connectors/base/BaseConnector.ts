import { chromium, type Browser, type Page } from "playwright";
import type { IAirlineConnector } from "../../interfaces/IAirlineConnector";
import type { AirlineKey, BalanceReading, DecryptedCredentials, SyncResult } from "../../core/types";
import { ConnectorError } from "../../core/types";
import { retryWithBackoff } from "../../core/retry";
import { SyncRunLogger, SYNC_STEPS } from "../../logs/SyncRunLogger";

/**
 * Shared skeleton every connector is built on. Concrete connectors
 * (BaseCraneConnector and, later, independent Category B connectors) only
 * need to implement the abstract hooks — browser lifecycle, retry, timing,
 * and structured logging are handled once, here.
 */
export abstract class BaseConnector implements IAirlineConnector {
  abstract readonly airline: AirlineKey;
  abstract readonly displayName: string;

  protected browser: Browser | null = null;
  protected page: Page | null = null;
  protected logger!: SyncRunLogger;

  // Set whenever the portal shows a dialog (alert/confirm) during this
  // connector's lifetime — a wrong-credentials login on these ASP.NET
  // WebForms portals typically surfaces as a JS alert rather than an
  // inline error label. Subclasses can check this right after a login
  // attempt to fail fast on likely-stale credentials instead of waiting
  // out a full timeout (see BaseVarsConnector.login()). Reset it
  // yourself before an attempt where a stale message would be
  // misleading — connect() does NOT clear it automatically.
  protected lastDialogMessage: string | null = null;

  async connect(): Promise<void> {
    // headless: true is required for server/CI environments; flip to false
    // locally only when actively debugging a selector with Playwright's
    // inspector (`PWDEBUG=1 npm run …`).
    // --no-sandbox is required in most container hosting environments
    // (Railway, Render, Fly.io, etc.) — Chromium's sandbox needs
    // unprivileged user namespaces that these platforms' containers
    // typically don't expose, and without this flag the browser fails to
    // launch immediately (not after a timeout), which is indistinguishable
    // from other early failures without checking logs directly.
    // Optional proxy — some airline portals (confirmed via testing: Ibom
    // Air returns USER_AUTHENTICATION_ERROR when logins originate from
    // Railway's US-based servers, but the exact same credentials work
    // fine from a Nigerian residential connection) appear to geo-restrict
    // login attempts. Set PROXY_SERVER (+ optionally PROXY_USERNAME /
    // PROXY_PASSWORD) to route browser traffic through a proxy —
    // completely inert if these aren't set.
    const proxyServer = process.env.PROXY_SERVER;
    const proxyConfig = proxyServer
      ? {
          server: proxyServer,
          username: process.env.PROXY_USERNAME,
          password: process.env.PROXY_PASSWORD,
        }
      : undefined;

    this.browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      proxy: proxyConfig,
    });
    // Explicit wide viewport: this portal's sidebar appears to collapse to
    // icon-only at narrower widths (a responsive breakpoint), which codegen
    // never triggers because it opens a full-size window sized to the
    // screen it's run on. Without this, headless runs may render a
    // meaningfully different, narrower layout than what was recorded.
    const context = await this.browser.newContext({ viewport: { width: 1600, height: 900 } });

    // Confirmed via codegen that at least one Crane airline (Ibom) shows a
    // native browser dialog somewhere in the post-login flow (likely tied
    // to the "you have an item in your queue" style notification banners
    // visible on these portals). Registered at the CONTEXT level so it
    // covers both the original page and any popup window opened during
    // login — an unhandled dialog can otherwise silently block all further
    // interaction on that page.
    context.on("dialog", (dialog) => {
      this.lastDialogMessage = dialog.message();
      this.logger?.log("DIALOG", `Auto-dismissing dialog: "${dialog.message()}"`, "info");
      dialog.dismiss().catch(() => {});
    });

    this.page = await context.newPage();
  }

  abstract login(credentials: DecryptedCredentials): Promise<void>;
  abstract isLoggedIn(): Promise<boolean>;
  abstract syncBalance(): Promise<BalanceReading>;

  async syncTransactions(): Promise<void> {
    // Not in scope for Phase 1 (see spec — "Do NOT build booking automation").
    // Left as a no-op hook so the interface is satisfied and Phase 2 can
    // override it per-connector without touching this base class.
    this.logger?.log("SYNC_TRANSACTIONS", "Skipped — not implemented in Phase 1", "info");
  }

  abstract logout(): Promise<void>;

  async disconnect(): Promise<void> {
    try {
      await this.page?.close();
      await this.browser?.close();
    } finally {
      this.page = null;
      this.browser = null;
    }
  }

  protected getPage(): Page {
    if (!this.page) throw new ConnectorError("connect() was not called before use", "INTERNAL", this.airline);
    return this.page;
  }

  /**
   * Full run: connect → login → verify → syncBalance → logout → disconnect,
   * wrapped in retry-with-backoff and structured logging. This is what
   * SyncService actually calls — individual lifecycle methods above stay
   * public mainly for targeted testing ("Test Connection" in Admin calls
   * connect() + login() + isLoggedIn() + disconnect() only, no balance read).
   */
  async runFullSync(credentials: DecryptedCredentials, runId: string): Promise<SyncResult> {
    const started = Date.now();
    this.logger = new SyncRunLogger(this.airline, runId);

    try {
      const balance = await retryWithBackoff(
        async () => {
          await this.connect();
          this.logger.log(SYNC_STEPS.LOGIN_STARTED, `Logging in to ${this.displayName}`);
          await this.login(credentials);

          const loggedIn = await this.isLoggedIn();
          if (!loggedIn) {
            throw new ConnectorError("Login did not reach an authenticated state", SYNC_STEPS.LOGIN_STARTED, this.airline);
          }
          this.logger.log(SYNC_STEPS.LOGIN_SUCCESS, "Authenticated session confirmed");

          this.logger.log(SYNC_STEPS.NAVIGATION, "Navigating to Reports \u2192 Invoice Management");
          const reading = await this.syncBalance();
          this.logger.log(
            SYNC_STEPS.BALANCE_RETRIEVED,
            `Balance ${reading.totalBalance} ${reading.currency} read successfully`
          );

          return reading;
        },
        {
          maxAttempts: 3,
          onRetry: (attempt, err) => {
            this.logger.log(SYNC_STEPS.ERROR, `Attempt ${attempt} failed: ${(err as Error).message}`, "warn");
          },
        }
      ).catch(async (err) => {
        // Every retry attempt opens a fresh browser via connect() — make
        // sure we tear down whatever's left before giving up.
        await this.safeLogoutAndDisconnect();
        throw err;
      });

      await this.safeLogoutAndDisconnect();

      return {
        airline: this.airline,
        status: "SUCCESS",
        balance,
        durationMs: Date.now() - started,
        runId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.log(SYNC_STEPS.ERROR, message, "error");
      return {
        airline: this.airline,
        status: "FAILED",
        error: message,
        durationMs: Date.now() - started,
        runId,
      };
    }
  }

  private async safeLogoutAndDisconnect() {
    try {
      await this.logout();
      this.logger.log(SYNC_STEPS.LOGOUT, "Logged out cleanly");
    } catch (err) {
      this.logger.log(SYNC_STEPS.LOGOUT, `Logout failed (continuing): ${(err as Error).message}`, "warn");
    } finally {
      await this.disconnect();
    }
  }
}
