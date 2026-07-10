import { NextResponse } from "next/server";
import { AirlineWalletRepository } from "@/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";

export async function GET(req: Request, { params }: { params: Promise<{ airline: string }> }) {
  const airline = (await params).airline.toUpperCase();
  if (!ConnectorRegistry.isImplemented(airline)) {
    return NextResponse.json(
      { error: `"${airline}" is not an implemented connector yet (Category B).` },
      { status: 404 }
    );
  }

  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = Math.min(200, Number(limitParam) || 50);
  const history = await AirlineWalletRepository.getHistory(airline as AirlineKey, limit);

  return NextResponse.json({ history });
}
