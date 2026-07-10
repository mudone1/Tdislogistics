import { NextResponse } from "next/server";
import { AirlineWalletRepository } from "@/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";

// Reads happen straight from Postgres here — no need to round-trip through
// the connector-service for data that's already sitting in the shared
// database. Only the actual sync/test ACTIONS get proxied (see
// [airline]/sync/route.ts) since only connector-service can run Playwright.
export async function GET() {
  const [wallets, settings] = await Promise.all([
    AirlineWalletRepository.listWallets(),
    AirlineWalletRepository.listSettings(),
  ]);

  const connectors = ConnectorRegistry.listAll().map((meta) => {
    const wallet = wallets.find((w) => w.airline === meta.airline);
    const setting = settings.find((s) => s.airline === meta.airline);
    return {
      airline: meta.airline,
      displayName: meta.displayName,
      enabled: setting?.enabled ?? false,
      hasCredentials: Boolean(setting?.encryptedUsername && setting?.encryptedPassword),
      syncIntervalMinutes: setting?.syncIntervalMinutes ?? null,
      dailyRunAtUtc: setting?.dailyRunAtUtc ?? null,
      connectionStatus: setting?.connectionStatus ?? "NOT_CONFIGURED",
      lastTestedAt: setting?.lastTestedAt ?? null,
      currentBalance: wallet?.currentBalance ?? null,
      currency: wallet?.currency ?? "NGN",
      lastSynced: wallet?.lastSynced ?? null,
      lastStatus: wallet?.lastStatus ?? "PENDING",
    };
  });

  return NextResponse.json({ connectors });
}
