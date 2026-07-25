"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const SyncService_1 = require("../../src/modules/airline-connectors/services/SyncService");
const AirlineWalletRepository_1 = require("../../src/modules/airline-connectors/storage/AirlineWalletRepository");
const ConnectorRegistry_1 = require("../../src/modules/airline-connectors/services/ConnectorRegistry");
const ConfigService_1 = require("../../src/modules/airline-connectors/services/ConfigService");
const AuthFailureService_1 = require("../../src/modules/airline-connectors/services/AuthFailureService");
const SyncHistoryService_1 = require("../../src/modules/airline-connectors/services/SyncHistoryService");
/**
 * Runs continuously inside this long-lived process (which is exactly why
 * connector-service has to be a VPS/Docker deployment, not serverless —
 * a scheduler can't survive between Vercel invocations).
 *
 * Checks every minute which airlines are due, based on each airline's own
 * AirlineConnectorSettings row:
 *   - syncIntervalMinutes: 30  -> "Every 30 Minutes"
 *   - dailyRunAtUtc: "00:00"   -> "Daily 00:00 UTC"
 *   - neither set               -> manual sync only
 *
 * NEW: Respects auth cooldown windows and supports concurrent syncs.
 */
function startScheduler() {
    node_cron_1.default.schedule("* * * * *", async () => {
        try {
            await runSchedulerTick();
        }
        catch (err) {
            console.error("[scheduler] tick failed:", err);
        }
    });
    console.log("[scheduler] started — checking due airlines every minute");
}
async function runSchedulerTick() {
    const now = new Date();
    const allSettings = await AirlineWalletRepository_1.AirlineWalletRepository.listSettings().catch((err) => {
        console.error("[scheduler] failed to load settings:", err);
        return [];
    });
    // Collect airlines that are due for sync
    const dueAirlines = [];
    for (const settings of allSettings) {
        if (!settings.enabled)
            continue;
        if (!ConnectorRegistry_1.ConnectorRegistry.isImplemented(settings.airline))
            continue;
        // Check if in auth cooldown — skip this airline if so
        const inCooldown = await AuthFailureService_1.AuthFailureService.isInAuthCooldown(settings.airline);
        if (inCooldown) {
            const remaining = await AuthFailureService_1.AuthFailureService.getAuthCooldownRemaining(settings.airline);
            console.log(`[scheduler] skipping ${settings.airline} — in auth cooldown for ${Math.ceil(remaining / 1000 / 60)} more minutes`);
            continue;
        }
        const wallet = await AirlineWalletRepository_1.AirlineWalletRepository.getWallet(settings.airline);
        // Check if due by interval
        const dueByInterval = settings.syncIntervalMinutes != null &&
            (!wallet?.lastSynced || minutesSince(wallet.lastSynced, now) >= settings.syncIntervalMinutes);
        // Check if due by daily time
        const dueByDailyTime = settings.dailyRunAtUtc != null &&
            isWithinCurrentMinute(settings.dailyRunAtUtc, now) &&
            !wasAlreadySyncedToday(wallet?.lastSynced ?? null, now);
        if (dueByInterval || dueByDailyTime) {
            dueAirlines.push(settings.airline);
        }
    }
    if (dueAirlines.length === 0) {
        console.log("[scheduler] no airlines due for sync");
        return;
    }
    console.log(`[scheduler] ${dueAirlines.length} airline${dueAirlines.length === 1 ? "" : "s"} due for sync`);
    // Get concurrency limit from config
    const config = await ConfigService_1.ConfigService.getAirlineConnectorConfig();
    const maxConcurrency = config.maxConcurrentSyncs;
    // Create sync run
    const runId = await SyncHistoryService_1.SyncHistoryService.createSyncRun("SCHEDULED", "scheduler", dueAirlines.length);
    // Track results
    const results = {
        successfulCount: 0,
        failedCount: 0,
        skippedCount: 0,
        authFailureCount: 0,
        networkFailureCount: 0,
        portalFailureCount: 0,
        unknownFailureCount: 0,
    };
    const startTime = Date.now();
    // === CONCURRENT SYNC WITH LIMIT ===
    for (let i = 0; i < dueAirlines.length; i += maxConcurrency) {
        const batch = dueAirlines.slice(i, i + maxConcurrency);
        console.log(`[scheduler] syncing batch ${Math.floor(i / maxConcurrency) + 1}: ${batch.join(", ")}`);
        const batchResults = await Promise.allSettled(batch.map((airline) => (0, SyncService_1.runSync)(airline, "SCHEDULED")
            .then((result) => {
            // Track result categorization
            if (result.status === "SUCCESS") {
                results.successfulCount++;
            }
            else if (result.status === "FAILED") {
                results.failedCount++;
                const errorCategory = result.errorCategory;
                if (errorCategory === "AUTH")
                    results.authFailureCount++;
                else if (errorCategory === "NETWORK")
                    results.networkFailureCount++;
                else if (errorCategory === "PORTAL")
                    results.portalFailureCount++;
                else
                    results.unknownFailureCount++;
            }
            else {
                results.failedCount++;
            }
            return result;
        })
            .catch((err) => {
            results.failedCount++;
            console.error(`[scheduler] sync failed for ${airline}:`, err);
            return { status: "FAILED", error: String(err), airline };
        })));
        // Log batch completion
        const successful = batchResults.filter((r) => r.status === "fulfilled").length;
        const failed = batchResults.filter((r) => r.status === "rejected").length;
        console.log(`[scheduler] batch complete: ${successful} succeeded, ${failed} failed`);
    }
    const durationMs = Date.now() - startTime;
    // Complete sync run with final results
    await SyncHistoryService_1.SyncHistoryService.completeSyncRun(runId, {
        ...results,
        parallelism: maxConcurrency,
    });
    console.log(`[scheduler] sync run ${runId} complete in ${durationMs}ms: ` +
        `${results.successfulCount} succeeded, ${results.failedCount} failed, ${results.skippedCount} skipped`);
}
function minutesSince(date, now) {
    return (now.getTime() - date.getTime()) / 60_000;
}
function isWithinCurrentMinute(hhmm, now) {
    const [h, m] = hhmm.split(":").map(Number);
    return now.getUTCHours() === h && now.getUTCMinutes() === m;
}
function wasAlreadySyncedToday(lastSynced, now) {
    if (!lastSynced)
        return false;
    return (lastSynced.getUTCFullYear() === now.getUTCFullYear() &&
        lastSynced.getUTCMonth() === now.getUTCMonth() &&
        lastSynced.getUTCDate() === now.getUTCDate());
}
