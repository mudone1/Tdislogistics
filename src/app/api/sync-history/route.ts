import { NextResponse } from "next/server";
import { SyncHistoryService } from "@/modules/airline-connectors/services/SyncHistoryService";
import type { SyncTrigger } from "@/modules/airline-connectors/core/types";
import type { NextRequest } from "next/server";

// GET /api/sync-history
// List recent sync runs with optional filters.
// Query params:
//   ?limit=50 (default 50, max 200)
//   ?offset=0 (pagination)
//   ?trigger=MANUAL|SCHEDULED
//   ?since=2026-07-24T00:00:00Z (ISO date)
//   ?until=2026-07-25T00:00:00Z (ISO date)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const trigger = url.searchParams.get("trigger") as SyncTrigger | null;
    const sinceStr = url.searchParams.get("since");
    const untilStr = url.searchParams.get("until");

    const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default 7 days
    const until = untilStr ? new Date(untilStr) : new Date();

    const runs = await SyncHistoryService.listSyncRuns({
      limit,
      offset,
      trigger: trigger || undefined,
      since,
      until,
    });

    return NextResponse.json({
      runs,
      pagination: {
        limit,
        offset,
        returned: runs.length,
      },
      filters: {
        trigger,
        since: since.toISOString(),
        until: until.toISOString(),
      },
    });
  } catch (err) {
    console.error("[GET /api/sync-history]", err);
    return NextResponse.json(
      { error: "Failed to fetch sync history" },
      { status: 500 }
    );
  }
}
