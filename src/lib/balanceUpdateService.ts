// Deliberately lives under src/lib/ rather than src/modules/airline-connectors/
// (where AirlineAIService.ts and friends live) — connector-service's own
// build ALSO compiles everything under src/modules/airline-connectors/**
// (see connector-service/tsconfig.json's include list), but doesn't copy
// src/lib/ into its Docker image at all. Importing connectorServiceClient
// (a main-app-only helper that calls INTO connector-service over HTTP —
// connector-service has no reason to call itself) from a file connector-
// service also compiles broke its build with a "cannot find module" error.
// This file is main-app-only by construction, not by exclude-list
// bookkeeping that's easy to forget.
import { AirlineBalanceService } from "../modules/airline-connectors/services/AirlineBalanceService";
import { ConnectorRegistry } from "../modules/airline-connectors/services/ConnectorRegistry";
import { connectorServiceClient } from "./connectorServiceClient";

/**
 * "Balance update" — fires a manual sync across every implemented airline
 * connector (best-effort via Promise.allSettled; one airline's connector
 * being down/slow doesn't block the others) and returns the trigger
 * instant, which getBalanceUpdateStatus compares each airline's
 * lastSynced timestamp against to detect completion.
 */
export async function triggerBalanceUpdate(): Promise<{ triggeredAt: string; airlines: string[] }> {
  const airlines = ConnectorRegistry.listAll().map((m) => m.airline);
  await Promise.allSettled(airlines.map((a) => connectorServiceClient.sync(a, "MANUAL")));
  return { triggeredAt: new Date().toISOString(), airlines };
}

/**
 * Polled after triggerBalanceUpdate. "ready" once every airline's
 * lastSynced is newer than the trigger instant — a real, per-airline
 * completion signal rather than a blind fixed-delay guess. A connector
 * that's down/never finishes just never flips its own airline to "ready"
 * here; the caller times out its own poll budget rather than waiting on
 * 100% certainty from this alone.
 */
export async function getBalanceUpdateStatus(
  triggeredAtISO: string
): Promise<{ ready: boolean; balances: { airline: string; displayName: string; balance: number }[] }> {
  const triggeredAt = new Date(triggeredAtISO).getTime();
  const balances = await AirlineBalanceService.getAllBalances();
  const ready = balances.every((b) => b.lastSynced != null && b.lastSynced.getTime() >= triggeredAt);
  return {
    ready,
    balances: balances.map((b) => ({
      airline: b.airline,
      displayName: b.displayName,
      balance: Number(b.currentBalance),
    })),
  };
}
