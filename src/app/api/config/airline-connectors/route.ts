import { NextResponse } from "next/server";
import { ConfigService } from "@/modules/airline-connectors/services/ConfigService";
import type { NextRequest } from "next/server";

// NOTE: POST endpoint should be protected by auth middleware (admin only).
// See sync/route.ts for existing auth TODO comment.

// GET /api/config/airline-connectors
// Get current configuration for airline-connectors module.
export async function GET() {
  try {
    const config = await ConfigService.getAirlineConnectorConfig();

    return NextResponse.json({
      module: "airline-connectors",
      config,
      lastUpdated: new Date(),
    });
  } catch (err) {
    console.error("[GET /api/config/airline-connectors]", err);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// POST /api/config/airline-connectors
// Update configuration. Accepts partial updates.
// Body: {
//   defaultSyncIntervalMinutes?: number,
//   authCooldownMinutes?: number,
//   networkErrorBackoffMinutes?: number,
//   portalErrorBackoffMinutes?: number,
//   maxRetryAttempts?: number,
//   maxConcurrentSyncs?: number
// }
export async function POST(req: NextRequest) {
  try {
    // TODO: Add auth check (admin only)
    const body = await req.json();

    // Validate inputs
    if (body.defaultSyncIntervalMinutes !== undefined) {
      const mins = body.defaultSyncIntervalMinutes;
      if (typeof mins !== "number" || mins < 1 || mins > 10080) {
        return NextResponse.json(
          { error: "defaultSyncIntervalMinutes must be 1-10080 (1 min to 1 week)" },
          { status: 400 }
        );
      }
    }

    if (body.authCooldownMinutes !== undefined) {
      const mins = body.authCooldownMinutes;
      if (typeof mins !== "number" || mins < 1 || mins > 10080) {
        return NextResponse.json(
          { error: "authCooldownMinutes must be 1-10080" },
          { status: 400 }
        );
      }
    }

    if (body.networkErrorBackoffMinutes !== undefined) {
      const mins = body.networkErrorBackoffMinutes;
      if (typeof mins !== "number" || mins < 1 || mins > 1440) {
        return NextResponse.json(
          { error: "networkErrorBackoffMinutes must be 1-1440" },
          { status: 400 }
        );
      }
    }

    if (body.portalErrorBackoffMinutes !== undefined) {
      const mins = body.portalErrorBackoffMinutes;
      if (typeof mins !== "number" || mins < 1 || mins > 1440) {
        return NextResponse.json(
          { error: "portalErrorBackoffMinutes must be 1-1440" },
          { status: 400 }
        );
      }
    }

    if (body.maxRetryAttempts !== undefined) {
      const attempts = body.maxRetryAttempts;
      if (typeof attempts !== "number" || attempts < 1 || attempts > 10) {
        return NextResponse.json(
          { error: "maxRetryAttempts must be 1-10" },
          { status: 400 }
        );
      }
    }

    if (body.maxConcurrentSyncs !== undefined) {
      const concurrent = body.maxConcurrentSyncs;
      if (typeof concurrent !== "number" || concurrent < 1 || concurrent > 20) {
        return NextResponse.json(
          { error: "maxConcurrentSyncs must be 1-20" },
          { status: 400 }
        );
      }
    }

    // Update config
    await ConfigService.setAirlineConnectorConfig(body);

    // Return updated config
    const updated = await ConfigService.getAirlineConnectorConfig();

    return NextResponse.json(
      {
        module: "airline-connectors",
        config: updated,
        message: "Configuration updated successfully",
        updatedAt: new Date(),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/config/airline-connectors]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update config" },
      { status: 500 }
    );
  }
}
