import crypto from "crypto";
import { ConnectorRegistry } from "./ConnectorRegistry";
import { AirlineWalletRepository } from "../storage/AirlineWalletRepository";
import { decryptSecret } from "./CredentialService";
import { mirrorBalanceToFirestore } from "./FirestoreMirrorService";
/**
 * The one place a sync actually happens, end to end:
 *
 *   Airline Portal -> Connector (Playwright) -> PostgreSQL (source of truth)
 *   -> Sync Service -> Firestore (realtime dashboard) + future analytics
 *
 * Only ever invoked from connector-service (this needs a real browser —
 * it cannot run on Vercel/serverless). The Next.js app never imports this
 * directly; it calls connector-service's HTTP API instead.
 */
export async function runSync(airline, trigger) {
    const runId = crypto.randomUUID();
    const settings = await AirlineWalletRepository.getSettings(airline);
    if (!settings?.enabled) {
        return { airline, status: "FAILED", error: "Connector is not enabled", durationMs: 0, runId };
    }
    if (!settings.encryptedUsername || !settings.encryptedPassword) {
        return { airline, status: "FAILED", error: "No credentials configured", durationMs: 0, runId };
    }
    const connector = ConnectorRegistry.create(airline);
    const credentials = {
        username: decryptSecret(settings.encryptedUsername),
        password: decryptSecret(settings.encryptedPassword),
    };
    const result = await connector.runFullSync(credentials, runId);
    // 1. PostgreSQL — source of truth, append-only history + current pointer.
    await AirlineWalletRepository.recordSyncResult(result, connector.constructor.name, trigger);
    // 2. Firestore — realtime mirror for the existing dashboard. Best-effort:
    //    a Firestore hiccup shouldn't make an otherwise-successful sync look
    //    failed, since Postgres already has the authoritative record.
    if (result.status === "SUCCESS" && result.balance) {
        try {
            await mirrorBalanceToFirestore(airline, result.balance.totalBalance);
        }
        catch (err) {
            console.error(`[SyncService] Firestore mirror failed for ${airline} (Postgres write succeeded):`, err);
        }
    }
    return result;
}
/** Used by the "Test Connection" admin action — no balance read/save, just verifies login works. */
export async function testConnection(airline) {
    const settings = await AirlineWalletRepository.getSettings(airline);
    if (!settings?.encryptedUsername || !settings.encryptedPassword) {
        return { success: false, error: "No credentials configured" };
    }
    const connector = ConnectorRegistry.create(airline);
    const credentials = {
        username: decryptSecret(settings.encryptedUsername),
        password: decryptSecret(settings.encryptedPassword),
    };
    try {
        await connector.connect();
        await connector.login(credentials);
        const ok = await connector.isLoggedIn();
        await connector.disconnect();
        await AirlineWalletRepository.setConnectionStatus(airline, ok ? "CONNECTED" : "ERROR");
        return ok ? { success: true } : { success: false, error: "Login did not reach an authenticated state" };
    }
    catch (err) {
        await connector.disconnect().catch(() => { });
        await AirlineWalletRepository.setConnectionStatus(airline, "ERROR");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
