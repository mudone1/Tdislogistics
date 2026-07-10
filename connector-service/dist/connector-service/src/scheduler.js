import cron from "node-cron";
import { runSync } from "../../src/modules/airline-connectors/services/SyncService";
import { AirlineWalletRepository } from "../../src/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "../../src/modules/airline-connectors/services/ConnectorRegistry";
/**
 * Runs continuously inside this long-lived process (which is exactly why
 * connector-service has to be a VPS/Docker deployment, not serverless —
 * a scheduler can't survive between Vercel invocations).
 *
 * Checks every minute which airlines are due, based on each airline's own
 * AirlineConnectorSettings row:
 *   - syncIntervalMinutes: 120  -> "Every 2 Hours"
 *   - dailyRunAtUtc: "00:00"   -> "Daily 00:00"
 *   - neither set               -> manual sync only
 */
export function startScheduler() {
    cron.schedule("* * * * *", async () => {
        const now = new Date();
        const allSettings = await AirlineWalletRepository.listSettings().catch((err) => {
            console.error("[scheduler] failed to load settings:", err);
            return [];
        });
        for (const settings of allSettings) {
            if (!settings.enabled)
                continue;
            if (!ConnectorRegistry.isImplemented(settings.airline))
                continue;
            const wallet = await AirlineWalletRepository.getWallet(settings.airline);
            const dueByInterval = settings.syncIntervalMinutes != null &&
                (!wallet?.lastSynced || minutesSince(wallet.lastSynced, now) >= settings.syncIntervalMinutes);
            const dueByDailyTime = settings.dailyRunAtUtc != null &&
                isWithinCurrentMinute(settings.dailyRunAtUtc, now) &&
                !wasAlreadySyncedToday(wallet?.lastSynced ?? null, now);
            if (dueByInterval || dueByDailyTime) {
                console.log(`[scheduler] triggering scheduled sync for ${settings.airline}`);
                runSync(settings.airline, "SCHEDULED").catch((err) => console.error(`[scheduler] sync failed for ${settings.airline}:`, err));
            }
        }
    });
    console.log("[scheduler] started — checking due airlines every minute");
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
