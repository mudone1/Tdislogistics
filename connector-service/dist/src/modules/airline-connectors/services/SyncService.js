"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSync = runSync;
exports.testConnection = testConnection;
const crypto_1 = __importDefault(require("crypto"));
const ConnectorRegistry_1 = require("./ConnectorRegistry");
const AirlineWalletRepository_1 = require("../storage/AirlineWalletRepository");
const CredentialService_1 = require("./CredentialService");
const ErrorClassificationService_1 = require("./ErrorClassificationService");
const AuthFailureService_1 = require("./AuthFailureService");
/**
 * The one place a sync actually happens, end to end:
 *
 *   Airline Portal -> Connector (Playwright) -> PostgreSQL (source of truth)
 *
 * Only ever invoked from connector-service (this needs a real browser —
 * it cannot run on Vercel/serverless). The Next.js app never imports this
 * directly; it calls connector-service's HTTP API instead.
 *
 * Deliberately does NOT mirror into the existing Firestore `balances`
 * document (the one "Airline Deposits" manually edits via Set
 * Balance/+Fund) — the Airlines tab reads the synced balance straight
 * from Postgres via /api/connectors instead (see AirlinesSection.tsx),
 * so a connector sync can never clobber a manually-entered deposit
 * figure and vice versa. This used to mirror into Firestore
 * (FirestoreMirrorService, now removed) before that separation existed.
 *
 * NEW: Integrates with ErrorClassificationService and AuthFailureService
 * for smart error handling and cooldown management.
 */
async function runSync(airline, trigger, runId, initiatedBy) {
    const finalRunId = runId || crypto_1.default.randomUUID();
    const started = Date.now();
    const settings = await AirlineWalletRepository_1.AirlineWalletRepository.getSettings(airline);
    if (!settings?.enabled) {
        return {
            airline,
            status: "FAILED",
            error: "Connector is not enabled",
            durationMs: Date.now() - started,
            runId: finalRunId,
            errorCategory: "UNKNOWN",
        };
    }
    if (!settings.encryptedUsername || !settings.encryptedPassword) {
        return {
            airline,
            status: "FAILED",
            error: "No credentials configured",
            durationMs: Date.now() - started,
            runId: finalRunId,
            errorCategory: "UNKNOWN",
        };
    }
    const connector = ConnectorRegistry_1.ConnectorRegistry.create(airline);
    const credentials = {
        username: (0, CredentialService_1.decryptSecret)(settings.encryptedUsername),
        password: (0, CredentialService_1.decryptSecret)(settings.encryptedPassword),
    };
    const result = await connector.runFullSync(credentials, finalRunId);
    const durationMs = Date.now() - started;
    // Classify error if sync failed
    let errorCategory;
    if (result.status === "FAILED" && result.error) {
        const classified = ErrorClassificationService_1.ErrorClassificationService.classify(result.error);
        errorCategory = classified.category;
        // Record auth failure and enter cooldown if auth error
        if (classified.shouldEnterCooldown) {
            await AuthFailureService_1.AuthFailureService.recordAuthFailure(airline, result.error);
        }
    }
    // Record sync result with categorization and metadata
    await AirlineWalletRepository_1.AirlineWalletRepository.recordSyncResult({ ...result, durationMs, errorCategory, runId: finalRunId, initiatedBy }, connector.constructor.name, trigger);
    return { ...result, durationMs, errorCategory, runId: finalRunId };
}
/** Used by the "Test Connection" admin action — no balance read/save, just verifies login works. */
async function testConnection(airline) {
    const settings = await AirlineWalletRepository_1.AirlineWalletRepository.getSettings(airline);
    if (!settings?.encryptedUsername || !settings.encryptedPassword) {
        return { success: false, error: "No credentials configured" };
    }
    const connector = ConnectorRegistry_1.ConnectorRegistry.create(airline);
    const credentials = {
        username: (0, CredentialService_1.decryptSecret)(settings.encryptedUsername),
        password: (0, CredentialService_1.decryptSecret)(settings.encryptedPassword),
    };
    try {
        await connector.connect();
        await connector.login(credentials);
        const ok = await connector.isLoggedIn();
        await connector.disconnect();
        await AirlineWalletRepository_1.AirlineWalletRepository.setConnectionStatus(airline, ok ? "CONNECTED" : "ERROR");
        return ok ? { success: true } : { success: false, error: "Login did not reach an authenticated state" };
    }
    catch (err) {
        await connector.disconnect().catch(() => { });
        await AirlineWalletRepository_1.AirlineWalletRepository.setConnectionStatus(airline, "ERROR");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
