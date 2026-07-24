import { prisma } from "./prismaClient";
import type { AirlineKey, SyncResult, SyncTrigger } from "../core/types";
import type { SyncLogLine } from "../logs/SyncRunLogger";

/**
 * Repository pattern — SyncService and API routes talk to this, never to
 * `prisma` directly. Keeps the Prisma schema an implementation detail that
 * can change without rippling through the rest of the framework.
 */
export const AirlineWalletRepository = {
  async getWallet(airline: AirlineKey) {
    return prisma.airlineWallet.findUnique({ where: { airline } });
  },

  async listWallets() {
    return prisma.airlineWallet.findMany({ orderBy: { airline: "asc" } });
  },

  async getSettings(airline: AirlineKey) {
    return prisma.airlineConnectorSettings.findUnique({ where: { airline } });
  },

  async listSettings() {
    return prisma.airlineConnectorSettings.findMany();
  },

  async upsertSettings(
    airline: AirlineKey,
    data: {
      enabled?: boolean;
      encryptedUsername?: string | null;
      encryptedPassword?: string | null;
      syncIntervalMinutes?: number | null;
      dailyRunAtUtc?: string | null;
      authFailureCount?: number | null;
      authFailureSince?: Date | null;
      authCooldownUntil?: Date | null;
      passwordUpdatedAt?: Date | null;
      maxRetryAttempts?: number;
      baseRetryDelayMs?: number;
      syncTimeoutSeconds?: number;
      maxConcurrentSyncs?: number;
      authCooldownMinutes?: number;
      networkErrorBackoffMinutes?: number;
      portalErrorBackoffMinutes?: number;
    }
  ) {
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

  async setConnectionStatus(airline: AirlineKey, status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR") {
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
  async recordSyncResult(
    result: SyncResult & { errorCategory?: string; runId?: string; initiatedBy?: string; durationMs?: number },
    connectorClassName: string,
    trigger: SyncTrigger
  ) {
    const { airline, status, balance } = result;

    // Get previous balance for comparison
    const wallet = await prisma.airlineWallet.findUnique({ where: { airline } });
    const previousBalance = wallet?.currentBalance;

    // Calculate balance change
    const newBalance = balance?.totalBalance ?? 0;
    const balanceChange = previousBalance ? newBalance - previousBalance : null;

    await prisma.airlineBalanceHistory.create({
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
        errorCategory: result.errorCategory as any,
        runId: result.runId,
        initiatedBy: result.initiatedBy,
        durationMs: result.durationMs,
      },
    });

    if (status === "SUCCESS" && balance) {
      await prisma.airlineWallet.upsert({
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
    } else {
      const currentFailures = wallet?.consecutiveFailures ?? 0;
      await prisma.airlineWallet.upsert({
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

  async getHistory(airline: AirlineKey, limit = 50) {
    return prisma.airlineBalanceHistory.findMany({
      where: { airline },
      orderBy: { retrievedAt: "desc" },
      take: limit,
    });
  },

  async writeLogs(lines: SyncLogLine[]) {
    if (!lines.length) return;
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

  // === SYNC RUN MANAGEMENT ===

  async createSyncRun(data: {
    runId: string;
    trigger: SyncTrigger;
    initiatedBy?: string;
    totalAirlines: number;
    startedAt: Date;
  }) {
    return prisma.airlineSyncRun.create({
      data: {
        runId: data.runId,
        trigger: data.trigger,
        initiatedBy: data.initiatedBy,
        totalAirlines: data.totalAirlines,
        startedAt: data.startedAt,
      },
    });
  },

  async updateSyncRun(
    runId: string,
    data: {
      completedAt: Date;
      successfulCount: number;
      failedCount: number;
      skippedCount: number;
      authFailureCount: number;
      networkFailureCount: number;
      portalFailureCount: number;
      unknownFailureCount: number;
      parallelism: number;
    }
  ) {
    const totalTime = new Date().getTime() - (await this.getSyncRun(runId)).then((r) => r?.startedAt.getTime() || 0);

    return prisma.airlineSyncRun.update({
      where: { runId },
      data: {
        ...data,
        durationMs: totalTime,
      },
    });
  },

  async getSyncRun(runId: string) {
    return prisma.airlineSyncRun.findUnique({ where: { runId } });
  },

  async querySyncRuns(filters: {
    limit: number;
    offset: number;
    trigger?: SyncTrigger;
    since?: Date;
    until?: Date;
  }) {
    return prisma.airlineSyncRun.findMany({
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

  async getSyncRunResults(runId: string) {
    return prisma.airlineBalanceHistory.findMany({
      where: { runId },
      orderBy: { airline: "asc" },
    });
  },

  async getSyncRunLogs(runId: string) {
    return prisma.airlineSyncLog.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
  },

  // === BALANCE HISTORY QUERIES ===

  async queryHistory(filters: {
    since?: Date;
    until?: Date;
    errorCategory?: string;
    status?: string;
  }) {
    return prisma.airlineBalanceHistory.findMany({
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

  async getLatestFailure(airline: AirlineKey) {
    return prisma.airlineBalanceHistory.findFirst({
      where: {
        airline,
        syncStatus: "FAILED",
      },
      orderBy: { retrievedAt: "desc" },
    });
  },

  // === ANALYTICS QUERIES ===

  async getSyncStatistics(since: Date, until?: Date = new Date()) {
    const runs = await prisma.airlineSyncRun.findMany({
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

  async getAirlinesNotSyncedSince(cutoffDate: Date) {
    return prisma.airlineWallet.findMany({
      where: {
        lastSynced: {
          lt: cutoffDate,
        },
      },
      select: { airline: true, lastSynced: true },
    });
  },

  async getAirlinesChangedSince(since: Date) {
    const histories = await prisma.airlineBalanceHistory.findMany({
      where: {
        retrievedAt: { gte: since },
        syncStatus: "SUCCESS",
      },
      distinct: ["airline"],
      select: { airline: true, balance: true, previousBalance: true },
    });

    return histories.filter((h) => h.previousBalance && !h.balance.equals(h.previousBalance));
  },

  async getAirlineByFailureCount(since: Date) {
    const failures = await prisma.airlineBalanceHistory.groupBy({
      by: ["airline"],
      where: {
        syncStatus: "FAILED",
        retrievedAt: { gte: since },
      },
      _count: true,
      orderBy: { _count: "desc" },
      take: 1,
    });

    return failures[0];
  },
};
