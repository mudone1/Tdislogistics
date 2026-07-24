import { NextResponse } from "next/server";
import { AirlineBalanceService } from "@/modules/airline-connectors/services/AirlineBalanceService";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";
import type { NextRequest } from "next/server";

// GET /api/balances/[airline]
// Get balance for one airline with history.
// Query params: ?limit=30 (default 30)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ airline: string }> }
) {
  try {
    const airline = (await params).airline.toUpperCase() as AirlineKey;

    if (!ConnectorRegistry.isImplemented(airline)) {
      return NextResponse.json(
        { error: `Airline "${airline}" not found` },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "30"), 365);

    const result = await AirlineBalanceService.getBalanceWithHistory(airline, limit);

    if (!result) {
      return NextResponse.json(
        { error: `No balance data for ${airline}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      balance: result.balance,
      history: result.history,
      trend: {
        dayChange: result.history[0]?.balanceChange ?? 0,
        // Calculate week change (7 days ago)
        weekChange:
          result.history.length > 7
            ? result.history[0].balance - result.history[Math.min(6, result.history.length - 1)].balance
            : null,
        // Calculate month change (30 days ago)
        monthChange:
          result.history.length > 30
            ? result.history[0].balance - result.history[Math.min(29, result.history.length - 1)].balance
            : null,
      },
    });
  } catch (err) {
    console.error("[GET /api/balances/[airline]]", err);
    return NextResponse.json(
      { error: "Failed to fetch balance" },
      { status: 500 }
    );
  }
}
