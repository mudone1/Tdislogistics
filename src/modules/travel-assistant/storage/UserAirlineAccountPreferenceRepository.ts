import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { AirlineKey } from "@prisma/client";

// Per-WhatsApp-number (sessionKey), per-airline preferred login account —
// set via the /settings command (handleSettingsCommand.ts), read by
// connector-service's book-hold route before submitting a job to
// AirlineWorkerPool. No row for a given [sessionKey, airline] means "no
// preference saved" — the pool falls back to its own default (see
// AirlineWorkerPool.submit).
export const UserAirlineAccountPreferenceRepository = {
  async get(sessionKey: string, airline: AirlineKey): Promise<string | null> {
    const row = await prisma.userAirlineAccountPreference.findUnique({
      where: { sessionKey_airline: { sessionKey, airline } },
    });
    return row?.accountLabel ?? null;
  },

  async set(sessionKey: string, airline: AirlineKey, accountLabel: string): Promise<void> {
    await prisma.userAirlineAccountPreference.upsert({
      where: { sessionKey_airline: { sessionKey, airline } },
      create: { sessionKey, airline, accountLabel },
      update: { accountLabel },
    });
  },
};
