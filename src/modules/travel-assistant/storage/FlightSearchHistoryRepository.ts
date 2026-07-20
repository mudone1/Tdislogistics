import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { FlightSearchResult } from "../core/types";

/**
 * Repository pattern — mirrors ChatMemoryRepository/AirlineWalletRepository.
 * One row per completed leg (a round-trip search saves two).
 */
export const FlightSearchHistoryRepository = {
  async saveSearch(sessionId: string, result: FlightSearchResult, airlines: readonly string[]) {
    const referenceId = await nextReferenceId();
    return prisma.flightSearchRecord.create({
      data: {
        referenceId,
        sessionId,
        origin: result.query.origin,
        destination: result.query.destination,
        date: result.query.date,
        airlines: [...airlines],
        resultCount: result.options.length,
        resultsJson: result as object,
      },
    });
  },

  async getByReferenceId(referenceId: string) {
    return prisma.flightSearchRecord.findUnique({ where: { referenceId: referenceId.toUpperCase() } });
  },

  async getRecentForSession(sessionId: string, limit: number) {
    return prisma.flightSearchRecord.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};

// TDIS-YYYYMMDD-NNN, sequential per day. Counting today's existing rows
// isn't perfectly race-proof under heavy concurrent writes, but this is a
// low-volume internal tool (matches the simplicity level of the rest of
// this module) — a genuine collision would need two searches completing
// in the same instant, and worst case a retry on unique-constraint
// failure would resolve it, which isn't worth the complexity here.
async function nextReferenceId(): Promise<string> {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const countToday = await prisma.flightSearchRecord.count({
    where: { createdAt: { gte: startOfDay } },
  });

  const seq = String(countToday + 1).padStart(3, "0");
  return `TDIS-${datePart}-${seq}`;
}
