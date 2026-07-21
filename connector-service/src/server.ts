import "dotenv/config";
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
import { bookEnuguAirOnHold } from "../../src/modules/travel-assistant/booking/enugu/EnuguBookOnHold";
import { BookingJobRepository } from "../../src/modules/travel-assistant/storage/BookingJobRepository";
import { categorizeBookingError } from "../../src/modules/travel-assistant/booking/categorizeBookingError";
import { decryptSecret } from "../../src/modules/airline-connectors/services/CredentialService";
import type { FlightSearchQuery, FlightSearchResult } from "../../src/modules/travel-assistant/core/types";

const TRAVEL_ASSISTANT_SEARCHERS: Record<string, (query: FlightSearchQuery) => Promise<FlightSearchResult>> = {
  ENUGU: searchEnuguAirFlights,
  UNITED: searchUnitedNigeriaFlights,
  XEJET: searchXeJetFlights,
  RANO: searchRanoAirFlights,
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

app.get("/internal/health", (_req, res) => res.json({ ok: true, build: "travel-assistant-v1" }));

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

const BOOK_ON_HOLD_HANDLERS: Record<string, typeof bookEnuguAirOnHold> = {
  ENUGU: bookEnuguAirOnHold,
};

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

  const settings = await AirlineWalletRepository.getSettings(airline);
  if (!settings?.encryptedUsername || !settings.encryptedPassword) {
    await BookingJobRepository.markFailed(jobId, "LOGIN_FAILED", `No credentials configured for ${airline}`, 0);
    res.status(502).json({ error: `No credentials configured for ${airline}` });
    return;
  }
  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  console.log(
    `[book-hold] starting job=${jobId} ${airline} ${job.origin}->${job.destination} ${job.departureDate}${job.returnDate ? ` / return ${job.returnDate}` : ""}`
  );
  await BookingJobRepository.markRunning(jobId);
  const startedAt = Date.now();
  res.status(202).json({ accepted: true, jobId, airline });

  handler(credentials, {
    origin: job.origin,
    destination: job.destination,
    departureDate: job.departureDate,
    returnDate: job.returnDate ?? undefined,
    // Not stored on the job — same two bands the old endpoint defaulted to;
    // the automation picks whichever is cheaper per leg.
    fareClassPreference: ["Economy Promo", "Economy Saver"],
    passenger: {
      title: job.title,
      firstName: job.firstName,
      lastName: job.lastName,
      mobileNumber: job.phone ?? "",
      email: job.email ?? "",
    },
  })
    .then(async (result) => {
      const durationMs = Date.now() - startedAt;
      // A confirmation page with no parseable PNR is a soft failure — the
      // hold may not have gone through — so treat a null PNR as FAILED rather
      // than reporting a success the staff can't act on.
      if (!result.pnr) {
        console.error(`[book-hold] job=${jobId} finished with no PNR after ${durationMs}ms`);
        await BookingJobRepository.markFailed(jobId, "UNKNOWN", "Completed the flow but no PNR was found on the confirmation page", durationMs);
        return;
      }
      console.log(`[book-hold] job=${jobId} SUCCESS pnr=${result.pnr} in ${durationMs}ms`);
      await BookingJobRepository.markSuccess(jobId, {
        pnr: result.pnr,
        holdExpiresAt: result.holdExpiresAt,
        totalPayable: result.totalPayable,
        currency: result.currency,
        screenshot: result.screenshot,
        durationMs,
      });
    })
    .catch(async (err) => {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[book-hold] job=${jobId} FAILED after ${durationMs}ms:`, message);
      await BookingJobRepository.markFailed(jobId, categorizeBookingError(message), message, durationMs).catch((e) => {
        console.error(`[book-hold] job=${jobId} could not record failure:`, e);
      });
    });
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[connector-service] listening on :${PORT}`);
  startScheduler();
});
