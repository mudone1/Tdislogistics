import type { AirlineKey } from "@prisma/client";
import { prisma } from "../../airline-connectors/storage/prismaClient";
import { lagosDayStartUtc } from "../deposits/lagosDate";
import type { ParsedOpeningBalance } from "../deposits/balanceUpdateParser";

// The four airlines the existing automated portal-sync system already
// covers (see prisma/schema.prisma's AirlineKey enum comment: "Category B
// — all four now implemented on the shared VARS/Videcom connector base").
// Their opening balance for the report is read straight from
// AirlineBalanceHistory, never from a manually-posted message — even if a
// human's own "Balance Update" post happens to include one of these four
// (the real nightly examples this was built from post ALL airlines every
// time), the sync value always wins for these, only falling back to a
// manual entry on a day the sync genuinely never ran.
const SYNC_COVERED_AIRLINES: readonly AirlineKey[] = ["UNITED", "RANO", "ENUGU", "XEJET"];

export const AirlineOpeningBalanceRepository = {
  /**
   * Upserts one row per parsed line from a "Balance Update" message — a
   * same-day repost (a correction posted later the same night) overwrites
   * rather than stacking, via the [chatId, airline, dateLagos] unique
   * constraint. rawText is kept for audit even though only the parsed
   * numbers are ever read back.
   */
  async recordManualBalances(chatId: string, dateLagos: string, rawText: string, entries: ParsedOpeningBalance[]): Promise<void> {
    if (entries.length === 0) return;
    await prisma.$transaction(
      entries.map((entry) =>
        prisma.airlineOpeningBalance.upsert({
          where: { chatId_airline_dateLagos: { chatId, airline: entry.airline, dateLagos } },
          create: { chatId, airline: entry.airline, dateLagos, balance: entry.balance, source: "MANUAL", rawText },
          update: { balance: entry.balance, rawText },
        })
      )
    );
  },

  /**
   * The opening balance to show for each airline on this chat's report
   * for this Lagos day — merges two sources:
   *  - SYNC_COVERED_AIRLINES: the most recent successful
   *    AirlineBalanceHistory entry retrieved BEFORE this day started
   *    (i.e. the real balance the day opened with, not a live/current
   *    figure that may have already moved since).
   *  - everything else: a manually-posted "Balance Update" entry for this
   *    exact day, if one was posted.
   * An airline with no known OB from either source is simply absent from
   * the returned map — the report renderer treats that as "OB unknown"
   * and falls back to the no-OB line format, never a guessed/zero value.
   */
  async getOpeningBalances(chatId: string, dateLagos: string): Promise<Map<AirlineKey, number>> {
    const dayStart = lagosDayStartUtc(dateLagos);

    const [manualRows, syncRows] = await Promise.all([
      prisma.airlineOpeningBalance.findMany({ where: { chatId, dateLagos } }),
      prisma.airlineBalanceHistory.findMany({
        where: {
          airline: { in: [...SYNC_COVERED_AIRLINES] },
          syncStatus: "SUCCESS",
          retrievedAt: { lt: dayStart },
        },
        orderBy: { retrievedAt: "desc" },
        // One most-recent-before-dayStart row per airline is all that's
        // needed — over-fetching a little here (rather than a more
        // complex distinct-on query) and reducing to the first hit per
        // airline below keeps this readable; history tables are typically
        // small enough per chat/day window for this to be a non-issue.
        take: SYNC_COVERED_AIRLINES.length * 8,
      }),
    ]);

    const balances = new Map<AirlineKey, number>();

    for (const row of manualRows) {
      balances.set(row.airline, Number(row.balance));
    }

    // syncRows is already ordered most-recent-first, so the first row seen
    // per airline here is exactly "the last successful sync before this
    // day began" — later (older) rows for the same airline are ignored.
    // This deliberately overwrites any manual entry for these four
    // airlines, per SYNC_COVERED_AIRLINES' own doc comment above.
    const seenSyncAirlines = new Set<AirlineKey>();
    for (const row of syncRows) {
      if (seenSyncAirlines.has(row.airline)) continue;
      seenSyncAirlines.add(row.airline);
      balances.set(row.airline, Number(row.balance));
    }

    return balances;
  },
};
