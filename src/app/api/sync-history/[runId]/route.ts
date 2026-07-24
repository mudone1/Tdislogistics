import { NextResponse } from "next/server";
import { SyncHistoryService } from "@/modules/airline-connectors/services/SyncHistoryService";
import type { NextRequest } from "next/server";

// GET /api/sync-history/[runId]
// Get detailed breakdown of a specific sync run.
// Includes: run metadata, per-airline results, full logs
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const runId = (await params).runId;

    const details = await SyncHistoryService.getSyncRunWithResults(runId);

    if (!details) {
      return NextResponse.json(
        { error: "Sync run not found" },
        { status: 404 }
      );
    }

    const { run, results, logs } = details;

    return NextResponse.json({
      run: {
        runId: run.runId,
        trigger: run.trigger,
        initiatedBy: run.initiatedBy,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        totalAirlines: run.totalAirlines,
      },

      summary: {
        successfulCount: run.successfulCount,
        failedCount: run.failedCount,
        skippedCount: run.skippedCount,
        authFailureCount: run.authFailureCount,
        networkFailureCount: run.networkFailureCount,
        portalFailureCount: run.portalFailureCount,
        unknownFailureCount: run.unknownFailureCount,
        parallelism: run.parallelism,
      },

      airlineResults: results?.map((r) => ({
        airline: r.airline,
        status: r.syncStatus,
        balance: r.balance,
        previousBalance: r.previousBalance,
        balanceChange: r.balanceChange,
        currency: r.currency,
        error: r.errorMessage,
        errorCategory: r.errorCategory,
        errorCode: r.errorCode,
        durationMs: r.durationMs,
        initiatedBy: r.initiatedBy,
        connector: r.connector,
        retrievedAt: r.retrievedAt,
      })) || [],

      logs: logs?.map((l) => ({
        airline: l.airline,
        step: l.step,
        message: l.message,
        level: l.level,
        errorCategory: l.errorCategory,
        errorCode: l.errorCode,
        createdAt: l.createdAt,
      })) || [],

      statistics: {
        averageDurationPerAirline:
          results && results.length > 0
            ? results.reduce((sum, r) => sum + (r.durationMs || 0), 0) / results.length
            : 0,
        failureRate:
          results && results.length > 0
            ? ((results.filter((r) => r.syncStatus === "FAILED").length / results.length) * 100).toFixed(2)
            : "0",
      },
    });
  } catch (err) {
    console.error("[GET /api/sync-history/[runId]]", err);
    return NextResponse.json(
      { error: "Failed to fetch sync details" },
      { status: 500 }
    );
  }
}
