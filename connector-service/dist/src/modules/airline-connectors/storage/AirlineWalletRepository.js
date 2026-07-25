"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirlineWalletRepository = void 0;
const prismaClient_1 = require("./prismaClient");
/**
 * Repository pattern — SyncService and API routes talk to this, never to
 * `prisma` directly. Keeps the Prisma schema an implementation detail that
 * can change without rippling through the rest of the framework.
 */
exports.AirlineWalletRepository = {
    async getWallet(airline) {
        return prismaClient_1.prisma.airlineWallet.findUnique({ where: { airline } });
    },
    async listWallets() {
        return prismaClient_1.prisma.airlineWallet.findMany({ orderBy: { airline: "asc" } });
    },
    async getSettings(airline) {
        return prismaClient_1.prisma.airlineConnectorSettings.findUnique({ where: { airline } });
    },
    async listSettings() {
        return prismaClient_1.prisma.airlineConnectorSettings.findMany();
    },
    async upsertSettings(airline, data) {
        // Ensure the parent wallet row exists first — settings has a required FK to it.
        await prismaClient_1.prisma.airlineWallet.upsert({
            where: { airline },
            update: {},
            create: { airline, currentBalance: 0 },
        });
        return prismaClient_1.prisma.airlineConnectorSettings.upsert({
            where: { airline },
            update: data,
            create: { airline, ...data },
        });
    },
    async setConnectionStatus(airline, status) {
        return prismaClient_1.prisma.airlineConnectorSettings.update({
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
        // Get previous balance for comparison
        const wallet = await prismaClient_1.prisma.airlineWallet.findUnique({ where: { airline } });
        const previousBalance = wallet?.currentBalance;
        // Calculate balance change
        const newBalance = balance?.totalBalance ?? 0;
        const balanceChange = previousBalance ? newBalance - Number(previousBalance) : null;
        await prismaClient_1.prisma.airlineBalanceHistory.create({
            data: {
                airline,
                balance: newBalance,
                previousBalance,
                balanceChange,
                currency: balance?.currency ?? "NGN",
                syncStatus: status,
                connector: connectorClassName,
                trigger,
                errorMessage: result.error,
                errorCategory: result.errorCategory,
                runId: result.runId,
                initiatedBy: result.initiatedBy,
                durationMs: result.durationMs,
            },
        });
        if (status === "SUCCESS" && balance) {
            await prismaClient_1.prisma.airlineWallet.upsert({
                where: { airline },
                update: {
                    currentBalance: balance.totalBalance,
                    previousBalance,
                    currency: balance.currency,
                    lastSynced: new Date(),
                    lastStatus: "SUCCESS",
                    lastRunId: result.runId,
                    lastSuccessfulSync: new Date(),
                    failureCount: 0,
                    consecutiveFailures: 0,
                },
                create: {
                    airline,
                    currentBalance: balance.totalBalance,
                    previousBalance,
                    currency: balance.currency,
                    lastSynced: new Date(),
                    lastStatus: "SUCCESS",
                    lastRunId: result.runId,
                    lastSuccessfulSync: new Date(),
                },
            });
        }
        else {
            const currentFailures = wallet?.consecutiveFailures ?? 0;
            await prismaClient_1.prisma.airlineWallet.upsert({
                where: { airline },
                update: {
                    lastStatus: "FAILED",
                    lastRunId: result.runId,
                    lastFailedSync: new Date(),
                    failureCount: (wallet?.failureCount ?? 0) + 1,
                    consecutiveFailures: currentFailures + 1,
                },
                create: {
                    airline,
                    currentBalance: 0,
                    lastStatus: "FAILED",
                    lastRunId: result.runId,
                    lastFailedSync: new Date(),
                    failureCount: 1,
                    consecutiveFailures: 1,
                },
            });
        }
    },
    async getHistory(airline, limit = 50) {
        return prismaClient_1.prisma.airlineBalanceHistory.findMany({
            where: { airline },
            orderBy: { retrievedAt: "desc" },
            take: limit,
        });
    },
    async writeLogs(lines) {
        if (!lines.length)
            return;
        await prismaClient_1.prisma.airlineSyncLog.createMany({
            data: lines.map((l) => ({
                airline: l.airline,
                runId: l.runId,
                step: l.step,
                message: l.message,
                level: l.level,
            })),
        });
    },
    // === SYNC RUN MANAGEMENT ===
    async createSyncRun(data) {
        return prismaClient_1.prisma.airlineSyncRun.create({
            data: {
                runId: data.runId,
                trigger: data.trigger,
                initiatedBy: data.initiatedBy,
                totalAirlines: data.totalAirlines,
                startedAt: data.startedAt,
            },
        });
    },
    async updateSyncRun(runId, data) {
        const run = await this.getSyncRun(runId);
        const totalTime = new Date().getTime() - (run?.startedAt.getTime() || 0);
        return prismaClient_1.prisma.airlineSyncRun.update({
            where: { runId },
            data: {
                ...data,
                durationMs: totalTime,
            },
        });
    },
    async getSyncRun(runId) {
        return prismaClient_1.prisma.airlineSyncRun.findUnique({ where: { runId } });
    },
    async querySyncRuns(filters) {
        return prismaClient_1.prisma.airlineSyncRun.findMany({
            where: {
                trigger: filters.trigger,
                startedAt: {
                    gte: filters.since,
                    lte: filters.until,
                },
            },
            orderBy: { startedAt: "desc" },
            take: filters.limit,
            skip: filters.offset,
        });
    },
    async getSyncRunResults(runId) {
        return prismaClient_1.prisma.airlineBalanceHistory.findMany({
            where: { runId },
            orderBy: { airline: "asc" },
        });
    },
    async getSyncRunLogs(runId) {
        return prismaClient_1.prisma.airlineSyncLog.findMany({
            where: { runId },
            orderBy: { createdAt: "asc" },
        });
    },
    // === BALANCE HISTORY QUERIES ===
    async queryHistory(filters) {
        return prismaClient_1.prisma.airlineBalanceHistory.findMany({
            where: {
                retrievedAt: {
                    gte: filters.since,
                    lte: filters.until,
                },
                errorCategory: filters.errorCategory ? filters.errorCategory : undefined,
                syncStatus: filters.status ? filters.status : undefined,
            },
            orderBy: { retrievedAt: "desc" },
        });
    },
    async getLatestFailure(airline) {
        return prismaClient_1.prisma.airlineBalanceHistory.findFirst({
            where: {
                airline,
                syncStatus: "FAILED",
            },
            orderBy: { retrievedAt: "desc" },
        });
    },
    // === ANALYTICS QUERIES ===
    async getSyncStatistics(since, until = new Date()) {
        const runs = await prismaClient_1.prisma.airlineSyncRun.findMany({
            where: {
                startedAt: {
                    gte: since,
                    lte: until,
                },
            },
        });
        const totalSuccesses = runs.reduce((sum, r) => sum + r.successfulCount, 0);
        const totalFailures = runs.reduce((sum, r) => sum + r.failedCount, 0);
        const totalSkipped = runs.reduce((sum, r) => sum + r.skippedCount, 0);
        const totalAuthFailures = runs.reduce((sum, r) => sum + r.authFailureCount, 0);
        const totalNetworkFailures = runs.reduce((sum, r) => sum + r.networkFailureCount, 0);
        const totalPortalFailures = runs.reduce((sum, r) => sum + r.portalFailureCount, 0);
        return {
            totalSyncRuns: runs.length,
            successfulRuns: runs.filter((r) => r.failedCount === 0).length,
            failedRuns: runs.filter((r) => r.failedCount > 0).length,
            totalSuccesses,
            totalFailures,
            totalSkipped,
            totalAuthFailures,
            totalNetworkFailures,
            totalPortalFailures,
            averageDurationMs: runs.reduce((sum, r) => sum + (r.durationMs || 0), 0) / Math.max(1, runs.length),
        };
    },
    async getAirlinesNotSyncedSince(cutoffDate) {
        return prismaClient_1.prisma.airlineWallet.findMany({
            where: {
                lastSynced: {
                    lt: cutoffDate,
                },
            },
            select: { airline: true, lastSynced: true },
        });
    },
    async getAirlinesChangedSince(since) {
        const histories = await prismaClient_1.prisma.airlineBalanceHistory.findMany({
            where: {
                retrievedAt: { gte: since },
                syncStatus: "SUCCESS",
            },
            distinct: ["airline"],
            select: { airline: true, balance: true, previousBalance: true },
        });
        return histories.filter((h) => h.previousBalance && !h.balance.equals(h.previousBalance));
    },
    async getAirlineByFailureCount(since) {
        const failures = await prismaClient_1.prisma.airlineBalanceHistory.groupBy({
            by: ["airline"],
            where: {
                syncStatus: "FAILED",
                retrievedAt: { gte: since },
            },
            _count: true,
            orderBy: { _count: { airline: "desc" } },
            take: 1,
        });
        return failures[0];
    },
};
