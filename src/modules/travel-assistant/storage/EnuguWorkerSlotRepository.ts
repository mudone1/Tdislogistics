import { prisma } from "../../airline-connectors/storage/prismaClient";

// Postgres-backed mutual exclusion for the Enugu Air worker pool (see
// connector-service's EnuguWorkerPool.ts). Every connector-service process
// shares this table, so it — not the pool's own in-memory state — is the
// real lock. Needed because Railway's rolling deploys briefly run the OLD
// and NEW process at once: confirmed live, that overlap let two processes
// each believe they had a free worker and both drive Playwright against
// the same account simultaneously, colliding mid-booking.
const STALE_CLAIM_MS = 10 * 60 * 1000; // generous — a real booking finishes well under this

export const EnuguWorkerSlotRepository = {
  // Idempotent — safe to call on every process start. Creates a row for
  // any newly-configured account without touching an already-claimed one
  // (a new process starting up mid-deploy must never steal a slot the old
  // process is still legitimately using).
  async ensureSlots(accountLabels: string[]): Promise<void> {
    for (const accountLabel of accountLabels) {
      await prisma.enuguWorkerSlot.upsert({
        where: { accountLabel },
        create: { accountLabel },
        update: {},
      });
    }
  },

  // Atomic conditional claim — succeeds only if the slot is unclaimed, or
  // its existing claim is stale (the claiming process almost certainly
  // died without releasing; a real booking never legitimately holds a
  // slot this long). Returns true iff THIS call won the claim — the
  // single UPDATE is what makes this safe under real concurrent callers,
  // not the surrounding application code.
  async tryClaim(accountLabel: string, jobId: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const result = await prisma.enuguWorkerSlot.updateMany({
      where: {
        accountLabel,
        OR: [{ claimedByJobId: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: { claimedByJobId: jobId, claimedAt: new Date() },
    });
    return result.count === 1;
  },

  // Only clears the claim if it still belongs to this job — a stale claim
  // already reclaimed by someone else (via the staleness window above)
  // must never be released out from under whoever holds it now.
  async release(accountLabel: string, jobId: string): Promise<void> {
    await prisma.enuguWorkerSlot.updateMany({
      where: { accountLabel, claimedByJobId: jobId },
      data: { claimedByJobId: null, claimedAt: null },
    });
  },
};
