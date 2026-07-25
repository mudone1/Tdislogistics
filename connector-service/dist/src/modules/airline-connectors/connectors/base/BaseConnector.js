"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseConnector = void 0;
const playwright_1 = require("playwright");
const types_1 = require("../../core/types");
const retry_1 = require("../../core/retry");
const SyncRunLogger_1 = require("../../logs/SyncRunLogger");
/**
 * Shared skeleton every connector is built on. Concrete connectors
 * (BaseCraneConnector and, later, independent Category B connectors) only
 * need to implement the abstract hooks — browser lifecycle, retry, timing,
 * and structured logging are handled once, here.
 */
class BaseConnector {
    browser = null;
    page = null;
    logger;
    async connect() {
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
        this.browser = await playwright_1.chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            proxy: proxyConfig,
        });
        const context = await this.browser.newContext({ viewport: { width: 1600, height: 900 } });
        // Confirmed via codegen that at least one Crane airline (Ibom) shows a
        // native browser dialog somewhere in the post-login flow (likely tied
        // to the "you have an item in your queue" style notification banners
        // visible on these portals). Registered at the CONTEXT level so it
        // covers both the original page and any popup window opened during
        // login — an unhandled dialog can otherwise silently block all further
        // interaction on that page.
        context.on("dialog", (dialog) => {
            this.logger?.log("DIALOG", `Auto-dismissing dialog: "${dialog.message()}"`, "info");
            dialog.dismiss().catch(() => { });
        });
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
            throw new types_1.ConnectorError("connect() was not called before use", "INTERNAL", this.airline);
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
        this.logger = new SyncRunLogger_1.SyncRunLogger(this.airline, runId);
        try {
            const balance = await (0, retry_1.retryWithBackoff)(async () => {
                await this.connect();
                this.logger.log(SyncRunLogger_1.SYNC_STEPS.LOGIN_STARTED, `Logging in to ${this.displayName}`);
                await this.login(credentials);
                const loggedIn = await this.isLoggedIn();
                if (!loggedIn) {
                    throw new types_1.ConnectorError("Login did not reach an authenticated state", SyncRunLogger_1.SYNC_STEPS.LOGIN_STARTED, this.airline);
                }
                this.logger.log(SyncRunLogger_1.SYNC_STEPS.LOGIN_SUCCESS, "Authenticated session confirmed");
                this.logger.log(SyncRunLogger_1.SYNC_STEPS.NAVIGATION, "Navigating to Reports \u2192 Invoice Management");
                const reading = await this.syncBalance();
                this.logger.log(SyncRunLogger_1.SYNC_STEPS.BALANCE_RETRIEVED, `Balance ${reading.totalBalance} ${reading.currency} read successfully`);
                return reading;
            }, {
                maxAttempts: 3,
                onRetry: (attempt, err) => {
                    this.logger.log(SyncRunLogger_1.SYNC_STEPS.ERROR, `Attempt ${attempt} failed: ${err.message}`, "warn");
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
            this.logger.log(SyncRunLogger_1.SYNC_STEPS.ERROR, message, "error");
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
            this.logger.log(SyncRunLogger_1.SYNC_STEPS.LOGOUT, "Logged out cleanly");
        }
        catch (err) {
            this.logger.log(SyncRunLogger_1.SYNC_STEPS.LOGOUT, `Logout failed (continuing): ${err.message}`, "warn");
        }
        finally {
            await this.disconnect();
        }
    }
}
exports.BaseConnector = BaseConnector;
