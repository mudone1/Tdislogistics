import { prisma } from "./prismaClient";
/**
 * Repository pattern — SyncService and API routes talk to this, never to
 * `prisma` directly. Keeps the Prisma schema an implementation detail that
 * can change without rippling through the rest of the framework.
 */
export const AirlineWalletRepository = {
    async getWallet(airline) {
        return prisma.airlineWallet.findUnique({ where: { airline } });
    },
    async listWallets() {
        return prisma.airlineWallet.findMany({ orderBy: { airline: "asc" } });
    },
    async getSettings(airline) {
        return prisma.airlineConnectorSettings.findUnique({ where: { airline } });
    },
    async listSettings() {
        return prisma.airlineConnectorSettings.findMany();
    },
    async upsertSettings(airline, data) {
        // Ensure the parent wallet row exists first — settings has a required FK to it.
        await prisma.airlineWallet.upsert({
            where: { airline },
            update: {},
            create: { airline, currentBalance: 0 },
        });
        return prisma.airlineConnectorSettings.upsert({
            where: { airline },
            update: data,
            create: { airline, ...data },
        });
    },
    async setConnectionStatus(airline, status) {
        return prisma.airlineConnectorSettings.update({
            where: { airline },
            data: { connectionStatus: status, lastTestedAt: new Date() },
        });
    },
    /**
     * Persists the result of a sync run. NEVER overwrites — always inserts a
     * new AirlineBalanceHistory row, only the AirlineWallet "current" pointer
     * is updated in place.
     */
    async recordSyncResult(result, connectorClassName, trigger) {
        const { airline, status, balance } = result;
        await prisma.airlineBalanceHistory.create({
            data: {
                airline,
                balance: balance?.totalBalance ?? 0,
                currency: balance?.currency ?? "NGN",
                syncStatus: status,
                connector: connectorClassName,
                trigger,
                errorMessage: result.error,
            },
        });
        if (status === "SUCCESS" && balance) {
            await prisma.airlineWallet.upsert({
                where: { airline },
                update: {
                    currentBalance: balance.totalBalance,
                    currency: balance.currency,
                    lastSynced: new Date(),
                    lastStatus: "SUCCESS",
                },
                create: {
                    airline,
                    currentBalance: balance.totalBalance,
                    currency: balance.currency,
                    lastSynced: new Date(),
                    lastStatus: "SUCCESS",
                },
            });
        }
        else {
            await prisma.airlineWallet.upsert({
                where: { airline },
                update: { lastStatus: "FAILED" },
                create: { airline, currentBalance: 0, lastStatus: "FAILED" },
            });
        }
    },
    async getHistory(airline, limit = 50) {
        return prisma.airlineBalanceHistory.findMany({
            where: { airline },
            orderBy: { retrievedAt: "desc" },
            take: limit,
        });
    },
    async writeLogs(lines) {
        if (!lines.length)
            return;
        await prisma.airlineSyncLog.createMany({
            data: lines.map((l) => ({
                airline: l.airline,
                runId: l.runId,
                step: l.step,
                message: l.message,
                level: l.level,
            })),
        });
    },
};
