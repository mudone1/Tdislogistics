import crypto from "crypto";
import { ConnectorRegistry } from "./ConnectorRegistry";
import { AirlineWalletRepository } from "../storage/AirlineWalletRepository";
import { decryptSecret } from "./CredentialService";
import { ErrorClassificationService } from "./ErrorClassificationService";
import { AuthFailureService } from "./AuthFailureService";
import type { AirlineKey, SyncResult, SyncTrigger } from "../core/types";

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
export async function runSync(
  airline: AirlineKey,
  trigger: SyncTrigger,
  runId?: string,
  initiatedBy?: string
): Promise<SyncResult & { errorCategory?: string }> {
  const finalRunId = runId || crypto.randomUUID();
  const started = Date.now();

  const settings = await AirlineWalletRepository.getSettings(airline);
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

  const connector = ConnectorRegistry.create(airline);
  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  const result = await connector.runFullSync(credentials, finalRunId);
  const durationMs = Date.now() - started;

  // Classify error if sync failed
  let errorCategory: string | undefined;
  if (result.status === "FAILED" && result.error) {
    const classified = ErrorClassificationService.classify(result.error);
    errorCategory = classified.category;

    // Record auth failure and enter cooldown if auth error
    if (classified.shouldEnterCooldown) {
      await AuthFailureService.recordAuthFailure(airline, result.error);
    }
  }

  // Record sync result with categorization and metadata
  await AirlineWalletRepository.recordSyncResult(
    { ...result, durationMs, errorCategory, runId: finalRunId, initiatedBy },
    connector.constructor.name,
    trigger
  );

  return { ...result, durationMs, errorCategory, runId: finalRunId };
}

/** Used by the "Test Connection" admin action — no balance read/save, just verifies login works. */
export async function testConnection(airline: AirlineKey): Promise<{ success: boolean; error?: string }> {
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
  } catch (err) {
    await connector.disconnect().catch(() => {});
    await AirlineWalletRepository.setConnectionStatus(airline, "ERROR");
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
