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
import { bookEnuguAirOnHold, type BookOnHoldRequest } from "../../src/modules/travel-assistant/booking/enugu/EnuguBookOnHold";
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

// Credentials are decrypted here, immediately before use, and never
// logged or included in the response — same rule CredentialService
// documents for SyncService. The caller (Next.js) never sees the
// plaintext or the encrypted value; it only ever asks this service to
// act, exactly like /internal/connectors/:airline/sync already does.
app.post("/internal/travel-assistant/book-hold", async (req, res) => {
  const airline = (req.body?.airline || "ENUGU").toUpperCase();
  const handler = BOOK_ON_HOLD_HANDLERS[airline];
  if (!handler) {
    res.status(404).json({ error: `"${airline}" has no book-on-hold automation implemented` });
    return;
  }

  const { origin, destination, departureDate, returnDate, fareClassPreference, passenger } = req.body || {};
  if (!origin || !destination || !departureDate || !passenger?.firstName || !passenger?.lastName) {
    res.status(400).json({ error: "origin, destination, departureDate, and passenger.firstName/lastName are required" });
    return;
  }

  const settings = await AirlineWalletRepository.getSettings(airline);
  if (!settings?.encryptedUsername || !settings.encryptedPassword) {
    res.status(502).json({ error: `No credentials configured for ${airline}` });
    return;
  }
  const credentials = {
    username: decryptSecret(settings.encryptedUsername),
    password: decryptSecret(settings.encryptedPassword),
  };

  console.log(`[book-hold] starting ${airline} ${origin}->${destination} ${departureDate}${returnDate ? ` / return ${returnDate}` : ""}`);

  // Fire-and-forget, same reasoning as /internal/connectors/:airline/sync:
  // login + search + fare selection + passenger form + submission is a
  // multi-minute Playwright flow, well past what most HTTP clients/proxies
  // hold a connection open for. Respond immediately and log the outcome
  // instead of making the caller hold a long-lived connection.
  res.status(202).json({ accepted: true, airline });

  handler(credentials, {
    origin,
    destination,
    departureDate,
    returnDate,
    fareClassPreference: fareClassPreference ?? ["Economy Promo", "Economy Saver"],
    passenger,
  })
    .then((result) => {
      console.log(`[book-hold] ${airline} result: ${JSON.stringify(result)}`);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[book-hold] ${airline} FAILED:`, message);
    });
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[connector-service] listening on :${PORT}`);
  startScheduler();
});
