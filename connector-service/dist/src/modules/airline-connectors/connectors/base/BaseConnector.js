import { chromium } from "playwright";
import { ConnectorError } from "../../core/types";
import { retryWithBackoff } from "../../core/retry";
import { SyncRunLogger, SYNC_STEPS } from "../../logs/SyncRunLogger";
/**
 * Shared skeleton every connector is built on. Concrete connectors
 * (BaseCraneConnector and, later, independent Category B connectors) only
 * need to implement the abstract hooks — browser lifecycle, retry, timing,
 * and structured logging are handled once, here.
 */
export class BaseConnector {
    browser = null;
    page = null;
    logger;
    async connect() {
        // headless: true is required for server/CI environments; flip to false
        // locally only when actively debugging a selector with Playwright's
        // inspector (`PWDEBUG=1 npm run …`).
        this.browser = await chromium.launch({ headless: true });
        const context = await this.browser.newContext();
        this.page = await context.newPage();
    }
    async syncTransactions() {
        // Not in scope for Phase 1 (see spec — "Do NOT build booking automation").
        // Left as a no-op hook so the interface is satisfied and Phase 2 can
        // override it per-connector without touching this base class.
        this.logger?.log("SYNC_TRANSACTIONS", "Skipped — not implemented in Phase 1", "info");
    }
    async disconnect() {
        try {
            await this.page?.close();
            await this.browser?.close();
        }
        finally {
            this.page = null;
            this.browser = null;
        }
    }
    getPage() {
        if (!this.page)
            throw new ConnectorError("connect() was not called before use", "INTERNAL", this.airline);
        return this.page;
    }
    /**
     * Full run: connect → login → verify → syncBalance → logout → disconnect,
     * wrapped in retry-with-backoff and structured logging. This is what
     * SyncService actually calls — individual lifecycle methods above stay
     * public mainly for targeted testing ("Test Connection" in Admin calls
     * connect() + login() + isLoggedIn() + disconnect() only, no balance read).
     */
    async runFullSync(credentials, runId) {
        const started = Date.now();
        this.logger = new SyncRunLogger(this.airline, runId);
        try {
            const balance = await retryWithBackoff(async () => {
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
                this.logger.log(SYNC_STEPS.BALANCE_RETRIEVED, `Balance ${reading.totalBalance} ${reading.currency} read successfully`);
                return reading;
            }, {
                maxAttempts: 3,
                onRetry: (attempt, err) => {
                    this.logger.log(SYNC_STEPS.ERROR, `Attempt ${attempt} failed: ${err.message}`, "warn");
                },
            }).catch(async (err) => {
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
        }
        catch (err) {
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
    async safeLogoutAndDisconnect() {
        try {
            await this.logout();
            this.logger.log(SYNC_STEPS.LOGOUT, "Logged out cleanly");
        }
        catch (err) {
            this.logger.log(SYNC_STEPS.LOGOUT, `Logout failed (continuing): ${err.message}`, "warn");
        }
        finally {
            await this.disconnect();
        }
    }
}
