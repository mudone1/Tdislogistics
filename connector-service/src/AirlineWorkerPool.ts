import { BookingJobRepository } from "../../src/modules/travel-assistant/storage/BookingJobRepository";
import { AirlineWorkerSlotRepository } from "../../src/modules/travel-assistant/storage/AirlineWorkerSlotRepository";
import { BookingCancelledError } from "../../src/modules/travel-assistant/booking/BookingCancelledError";
import type { AirlineKey, BookingJob } from "@prisma/client";

// Generalizes EnuguWorkerPool (deleted, superseded — this file replaces it)
// across every bookable airline. Bookings against a SHARED account can't
// run concurrently on the same login — the VARS/KIU portal session is tied
// to one active agent login, so two simultaneous Playwright sessions on the
// same credentials would collide. This pool gives each configured account
// its own dedicated "worker" — a booking assigned to a worker owns that
// account's session exclusively until it finishes, and requests beyond the
// number of configured (or eligible, see below) accounts wait in a queue.
//
// Which account is actually free is decided by AirlineWorkerSlotRepository
// (an atomic Postgres claim), NOT by in-memory state on this class —
// confirmed live (on the original Enugu-only version of this pool) that
// Railway's rolling deploys briefly run the OLD and NEW connector-service
// process at once, and an in-memory-only "busy" flag gave zero protection
// across that overlap. The FIFO queue itself stays in-memory per process —
// losing queue ordering across a deploy is a minor UX blip (a re-numbered
// position), not a collision, so it doesn't need the same cross-process
// guarantee.
export interface AirlineAccount {
  label: string;
  username: string;
  password: string;
}

// The pool itself knows nothing about HOW to run a booking (search, fill
// passenger details, submit) — that stays owned by server.ts, which
// already has the BookOnHoldRequest-building and result-handling logic.
export type RunAirlineJob = (job: BookingJob, account: AirlineAccount) => Promise<void>;

// While anything is queued, re-attempt claiming on this interval — not
// just when THIS process's own job finishes. A slot can free up because a
// DIFFERENT process released it (or its claim went stale), which this
// process has no direct signal for; polling is the simple, correct
// fallback so a queued job in any process eventually gets picked up
// regardless of which process's release actually freed the slot.
const QUEUE_POLL_MS = 5000;

interface QueueEntry {
  job: BookingJob;
  // "ANY" — legacy Enugu-with-no-/settings-preference behavior: claim
  // whichever configured account is free first (maximizes throughput,
  // matches this pool's exact pre-generalization behavior for Enugu).
  // A specific label list (always length 1 today) — this job is sticky to
  // one particular account, either an explicit /settings preference or
  // the "first configured account" default every non-Enugu airline uses
  // when no preference is set.
  eligibleAccountLabels: string[] | "ANY";
}

export class AirlineWorkerPool {
  private readonly airline: AirlineKey;
  private readonly accounts: AirlineAccount[];
  private readonly queue: QueueEntry[] = [];
  private readonly runJob: RunAirlineJob;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(airline: AirlineKey, accounts: AirlineAccount[], runJob: RunAirlineJob) {
    if (accounts.length === 0) {
      throw new Error(`AirlineWorkerPool(${airline}) needs at least one account configured`);
    }
    this.airline = airline;
    this.accounts = accounts;
    this.runJob = runJob;
  }

  get accountCount(): number {
    return this.accounts.length;
  }

  // Tries to claim an eligible account immediately; if none is free (in
  // Postgres — the real source of truth), appends to the FIFO queue and
  // persists the position (BookingJobRepository.markQueued) so the chat
  // pollers can show it. Returns 0 if started immediately, else the
  // 1-based queue position.
  //
  // preferredAccountLabel drives which accounts are eligible for this job:
  // given and it's a real configured account -> sticky to just that one
  // (queue behind it specifically if busy, never "steal" a different free
  // account instead — the whole point of /settings is a predictable login
  // per number). Omitted -> ENUGU falls back to its original "any free
  // account" behavior (unset-preference default kept unchanged from before
  // this pool was generalized); every other airline defaults to sticky on
  // accounts[0] (the confirmed product default: never blocks a booking on
  // an unset preference, but still gives it a stable, attributable login).
  async submit(job: BookingJob, preferredAccountLabel?: string | null): Promise<number> {
    const eligibleAccountLabels = this.resolveEligibleLabels(preferredAccountLabel ?? undefined);
    const account = await this.claimFromEligible(job.id, eligibleAccountLabels);
    if (account) {
      this.run(account, job);
      return 0;
    }

    this.queue.push({ job, eligibleAccountLabels });
    const position = this.queue.length;
    await BookingJobRepository.markQueued(job.id, position).catch((err) =>
      console.error(`[${this.airline.toLowerCase()}-pool] failed to persist queued state for job ${job.id}:`, err)
    );
    console.log(
      `[${this.airline.toLowerCase()}-pool] no eligible account free — job ${job.id} queued at position ${position}`
    );
    this.ensurePolling();
    return position;
  }

  private resolveEligibleLabels(preferredAccountLabel?: string): string[] | "ANY" {
    if (preferredAccountLabel) {
      const match = this.accounts.find((a) => a.label === preferredAccountLabel);
      if (match) return [match.label];
      console.warn(
        `[${this.airline.toLowerCase()}-pool] preferred account "${preferredAccountLabel}" isn't currently configured — falling back to the default`
      );
    }
    if (this.airline === "ENUGU") return "ANY";
    return [this.accounts[0].label];
  }

