import { BookingJobRepository } from "../../src/modules/travel-assistant/storage/BookingJobRepository";
import type { BookingJob } from "@prisma/client";

// Bookings against the shared Enugu Air admin account can't run
// concurrently on the SAME login — the VARS portal session is tied to one
// active agent login, so two simultaneous Playwright sessions on the same
// credentials would collide (confirmed by the existing single-credential
// setup having no concurrency guard at all today). This pool gives each
// configured account its own dedicated "worker" — a booking assigned to a
// worker owns that account's session exclusively until it finishes, and
// requests beyond the number of configured accounts wait in a plain FIFO
// queue rather than racing each other onto the same login.
//
// Configuration-only to scale: ENUGU_BOOKING_ACCOUNTS is a JSON array of
// {label, username, password}. Adding a fifth account later is a config
// change on Railway, not a code change — see loadEnuguAccountsFromEnv.
export interface EnuguAccount {
  label: string;
  username: string;
  password: string;
}

// The pool itself knows nothing about HOW to run a booking (search,
// fill passenger details, submit) — that stays owned by server.ts, which
// already has the BookOnHoldRequest-building and result-handling logic.
// This keeps the pool a pure dispatch mechanism: which account is free,
// what's waiting, who goes next.
export type RunEnuguJob = (job: BookingJob, account: EnuguAccount) => Promise<void>;

interface Worker {
  account: EnuguAccount;
  busy: boolean;
}

export class EnuguWorkerPool {
  private readonly workers: Worker[];
  private readonly queue: BookingJob[] = [];
  private readonly runJob: RunEnuguJob;

  constructor(accounts: EnuguAccount[], runJob: RunEnuguJob) {
    if (accounts.length === 0) {
      throw new Error("EnuguWorkerPool needs at least one account configured");
    }
    this.workers = accounts.map((account) => ({ account, busy: false }));
    this.runJob = runJob;
  }

  get accountCount(): number {
    return this.workers.length;
  }

  // Assigns to the first free worker immediately, or appends to the FIFO
  // queue and persists the queue position (BookingJobRepository.markQueued)
  // so the chat pollers can pick it up. Returns the 1-based queue position,
  // or 0 if the job started right away — the caller (server.ts) uses this
  // only for its own log line; the "You are #X in the queue" message is
  // built by the poller from the persisted job row, not from this return
  // value, since a later dequeue/renumber needs to reach the SAME message
  // regardless of who's watching.
  async submit(job: BookingJob): Promise<number> {
    const free = this.workers.find((w) => !w.busy);
    if (free) {
      this.start(free, job);
      return 0;
    }
    this.queue.push(job);
    const position = this.queue.length;
    await BookingJobRepository.markQueued(job.id, position).catch((err) =>
      console.error(`[enugu-pool] failed to persist queued state for job ${job.id}:`, err)
    );
    console.log(`[enugu-pool] all ${this.workers.length} account(s) busy — job ${job.id} queued at position ${position}`);
    return position;
  }

  private start(worker: Worker, job: BookingJob): void {
    worker.busy = true;
    console.log(`[enugu-pool] account "${worker.account.label}" picked up job ${job.id}`);
    this.runJob(job, worker.account)
      .catch((err) => {
        // runJob (server.ts) already owns markSuccess/markFailed for every
        // expected outcome — this catch exists purely so an unexpected
        // throw can't leave the worker permanently marked busy.
        console.error(`[enugu-pool] account "${worker.account.label}" job ${job.id} escaped with an unhandled error:`, err);
      })
      .finally(() => this.release(worker));
  }

  private release(worker: Worker): void {
    worker.busy = false;
    const next = this.queue.shift();
    if (!next) return;
    this.start(worker, next);
    // Everyone still waiting moved up one place — re-persist so their next
    // poll shows the correct position/estimated wait, not a stale one.
    this.queue.forEach((queuedJob, i) => {
      BookingJobRepository.updateQueuePosition(queuedJob.id, i + 1).catch((err) =>
        console.error(`[enugu-pool] failed to update queue position for job ${queuedJob.id}:`, err)
      );
    });
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
