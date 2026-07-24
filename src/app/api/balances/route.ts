import { NextResponse } from "next/server";
import { AirlineBalanceService } from "@/modules/airline-connectors/services/AirlineBalanceService";
import type { NextRequest } from "next/server";

// GET /api/balances
// List all airlines' current balances.
// Used by: Dashboard, Reports, Mobile API
export async function GET(req: NextRequest) {
  try {
    const balances = await AirlineBalanceService.getAllBalances();
    const stats = await AirlineBalanceService.getBalanceStatistics();

    return NextResponse.json({
      balances,
      statistics: stats,
      lastUpdated: new Date(),
      count: balances.length,
    });
  } catch (err) {
    console.error("[GET /api/balances]", err);
    return NextResponse.json(
      { error: "Failed to fetch balances" },
      { status: 500 }
    );
  }
}
