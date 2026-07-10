import { NextResponse } from "next/server";
import { AirlineWalletRepository } from "@/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";

export async function GET(_req: Request, { params }: { params: Promise<{ airline: string }> }) {
  const airline = (await params).airline.toUpperCase();
  if (!ConnectorRegistry.isImplemented(airline)) {
    return NextResponse.json(
      { error: `"${airline}" is not an implemented connector yet (Category B).` },
      { status: 404 }
    );
  }

  const key = airline as AirlineKey;
  const [wallet, settings] = await Promise.all([
    AirlineWalletRepository.getWallet(key),
    AirlineWalletRepository.getSettings(key),
  ]);

  return NextResponse.json({
    wallet,
    settings: settings
      ? {
          enabled: settings.enabled,
          hasCredentials: Boolean(settings.encryptedUsername && settings.encryptedPassword),
          syncIntervalMinutes: settings.syncIntervalMinutes,
          dailyRunAtUtc: settings.dailyRunAtUtc,
          connectionStatus: settings.connectionStatus,
          lastTestedAt: settings.lastTestedAt,
        }
      : null,
  });
}
