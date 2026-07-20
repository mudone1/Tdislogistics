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
import type { FlightSearchQuery, FlightSearchResult } from "../../src/modules/travel-assistant/core/types";

const TRAVEL_ASSISTANT_SEARCHERS: Record<string, (query: FlightSearchQuery) => Promise<FlightSearchResult>> = {
  ENUGU: searchEnuguAirFlights,
  UNITED: searchUnitedNigeriaFlights,
};

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
    res.status(400).json({ error: "origin, destination, and date are all required" });
    return;
  }

  const airlineKey = (airline || "ENUGU").toUpperCase();
  const search = TRAVEL_ASSISTANT_SEARCHERS[airlineKey];
  if (!search) {
    res.status(404).json({ error: `"${airlineKey}" has no travel-assistant search implemented` });
    return;
  }

  try {
    const result = await search({ origin, destination, date });
    res.json(result);
  } catch (err) {
    console.error(`[travel-assistant] search failed for ${airlineKey}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[connector-service] listening on :${PORT}`);
  startScheduler();
});
