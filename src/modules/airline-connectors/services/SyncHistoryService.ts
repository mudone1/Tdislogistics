// Tracks sync orchestration runs and results for auditing and analytics.
// Used by: Reports, AI Assistant, Sync History page, Admin dashboard

import crypto from "crypto";
import { AirlineWalletRepository } from "../storage/AirlineWalletRepository";
import type { AirlineKey, SyncTrigger } from "../core/types";
import type { Decimal } from "@prisma/client/runtime/library";

export interface SyncRunSummary {
  runId: string;
  trigger: SyncTrigger;
  initiatedBy?: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;

  totalAirlines: number;
  successfulCount: number;
  failedCount: number;
  skippedCount: number;

  authFailureCount: number;
  networkFailureCount: number;
  portalFailureCount: number;
  unknownFailureCount: number;

  parallelism: number;
}

export interface AirlineSyncResult {
  airline: AirlineKey;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  balance?: Decimal;
  previousBalance?: Decimal;
  error?: string;
  errorCategory?: string;
  durationMs?: number;
  startTime?: Date;
  finishTime?: Date;
}

export const SyncHistoryService = {
  /**
   * Create a new sync run record.
   * Called at start of sync orchestration.
   * Returns the runId to be used for all logs/results from this sync.
   */
  async createSyncRun(
    trigger: SyncTrigger,
    initiatedBy?: string,
    totalAirlines?: number
  ): Promise<string> {
    const runId = crypto.randomUUID();

    await AirlineWalletRepository.createSyncRun({
      runId,
      trigger,
      initiatedBy,
      totalAirlines: totalAirlines ?? 9,
      startedAt: new Date(),
    });

    return runId;
  },

  /**
   * Update sync run with final results.
   * Called when sync orchestration completes.
   */
  async completeSyncRun(
    runId: string,
    results: {
      successfulCount: number;
      failedCount: number;
      skippedCount: number;
      authFailureCount: number;
      networkFailureCount: number;
      portalFailureCount: number;
      unknownFailureCount: number;
      parallelism: number;
    }
  ): Promise<void> {
    await AirlineWalletRepository.updateSyncRun(runId, {
      completedAt: new Date(),
      ...results,
    });
  },

  /**
   * Get summary of a specific sync run.
   * Used by: Sync History page, detailed reports
   */
  async getSyncRun(runId: string): Promise<SyncRunSummary | null> {
    return AirlineWalletRepository.getSyncRun(runId);
  },

  /**
   * List recent sync runs with optional filters.
   * Used by: Sync History page, Admin dashboard
   */
  async listSyncRuns(filters?: {
    limit?: number;
    offset?: number;
    trigger?: SyncTrigger;
    since?: Date;
    until?: Date;
  }): Promise<SyncRunSummary[]> {
    return AirlineWalletRepository.querySyncRuns({
      limit: filters?.limit ?? 50,
      offset: filters?.offset ?? 0,
      trigger: filters?.trigger,
      since: filters?.since,
      until: filters?.until,
    });
  },

  /**
   * Get sync run with all airline results.
   * Used by: Detailed sync report, drilling down on a specific sync
   */
  async getSyncRunWithResults(runId: string) {
    const run = await this.getSyncRun(runId);
    if (!run) return null;

    const results = await AirlineWalletRepository.getSyncRunResults(runId);
    const logs = await AirlineWalletRepository.getSyncRunLogs(runId);

    return { run, results, logs };
  },

  /**
   * Get statistics for a date range.
   * Used by: Reports, Analytics, AI queries
   */
  async getStatistics(since: Date, until?: Date) {
    return AirlineWalletRepository.getSyncStatistics(since, until);
  },

  /**
   * Get which airlines have not synced recently.
   * Used by: AI Assistant ("which airline hasn't synced for 3 days?")
   */
  async getOutdatedAirlines(olderThanMinutes: number) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return AirlineWalletRepository.getAirlinesNotSyncedSince(cutoff);
  },

  /**
   * Get airlines that changed balance today.
   * Used by: AI Assistant ("which airline changed balance today?")
   */
  async getAirlinesChangedToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return AirlineWalletRepository.getAirlinesChangedSince(today);
  },

  /**
   * Get authentication failures in a date range.
   * Used by: Reports, AI Assistant ("show auth failures this week")
   */
  async getAuthFailures(since: Date, until?: Date) {
    return AirlineWalletRepository.queryHistory({
      since,
      until,
      errorCategory: "AUTH",
    });
  },

  /**
   * Get most problematic airline (most failures).
   * Used by: Reports, AI Assistant ("which airline failed most?")
   */
  async getMostProblematicAirline(since: Date) {
    return AirlineWalletRepository.getAirlineByFailureCount(since);
  },
};
