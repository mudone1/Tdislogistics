import "dotenv/config";
console.log("[startup-diagnostic] TRAVELPORT_AUTH_URL set:", !!process.env.TRAVELPORT_AUTH_URL);
console.log("[startup-diagnostic] TRAVELPORT_USERNAME set:", !!process.env.TRAVELPORT_USERNAME);
console.log("[startup-diagnostic] TRAVELPORT_PASSWORD set:", !!process.env.TRAVELPORT_PASSWORD);
console.log("[startup-diagnostic] TRAVELPORT_CLIENT_ID set:", !!process.env.TRAVELPORT_CLIENT_ID);
console.log("[startup-diagnostic] TRAVELPORT_CLIENT_SECRET set:", !!process.env.TRAVELPORT_CLIENT_SECRET);
console.log("[startup-diagnostic] CONNECTOR_SERVICE_API_KEY set:", !!process.env.CONNECTOR_SERVICE_API_KEY);
import express from "express";
import { requireInternalApiKey } from "./auth";
import { startScheduler } from "./scheduler";
import { runSync, testConnection } from "../../src/modules/airline-connectors/services/SyncService";
import { AirlineWalletRepository } from "../../src/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "../../src/modules/airline-connectors/services/ConnectorRegistry";
import type { AirlineKey } from "../../src/modules/airline-connectors/core/types";
import { searchEnuguAirFlights } from "../../src/modules/travel-assistant/search/enugu/EnuguAirSearch";
import { searchUnitedNigeriaFlights } from "../../src/modules/travel-assistant/search/united/UnitedNigeriaSearch";
import { searchXeJetFlights } from "../../src/modules/travel-assistant/search/xejet/XeJetSearch";
import { searchRanoAirFlights } from "../../src/modules/travel-assistant/search/rano/RanoAirSearch";
import { searchValueJetFlights } from "../../src/modules/travel-assistant/search/valuejet/ValueJetSearch";
import { searchTravelportForAssistant } from "./travelport/travelportAdapter";
import { bookEnuguAirOnHold } from "../../src/modules/travel-assistant/booking/enugu/EnuguBookOnHold";
import { bookUnitedNigeriaOnHold } from "../../src/modules/travel-assistant/booking/united/UnitedBookOnHold";
import { bookRanoAirOnHold } from "../../src/modules/travel-assistant/booking/rano/RanoBookOnHold";
import { bookXeJetOnHold } from "../../src/modules/travel-assistant/booking/xejet/XeJetBookOnHold";
import { bookValueJetOnHold } from "../../src/modules/travel-assistant/booking/valuejet/ValueJetBookOnHold";
import { BookingJobRepository } from "../../src/modules/travel-assistant/storage/BookingJobRepository";
import { categorizeBookingError } from "../../src/modules/travel-assistant/booking/categorizeBookingError";
import { decryptSecret } from "../../src/modules/airline-connectors/services/CredentialService";
import { UserCredentialRepository } from "../../src/modules/airline-connectors/storage/UserCredentialRepository";
import { UserAirlineAccountPreferenceRepository } from "../../src/modules/travel-assistant/storage/UserAirlineAccountPreferenceRepository";
import { BookingCancelledError } from "../../src/modules/travel-assistant/booking/BookingCancelledError";
import type { FlightSearchQuery, FlightSearchResult } from "../../src/modules/travel-assistant/core/types";
import { AirlineWorkerPool, loadAccountsFromEnv } from "./AirlineWorkerPool";
import { AirlineWorkerSlotRepository } from "../../src/modules/travel-assistant/storage/AirlineWorkerSlotRepository";
import type { BookingJob, BookingStage } from "@prisma/client";

const TRAVEL_ASSISTANT_SEARCHERS: Record<string, (query: FlightSearchQuery) => Promise<FlightSearchResult>> = {
  ENUGU: searchEnuguAirFlights,
  UNITED: searchUnitedNigeriaFlights,
  XEJET: searchXeJetFlights,
  RANO: searchRanoAirFlights,
  VALUEJET: searchValueJetFlights,
  TRAVELPORT: searchTravelportForAssistant,
};

