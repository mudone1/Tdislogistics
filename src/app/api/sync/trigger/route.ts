import { NextResponse } from "next/server";
import { SyncHistoryService } from "@/modules/airline-connectors/services/SyncHistoryService";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";
import { ConfigService } from "@/modules/airline-connectors/services/ConfigService";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";
import type { NextRequest } from "next/server";

// NOTE: This endpoint should be protected by auth middleware.
// See sync/route.ts for existing auth TODO comment.
export const maxDuration = 60;

// POST /api/sync/trigger
// Start manual sync for airlines.
// Body: { airlines?: AirlineKey[], maxConcurrency?: number, initiatedBy?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { airlines, maxConcurrency, initiatedBy } = body;

    // Get all airlines if not specified
    let toSync: AirlineKey[] = airlines || ConnectorRegistry.listAll().map((m) => m.airline);

    // Validate airlines
    for (const airline of toSync) {
      if (!ConnectorRegistry.isImplemented(airline)) {
        return NextResponse.json(
          { error: `Invalid airline: ${airline}` },
          { status: 400 }
        );
      }
    }

    // Create sync run
    const runId = await SyncHistoryService.createSyncRun(
      "MANUAL",
      initiatedBy || "user",
      toSync.length
    );

    // Get concurrency from config if not specified
    const defaultConcurrency =
      maxConcurrency ||
      (await ConfigService.getConfigValue("airline-connectors", "maxConcurrentSyncs", 3));

    // Queue sync task (actual sync happens in background via connector-service)
    // This endpoint just accepts the request and returns runId for polling
    queueSyncTask(toSync, runId, maxConcurrency as number);

    return NextResponse.json(
      {
        accepted: true,
        runId,
        status: "queued",
        airlinesRequested: toSync.length,
        estimatedDuration: toSync.length * 30 * 1000, // ~30s per airline
        message: `Sync triggered for ${toSync.length} airline${toSync.length === 1 ? "" : "s"}`,
      },
      { status: 202 } // Accepted
    );
  } catch (err) {
    console.error("[POST /api/sync/trigger]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to trigger sync" },
      { status: 500 }
    );
  }
}

// Queue sync task to background worker
// In production, this would queue to a job processor (Bull, Temporal, etc.)
// For now, fire and forget (connector-service scheduler will pick it up)
function queueSyncTask(airlines: AirlineKey[], runId: string, concurrency: number) {
  // TODO: Integrate with job processor
  console.log(`[SYNC QUEUED] runId=${runId}, airlines=${airlines.length}, concurrency=${concurrency}`);
}