  private async claimFromEligible(jobId: string, eligible: string[] | "ANY"): Promise<AirlineAccount | null> {
    const candidates = eligible === "ANY" ? this.accounts : this.accounts.filter((a) => eligible.includes(a.label));
    for (const account of candidates) {
      if (await AirlineWorkerSlotRepository.tryClaim(this.airline, account.label, jobId)) return account;
    }
    return null;
  }

  private run(account: AirlineAccount, job: BookingJob): void {
    console.log(`[${this.airline.toLowerCase()}-pool] account "${account.label}" picked up job ${job.id}`);
    this.runJob(job, account)
      .catch((err) => {
        // A BookingCancelledError is expected control flow (the caller
        // already special-cases it before this ever reaches markFailed) —
        // runJob (server.ts) already owns markSuccess/markFailed/the
        // cancelled path for every expected outcome. This catch exists
        // purely so an unexpected throw can't skip releasing the
        // account's slot.
        if (!(err instanceof BookingCancelledError)) {
          console.error(`[${this.airline.toLowerCase()}-pool] account "${account.label}" job ${job.id} escaped with an unhandled error:`, err);
        }
      })
      .finally(() => {
        this.finish(account, job).catch((err) =>
          console.error(`[${this.airline.toLowerCase()}-pool] finish() failed for job ${job.id}:`, err)
        );
      });
  }

  private async finish(account: AirlineAccount, job: BookingJob): Promise<void> {
    await AirlineWorkerSlotRepository.release(this.airline, account.label, job.id).catch((err) =>
      console.error(`[${this.airline.toLowerCase()}-pool] failed to release account "${account.label}" for job ${job.id}:`, err)
    );
    await this.tryDequeue();
  }

  // Scans the WHOLE queue every pass, not just its head — unlike the
  // original Enugu-only pool (safe there because every queued job shared
  // the same "any free account" eligibility, so if the head couldn't
  // claim, nothing behind it could either). Now that different queued jobs
  // can be sticky to DIFFERENT specific accounts, a job stuck behind a
  // busy account must not block a different job further back whose own
  // sticky account just freed up.
  //
  // Also re-checks each queued job's live status before claiming for it —
  // a job cancelled while merely QUEUED (see CANCEL/RESET in
  // ConversationOrchestrator.ts) never even reaches Playwright; it's just
  // dropped here for free, no account claim, no automation run.
  private async tryDequeue(): Promise<void> {
    const remaining: QueueEntry[] = [];
    for (const entry of this.queue) {
      const live = await BookingJobRepository.findById(entry.job.id).catch(() => null);
      if (!live || live.status !== "PENDING") {
        console.log(`[${this.airline.toLowerCase()}-pool] dropping queued job ${entry.job.id} — no longer PENDING (${live?.status ?? "not found"})`);
        continue;
      }
      const account = await this.claimFromEligible(entry.job.id, entry.eligibleAccountLabels);
      if (account) {
        this.run(account, entry.job);
      } else {
        remaining.push(entry);
      }
    }
    this.queue.length = 0;
    this.queue.push(...remaining);

    if (this.queue.length === 0) {
      this.stopPolling();
      return;
    }

    // Everyone still waiting moved up — re-persist so their next poll
    // shows the correct position/estimated wait, not a stale one.
    this.queue.forEach((entry, i) => {
      BookingJobRepository.updateQueuePosition(entry.job.id, i + 1).catch((err) =>
        console.error(`[${this.airline.toLowerCase()}-pool] failed to update queue position for job ${entry.job.id}:`, err)
      );
    });
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.tryDequeue().catch((err) => console.error(`[${this.airline.toLowerCase()}-pool] queue poll failed:`, err));
    }, QUEUE_POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

// <AIRLINE>_BOOKING_ACCOUNTS — JSON array, e.g.:
//   [{"label":"acct1","username":"...","password":"..."},{"label":"acct2","username":"...","password":"..."}]
// ENUGU_BOOKING_ACCOUNTS keeps its exact original name (not renamed) —
// UNITED_BOOKING_ACCOUNTS / XEJET_BOOKING_ACCOUNTS / RANO_BOOKING_ACCOUNTS /
// VALUEJET_BOOKING_ACCOUNTS are the new ones this generalization adds. Not
// set (or invalid) -> null, and the caller falls back to a single worker
// built from whichever credentials the existing per-job lookup (personal,
// then admin) resolves — unchanged behavior for a deployment that hasn't
// configured multiple accounts for that airline yet.
export function loadAccountsFromEnv(airline: AirlineKey): AirlineAccount[] | null {
  const envVar = `${airline}_BOOKING_ACCOUNTS`;
  const raw = process.env[envVar];
  if (!raw || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[airline-pool] ${envVar} is set but not valid JSON — ignoring, falling back to a single account:`, err);
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error(`[airline-pool] ${envVar} must be a non-empty JSON array — ignoring, falling back to a single account`);
    return null;
  }

  const accounts: AirlineAccount[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as Record<string, unknown>;
    if (typeof entry?.username !== "string" || typeof entry?.password !== "string" || !entry.username || !entry.password) {
      console.error(`[airline-pool] ${envVar}[${i}] is missing username/password — ignoring, falling back to a single account`);
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