// Short-lived, in-memory, single-process cache — fine for this workload
// (one connector-service instance, no horizontal scaling) and cheap
// insurance against the same route+date getting searched twice in close
// succession (round-trip legs, a user re-asking, retries).
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const searchCache = new Map<string, { result: FlightSearchResult; expiresAt: number }>();

function cacheKey(airline: string, origin: string, destination: string, date: string): string {
  return `${airline}:${origin}:${destination}:${date}`;
}

const app = express();
app.use(express.json());

// build marker bumped whenever this file changes — used to confirm a Railway
// deploy actually picked up the latest code, since this service deploys
// separately from the Vercel app and has no other visible version signal.
app.get("/internal/health", (_req, res) => res.json({ ok: true, build: "job-based-book-hold-v2" }));

app.get("/internal/whatismyip", requireInternalApiKey, async (_req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.use(requireInternalApiKey);

function assertKnownAirline(airline: string, res: express.Response): airline is AirlineKey {
  if (!ConnectorRegistry.isImplemented(airline)) {
    res.status(404).json({
      error: `"${airline}" is not an implemented connector (Category B airlines aren't built yet - see connectors/README.md)`,
    });
    return false;
  }
  return true;
}

app.post("/internal/connectors/:airline/sync", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const trigger = req.body?.trigger === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
  console.log(`[sync] starting ${trigger} sync for ${airline}`);

  res.status(202).json({ accepted: true, airline, trigger, message: "Sync started" });

  runSync(airline, trigger)
    .then((result) => {
      console.log(`[sync] result for ${airline}:`, JSON.stringify(result));
    })
    .catch((err) => {
      console.error(`[sync] uncaught error for ${airline}:`, err);
    });
});

app.post("/internal/connectors/:airline/test", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  console.log(`[test] starting connection test for ${airline}`);
  try {
    const result = await testConnection(airline);
    console.log(`[test] result for ${airline}:`, JSON.stringify(result));
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    console.error(`[test] uncaught error for ${airline}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/internal/connectors/:airline/status", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const [wallet, settings] = await Promise.all([
    AirlineWalletRepository.getWallet(airline),
    AirlineWalletRepository.getSettings(airline),
  ]);
  res.json({ wallet, settings });
});

app.get("/internal/connectors/:airline/history", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const limit = Math.min(200, Number(req.query.limit) || 50);
  const history = await AirlineWalletRepository.getHistory(airline, limit);
  res.json({ history });
});

app.post("/internal/travel-assistant/search", async (req, res) => {
  const { origin, destination, date, airline } = req.body || {};
  if (!origin || !destination || !date) {
    res.status(400).json({ error: "origin, destination, and date are all required", stage: "VALIDATION" });
    return;
  }

  const airlineKey = (airline || "ENUGU").toUpperCase();
  const search = TRAVEL_ASSISTANT_SEARCHERS[airlineKey];
  if (!search) {
    res
      .status(404)
      .json({ error: `"${airlineKey}" has no travel-assistant search implemented`, stage: "VALIDATION" });
    return;
  }

  const key = cacheKey(airlineKey, origin, destination, date);
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[travel-assistant] cache HIT ${key}`);
    res.json({ ...cached.result, cacheHit: true });
    return;
  }

  const startedAt = Date.now();
  console.log(`[travel-assistant] search START ${key}`);

  try {
    const result = await search({ origin, destination, date });
    const durationMs = Date.now() - startedAt;
    console.log(`[travel-assistant] search OK ${key} in ${durationMs}ms, ${result.options.length} option(s)`);

    searchCache.set(key, { result, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    res.json({ ...result, durationMs });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[travel-assistant] search FAILED ${key} after ${durationMs}ms:`, message);
    res.status(502).json({ error: message, stage: "PLAYWRIGHT_SEARCH", airline: airlineKey, durationMs });
  }
});

// Account LABELS only (never usernames/passwords) for one airline's worker
// pool — the /settings command (handleSettingsCommand.ts, Next.js side)
// calls this because it has no other way to know what's configured: the
// <AIRLINE>_BOOKING_ACCOUNTS env vars only exist on this Railway service,
// by design (never duplicated into Vercel). An airline with no configured
// env var reports a single implicit "admin" account (whatever the
// DB-stored admin credential resolves to at booking time) — that's exactly
// what AirlineWorkerPool falls back to as well, so this stays consistent
// with what actually gets used.
app.get("/internal/travel-assistant/accounts/:airline", (req, res) => {
  const airline = req.params.airline.toUpperCase();
  const accounts = loadAccountsFromEnv(airline as Parameters<typeof loadAccountsFromEnv>[0]);
  res.json({ labels: accounts ? accounts.map((a) => a.label) : ["admin"] });
});

const BOOK_ON_HOLD_HANDLERS: Record<string, typeof bookEnuguAirOnHold> = {
  ENUGU: bookEnuguAirOnHold,
  UNITED: bookUnitedNigeriaOnHold,
  RANO: bookRanoAirOnHold,
  XEJET: bookXeJetOnHold,
  VALUEJET: bookValueJetOnHold,
};

// Fare classband names are airline-specific and not guessable — using the
// wrong airline's names could silently select an unintended (and more
// expensive) fare. An airline with no entry here fails clearly before any
// automation runs, rather than falling back to another airline's names.
//
// UNITED confirmed via live DOM inspection of a real logged-in session
// (2026-07-26): "Economy Promo" and "Economy Saver" both genuinely exist
// as classband names on United Nigeria's fare page too — same white-label
// VARS platform, apparently the same standard fare-tier naming. The
// classband-panel *click mechanism* differs from Enugu's though (see
// VarsBookOnHold.ts's selectCheapestFare) — that part is now handled, but
// the actual final submission (payment -> PNR -> Manage My Booking
// verification) has not yet been run end-to-end for United, only up to
// and including the payment page's field/radio structure.
const FARE_CLASS_PREFERENCE: Partial<Record<string, [string, string]>> = {
  ENUGU: ["Economy Promo", "Economy Saver"],
  UNITED: ["Economy Promo", "Economy Saver"],
  // Not independently confirmed for XeJet's own deployment specifically —
  // reusing the pair verified live for Enugu/United since all three share
  // the exact same white-label VARS platform and, so far, identical
  // standard fare-tier naming. If XeJet's real classband names differ,
  // selectCheapestFare's own diagnostic (dumps every classband actually on
  // the page) will surface that from the next live attempt rather than
  // silently booking the wrong fare.
  XEJET: ["Economy Promo", "Economy Saver"],
  // Rano Air only offers a single "Economy" classband per flight (confirmed
  // via live search across every ABV destination) — no Promo/Saver split.
  RANO: ["Economy", "Economy"],
  // Unused placeholder — ValueJetBookOnHold.ts runs on KIU, not VARS, and
  // picks its class by its own fixed price-priority algorithm (letter
  // codes like J/C/W/D, not a configured named-classband pair). This
  // entry exists only so the generic "no verified fare names configured"
  // gate below doesn't block VALUEJET bookings before they even start.
  VALUEJET: ["", ""],
};

// Actually runs the automation for one job and records the outcome — shared
// by the direct (immediate, unqueued) path and every airline pool's runJob
// callback, so both go through identical markRunning/markSuccess/
// markFailed/markCancelled handling. onStage, when given, mirrors each
// Playwright milestone into the job row (see VarsBookOnHold.ts's
// reportStage) so the chat pollers can show live progress.
async function executeBookingAutomation(
  job: BookingJob,
  handler: typeof bookEnuguAirOnHold,
  credentials: { username: string; password: string },
  fareClassPreference: [string, string],
  onStage?: (stage: BookingStage) => void,
  // True for every pool-managed job (see AirlineWorkerPool's runJob
  // callback below) — a pooled booking never reuses a cached/reused
  // session. Ignored by handlers that don't accept it (ValueJet has no
  // session cache to bypass in the first place).
  forceFreshLogin?: boolean
): Promise<void> {
  const jobId = job.id;
  await BookingJobRepository.markRunning(jobId);
  const startedAt = Date.now();

  // Best-effort CANCEL/RESET/ABORT/STOP support — a live status re-check,
  // not a locally-cached flag, since the cancel could come from a
  // different connector-service process (or Next.js writing straight to
  // Postgres) than the one running this automation. Threaded into the
  // handler and checked right after every existing stage checkpoint (see
  // bookVarsPlatformOnHold/bookValueJetOnHold's own reportStage) — never
  // mid-Playwright-action, since there's no safe place to interrupt one.
  const isCancelled = async () => {
    const live = await BookingJobRepository.findById(jobId).catch(() => null);
    return live?.status === "CANCELLED";
  };

  try {
    const result = await handler(
      credentials,
      {
        origin: job.origin,
        destination: job.destination,
        departureDate: job.departureDate,
        returnDate: job.returnDate ?? undefined,
        fareClassPreference,
        cabinClass: job.cabinClass,
        preferredDepartureTime: job.preferredDepartureTime ?? undefined,
        preferredReturnTime: job.preferredReturnTime ?? undefined,
        passenger: {
          title: job.title,
          firstName: job.firstName,
          lastName: job.lastName,
          mobileNumber: job.phone ?? "",
          email: job.email ?? "",
        },
        additionalPassengers: Array.isArray(job.additionalPassengers)
          ? (job.additionalPassengers as { type?: "ADULT" | "CHILD" | "INFANT"; title: string; firstName: string; lastName: string; dateOfBirth?: string }[])
          : undefined,
      },
      onStage,
      forceFreshLogin,
      isCancelled
    );
    const durationMs = Date.now() - startedAt;

    // The automation ran all the way to a real result in the narrow window
    // AFTER its last stage checkpoint's cancellation check but before this
    // line — meaning a hold may already exist on the airline's own portal
    // that a cancel can no longer prevent. Never silently report this as
    // an ordinary SUCCESS: record what actually happened (PNR included, if
    // any) under the CANCELLED status so staff can see a possible orphaned
    // hold needing manual review, instead of the job just vanishing from
    // view or misreporting as successful.
    if (await isCancelled()) {
      console.warn(`[book-hold] job=${jobId} completed AFTER being cancelled — recording result under CANCELLED, pnr=${result.pnr ?? "(none)"}`);
      await BookingJobRepository.recordCancelledButCompleted(jobId, {
        pnr: result.pnr,
        holdExpiresAt: result.holdExpiresAt,
        totalPayable: result.totalPayable,
        currency: result.currency,
        screenshot: result.screenshot,
        durationMs,
      });
      return;
    }

    // A confirmation page with no parseable PNR is a soft failure — the
    // hold may not have gone through — so treat a null PNR as FAILED rather
    // than reporting a success the staff can't act on. VALUEJET is a
    // narrower exception: CORRECTED (2026-08-08) — it does generate a real
    // reference code on save (confirmed live via screen recording, e.g.
    // "JLTWRI"), and ValueJetBookOnHold.ts now attempts to capture it, but
    // that capture is best-effort against an unconfirmed selector — a
    // capture miss on an otherwise-successful save must not be reported as
    // a failed booking, so a null pnr here still isn't treated as fatal.
    if (!result.pnr && job.airline !== "VALUEJET") {
      console.error(`[book-hold] job=${jobId} finished with no PNR after ${durationMs}ms`);
      await BookingJobRepository.markFailed(jobId, "UNKNOWN", "Completed the flow but no PNR was found on the confirmation page", durationMs);
      return;
    }
    console.log(`[book-hold] job=${jobId} SUCCESS pnr=${result.pnr ?? "(none — reservation saved, not yet ticketed)"} in ${durationMs}ms`);
    await BookingJobRepository.markSuccess(jobId, {
      pnr: result.pnr,
      holdExpiresAt: result.holdExpiresAt,
      totalPayable: result.totalPayable,
      currency: result.currency,
      screenshot: result.screenshot,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // Expected control flow, not a real failure — the job row is already
    // CANCELLED (that's what made isCancelled() true and triggered this
    // throw); must be checked BEFORE markFailed below, or a legitimate
    // cancel would get silently overwritten back to FAILED.
    if (err instanceof BookingCancelledError) {
      console.log(`[book-hold] job=${jobId} stopped after ${durationMs}ms: ${err.message}`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[book-hold] job=${jobId} FAILED after ${durationMs}ms:`, message);
    await BookingJobRepository.markFailed(jobId, categorizeBookingError(message), message, durationMs).catch((e) => {
      console.error(`[book-hold] job=${jobId} could not record failure:`, e);
    });
  }
}

// Lazily-initialized, one singleton PER AIRLINE — built the first time that
// airline's admin-credential booking is submitted. Prefers the explicitly
// configured multi-account pool (<AIRLINE>_BOOKING_ACCOUNTS); when that's
// absent, falls back to a pool of exactly one worker wrapping the single
// stored admin credential (AirlineWalletRepository) — same credential
// source as before this feature, just now serialized through a queue
// instead of running with no concurrency control at all, which was the
// actual bug this generalizes Enugu's original fix to close for every
// bookable airline, not just Enugu.
const airlinePoolPromises = new Map<string, Promise<AirlineWorkerPool>>();

function getAirlinePool(airline: AirlineKey, handler: typeof bookEnuguAirOnHold, fareClassPreference: [string, string]): Promise<AirlineWorkerPool> {
  const logTag = `${airline.toLowerCase()}-pool`;
  let poolPromise = airlinePoolPromises.get(airline);
  if (!poolPromise) {
    poolPromise = (async () => {
      let accounts = loadAccountsFromEnv(airline);
      if (!accounts) {
        const settings = await AirlineWalletRepository.getSettings(airline);
        if (!settings?.encryptedUsername || !settings.encryptedPassword) {
          throw new Error(`No credentials configured for ${airline}`);
        }
        accounts = [
          {
            label: "admin",
            username: decryptSecret(settings.encryptedUsername),
            password: decryptSecret(settings.encryptedPassword),
          },
        ];
      }
      console.log(`[${logTag}] initialized with ${accounts.length} account(s): ${accounts.map((a) => a.label).join(", ")}`);
      // Creates the Postgres claim row for each account if it doesn't
      // already exist — idempotent, and never touches an already-claimed
      // row (see AirlineWorkerSlotRepository.ensureSlots), so this is safe
      // to run on every process start, including mid-deploy overlap with
      // an old process that's still legitimately holding a claim.
      await AirlineWorkerSlotRepository.ensureSlots(airline, accounts.map((a) => a.label));
      return new AirlineWorkerPool(airline, accounts, (job, account) =>
        executeBookingAutomation(
          job,
          handler,
          account,
          fareClassPreference,
          (stage) =>
            BookingJobRepository.updateStage(job.id, stage).catch((err) =>
              console.error(`[${logTag}] failed to update stage for job ${job.id}:`, err)
            ),
          // Every pool-managed booking gets a brand-new login — never a
          // cached/reused session — per explicit product direction after a
          // real "Invalid password" failure traced back to session reuse
          // across queued jobs on the same account.
          true
        )
      );
    })().catch((err) => {
      // A failed init must not wedge every future booking behind a
      // permanently-rejected promise — clear it so the next submission
      // retries from scratch (e.g. credentials get fixed in the meantime).
      airlinePoolPromises.delete(airline);
      throw err;
    });
    airlinePoolPromises.set(airline, poolPromise);
  }
  return poolPromise;
}

// Job-based Book-on-Hold. Unlike the old fire-and-forget version, the
// outcome (PNR, screenshot, or a categorized error) is now written back to
// the BookingJob row so any client — the chat today — can poll for it. The
// row is created by the caller (Next.js) with all request fields; we only
// receive its id, load it, run the multi-minute automation, and update it.
//
// Credentials are decrypted here, immediately before use, and never logged
// or included in a response — same rule CredentialService documents for
// SyncService. We still respond 202 immediately because the automation far
// outlasts any reasonable HTTP hold; progress lives in the row, not the
// connection.
app.post("/internal/travel-assistant/book-hold", async (req, res) => {
  const jobId = req.body?.jobId;
  if (!jobId || typeof jobId !== "string") {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = await BookingJobRepository.findById(jobId);
  if (!job) {
    res.status(404).json({ error: `No booking job ${jobId}` });
    return;
  }
  if (job.status !== "PENDING") {
    // Already picked up (or terminal) — never run the same hold twice.
    res.status(409).json({ error: `Job ${jobId} is ${job.status}, not PENDING`, status: job.status });
    return;
  }

  const airline = job.airline;
  const handler = BOOK_ON_HOLD_HANDLERS[airline];
  if (!handler) {
    await BookingJobRepository.markFailed(jobId, "UNKNOWN", `"${airline}" has no book-on-hold automation implemented`, 0);
    res.status(404).json({ error: `"${airline}" has no book-on-hold automation implemented` });
    return;
  }

  const fareClassPreference = FARE_CLASS_PREFERENCE[airline];
  if (!fareClassPreference) {
    const message = `"${airline}" has no verified fare classband names configured — refusing to guess and risk selecting the wrong fare`;
    await BookingJobRepository.markFailed(jobId, "UNKNOWN", message, 0);
    res.status(422).json({ error: message });
    return;
  }

  // Prefer user's personal credentials if available, fall back to admin credentials
  let credentials: { username: string; password: string } | null = null;
  let credentialSource = "admin";

  if (job.userId) {
    try {
      const userCred = await UserCredentialRepository.findByUserAndAirline(job.userId, airline);
      if (userCred?.encryptedUsername && userCred.encryptedPassword) {
        credentials = {
          username: decryptSecret(userCred.encryptedUsername),
          password: decryptSecret(userCred.encryptedPassword),
        };
        credentialSource = "user";
      }
    } catch (err) {
      console.warn(`[book-hold] could not load user credentials for ${job.userId}/${airline}:`, err);
    }
  }

  // A personal (per-user) login is its own dedicated account — it never
  // contends with the shared admin pool, so it runs immediately, same as
  // before this feature (originally Enugu-only; now every bookable
  // airline). Only the admin-credential fallback case is a genuinely
  // SHARED resource that needs the worker pool/queue.
  if (credentialSource === "admin") {
    let pool: AirlineWorkerPool;
    try {
      pool = await getAirlinePool(airline, handler, fareClassPreference);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await BookingJobRepository.markFailed(jobId, "LOGIN_FAILED", message, 0);
      res.status(502).json({ error: message });
      return;
    }
    // The user's saved /settings choice for this airline, if any — absent
    // for a job with no sessionKey (e.g. triggered outside chat) or one
    // that never ran /settings, in which case the pool applies its own
    // default (any free account for ENUGU, the first configured account
    // for every other airline — see AirlineWorkerPool.submit).
    const preferredAccountLabel = job.sessionKey
      ? await UserAirlineAccountPreferenceRepository.get(job.sessionKey, airline)
      : null;
    const position = await pool.submit(job, preferredAccountLabel);
    console.log(
      `[book-hold] job=${jobId} ${airline} ${job.origin}->${job.destination} ${job.departureDate} — ${
        position === 0 ? "started immediately" : `queued at position ${position} (${pool.accountCount} account(s) configured)`
      }${preferredAccountLabel ? ` [preferred account: ${preferredAccountLabel}]` : ""}`
    );
    res.status(202).json({ accepted: true, jobId, airline, queuePosition: position });
    return;
  }

  // Fall back to admin/connector credentials if user credentials unavailable
  if (!credentials) {
    const settings = await AirlineWalletRepository.getSettings(airline);
    if (!settings?.encryptedUsername || !settings.encryptedPassword) {
      await BookingJobRepository.markFailed(jobId, "LOGIN_FAILED", `No credentials configured for ${airline}`, 0);
      res.status(502).json({ error: `No credentials configured for ${airline}` });
      return;
    }
    credentials = {
      username: decryptSecret(settings.encryptedUsername),
      password: decryptSecret(settings.encryptedPassword),
    };
  }

  console.log(
    `[book-hold] starting job=${jobId} ${airline} ${job.origin}->${job.destination} ${job.departureDate}${job.returnDate ? ` / return ${job.returnDate}` : ""} [using ${credentialSource} credentials]`
  );
  res.status(202).json({ accepted: true, jobId, airline });
  await executeBookingAutomation(job, handler, credentials, fareClassPreference);
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[connector-service] listening on :${PORT}`);
  startScheduler();
});
