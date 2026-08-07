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
import type { AirlineKey } from "@prisma/client";

// These 5 have never returned a real balance (their crane.aero-style portal
// connectors aren't working yet — 0% success rate historically) — per
// explicit product direction, "balance update" should only ever sync/report
// the airlines that actually work, not spend the whole poll budget waiting
// on ones that will never complete. Remove an entry here once its connector
// is confirmed working again.
// VALUEJET added here too — its connector (ValueJetConnector.ts) is a
// first-pass, unverified against a real login (needs the agent credentials
// the user enters via Airline Connectors, which this session never sees).
// Remove once a live sync run confirms it actually reads a balance.
const BALANCE_UPDATE_EXCLUDED: readonly AirlineKey[] = ["AIRPEACE", "AERO", "ARIK", "IBOM", "NGEAGLE", "VALUEJET"];

/**
 * "Balance update" — fires a manual sync across every WORKING airline
 * connector (best-effort via Promise.allSettled; one airline's connector
 * being down/slow doesn't block the others) and returns the trigger
 * instant, which getBalanceUpdateStatus compares each airline's
 * lastSynced timestamp against to detect completion.
 */
export async function triggerBalanceUpdate(): Promise<{ triggeredAt: string; airlines: string[] }> {
  const airlines = ConnectorRegistry.listAll()
    .map((m) => m.airline)
    .filter((a) => !BALANCE_UPDATE_EXCLUDED.includes(a));
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
  const balances = (await AirlineBalanceService.getAllBalances()).filter(
    (b) => !BALANCE_UPDATE_EXCLUDED.includes(b.airline)
  );
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
