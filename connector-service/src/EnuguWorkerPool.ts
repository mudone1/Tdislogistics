import { BookingJobRepository } from "../../src/modules/travel-assistant/storage/BookingJobRepository";
import { EnuguWorkerSlotRepository } from "../../src/modules/travel-assistant/storage/EnuguWorkerSlotRepository";
import type { BookingJob } from "@prisma/client";

// Bookings against the shared Enugu Air admin account can't run
// concurrently on the SAME login — the VARS portal session is tied to one
// active agent login, so two simultaneous Playwright sessions on the same
// credentials would collide. This pool gives each configured account its
// own dedicated "worker" — a booking assigned to a worker owns that
// account's session exclusively until it finishes, and requests beyond
// the number of configured accounts wait in a FIFO queue.
//
// Which account is actually free is decided by EnuguWorkerSlotRepository
// (an atomic Postgres claim), NOT by in-memory state on this class —
// confirmed live that Railway's rolling deploys briefly run the OLD and
// NEW connector-service process at once, and an in-memory-only "busy"
// flag gave zero protection across that overlap (two processes each
// thought they had a free worker and collided on the same account). The
// FIFO queue itself stays in-memory per process — losing queue ordering
// across a deploy is a minor UX blip (a re-numbered position), not a
// collision, so it doesn't need the same cross-process guarantee.
//
// Configuration-only to scale: ENUGU_BOOKING_ACCOUNTS is a JSON array of
// {label, username, password}. Adding a fifth account later is a config
// change on Railway, not a code change — see loadEnuguAccountsFromEnv.
export interface EnuguAccount {
  label: string;
  username: string;
  password: string;
}

// The pool itself knows nothing about HOW to run a booking (search, fill
// passenger details, submit) — that stays owned by server.ts, which
// already has the BookOnHoldRequest-building and result-handling logic.
export type RunEnuguJob = (job: BookingJob, account: EnuguAccount) => Promise<void>;

// While anything is queued, re-attempt claiming on this interval — not
// just when THIS process's own job finishes. A slot can free up because a
// DIFFERENT process released it (or its claim went stale), which this
// process has no direct signal for; polling is the simple, correct
// fallback so a queued job in any process eventually gets picked up
// regardless of which process's release actually freed the slot.
const QUEUE_POLL_MS = 5000;

export class EnuguWorkerPool {
  private readonly accounts: EnuguAccount[];
  private readonly queue: BookingJob[] = [];
  private readonly runJob: RunEnuguJob;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(accounts: EnuguAccount[], runJob: RunEnuguJob) {
    if (accounts.length === 0) {
      throw new Error("EnuguWorkerPool needs at least one account configured");
    }
    this.accounts = accounts;
    this.runJob = runJob;
  }

  get accountCount(): number {
    return this.accounts.length;
  }

  // Tries to claim a free account immediately; if none is free (in
  // Postgres — the real source of truth), appends to the FIFO queue and
  // persists the position (BookingJobRepository.markQueued) so the chat
  // pollers can show it. Returns 0 if started immediately, else the
  // 1-based queue position.
  async submit(job: BookingJob): Promise<number> {
    const account = await this.claimAnyAccount(job.id);
    if (account) {
      this.run(account, job);
      return 0;
    }

    this.queue.push(job);
    const position = this.queue.length;
    await BookingJobRepository.markQueued(job.id, position).catch((err) =>
      console.error(`[enugu-pool] failed to persist queued state for job ${job.id}:`, err)
    );
    console.log(`[enugu-pool] all ${this.accounts.length} account(s) busy — job ${job.id} queued at position ${position}`);
    this.ensurePolling();
    return position;
  }

  private async claimAnyAccount(jobId: string): Promise<EnuguAccount | null> {
    for (const account of this.accounts) {
      if (await EnuguWorkerSlotRepository.tryClaim(account.label, jobId)) return account;
    }
    return null;
  }

  private run(account: EnuguAccount, job: BookingJob): void {
    console.log(`[enugu-pool] account "${account.label}" picked up job ${job.id}`);
    this.runJob(job, account)
      .catch((err) => {
        // runJob (server.ts) already owns markSuccess/markFailed for every
        // expected outcome — this catch exists purely so an unexpected
        // throw can't skip releasing the account's slot.
        console.error(`[enugu-pool] account "${account.label}" job ${job.id} escaped with an unhandled error:`, err);
      })
      .finally(() => {
        this.finish(account, job).catch((err) => console.error(`[enugu-pool] finish() failed for job ${job.id}:`, err));
      });
  }

  private async finish(account: EnuguAccount, job: BookingJob): Promise<void> {
    await EnuguWorkerSlotRepository.release(account.label, job.id).catch((err) =>
      console.error(`[enugu-pool] failed to release account "${account.label}" for job ${job.id}:`, err)
    );
    await this.tryDequeue();
  }

  // Drains as much of the local queue as currently-free accounts allow.
  // Safe to call repeatedly/concurrently (from a finish() and the poll
  // timer landing close together) — claimAnyAccount only ever succeeds
  // once per free account, so a losing caller here just sees no more
  // queued work to start this round.
  private async tryDequeue(): Promise<void> {
    while (this.queue.length > 0) {
      const account = await this.claimAnyAccount(this.queue[0].id);
      if (!account) break;
      const job = this.queue.shift()!;
      this.run(account, job);
    }

    if (this.queue.length === 0) {
      this.stopPolling();
      return;
    }

    // Everyone still waiting moved up — re-persist so their next poll
    // shows the correct position/estimated wait, not a stale one.
    this.queue.forEach((queuedJob, i) => {
      BookingJobRepository.updateQueuePosition(queuedJob.id, i + 1).catch((err) =>
        console.error(`[enugu-pool] failed to update queue position for job ${queuedJob.id}:`, err)
      );
    });
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.tryDequeue().catch((err) => console.error("[enugu-pool] queue poll failed:", err));
    }, QUEUE_POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

// ENUGU_BOOKING_ACCOUNTS — JSON array, e.g.:
//   [{"label":"acct1","username":"...","password":"..."},{"label":"acct2","username":"...","password":"..."}]
// Not set (or invalid) → null, and the caller falls back to a single
// worker built from whichever credentials the existing per-job lookup
// (personal, then admin) resolves — unchanged behavior for a deployment
// that hasn't configured multiple accounts yet.
export function loadEnuguAccountsFromEnv(): EnuguAccount[] | null {
  const raw = process.env.ENUGU_BOOKING_ACCOUNTS;
  if (!raw || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[enugu-pool] ENUGU_BOOKING_ACCOUNTS is set but not valid JSON — ignoring, falling back to a single account:", err);
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error("[enugu-pool] ENUGU_BOOKING_ACCOUNTS must be a non-empty JSON array — ignoring, falling back to a single account");
    return null;
  }

  const accounts: EnuguAccount[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as Record<string, unknown>;
    if (typeof entry?.username !== "string" || typeof entry?.password !== "string" || !entry.username || !entry.password) {
      console.error(`[enugu-pool] ENUGU_BOOKING_ACCOUNTS[${i}] is missing username/password — ignoring, falling back to a single account`);
      return null;
    }
    accounts.push({
      label: typeof entry.label === "string" && entry.label ? entry.label : `account-${i + 1}`,
      username: entry.username,
      password: entry.password,
    });
  }
  return accounts;
}
