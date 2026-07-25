import { NextResponse } from "next/server";
import { SyncHistoryService } from "@/modules/airline-connectors/services/SyncHistoryService";
import type { NextRequest } from "next/server";

// GET /api/sync/progress/[runId]
// Get live progress of a sync run.
// Used by: Frontend for polling during sync, progress bar updates
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const runId = (await params).runId;

    const run = await SyncHistoryService.getSyncRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: "Sync run not found" },
        { status: 404 }
      );
    }

    // Get airline-by-airline results
    const results = await SyncHistoryService.getSyncRunWithResults(runId);

    // Calculate progress
    const completed = run.successfulCount + run.failedCount + run.skippedCount;
    const percentage = Math.round((completed / run.totalAirlines) * 100);
    const isComplete = run.completedAt !== null;

    return NextResponse.json({
      runId,
      trigger: run.trigger,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      status: isComplete ? "completed" : "in-progress",

      progress: {
        completed,
        total: run.totalAirlines,
        percentage,
      },

      airlines: results?.results?.map((r) => ({
        airline: r.airline,
        status: r.syncStatus,
        balance: r.balance,
        previousBalance: r.previousBalance,
        balanceChange: r.balanceChange,
        error: r.errorMessage,
        errorCategory: r.errorCategory,
        durationMs: r.durationMs,
        retrievedAt: r.retrievedAt,
      })) || [],

      summary: {
        successfulCount: run.successfulCount,
        failedCount: run.failedCount,
        skippedCount: run.skippedCount,
        authFailureCount: run.authFailureCount,
        networkFailureCount: run.networkFailureCount,
        portalFailureCount: run.portalFailureCount,
        unknownFailureCount: run.unknownFailureCount,
      },

      logs: results?.logs || [],
    });
  } catch (err) {
    console.error("[GET /api/sync/progress/[runId]]", err);
    return NextResponse.json(
      { error: "Failed to fetch sync progress" },
      { status: 500 }
    );
  }
}
