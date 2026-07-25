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

    // Convert Prisma Decimal types to numbers for JSON serialization
    const serializedBalances = balances.map((b) => ({
      ...b,
      currentBalance: b.currentBalance ? parseFloat(b.currentBalance.toString()) : null,
      previousBalance: b.previousBalance ? parseFloat(b.previousBalance.toString()) : null,
      balanceChange: b.balanceChange ? parseFloat(b.balanceChange.toString()) : null,
    }));

    const serializedStats = {
      totalAirlines: stats.totalAirlines,
      total: stats.total ? parseFloat(stats.total.toString()) : 0,
      average: stats.average ? parseFloat(stats.average.toString()) : 0,
      highest: stats.highest ? parseFloat(stats.highest.toString()) : 0,
      lowest: stats.lowest ? parseFloat(stats.lowest.toString()) : 0,
      inAuthCooldown: stats.inAuthCooldown,
      neverSynced: stats.neverSynced,
    };

    return NextResponse.json({
      balances: serializedBalances,
      statistics: serializedStats,
      lastUpdated: new Date(),
      count: serializedBalances.length,
    });
  } catch (err) {
    console.error("[GET /api/balances]", err);
    return NextResponse.json(
      { error: "Failed to fetch balances" },
      { status: 500 }
    );
  }
}
