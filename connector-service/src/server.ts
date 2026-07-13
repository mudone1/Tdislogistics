import "dotenv/config";
import express from "express";
import { requireInternalApiKey } from "./auth";
import { startScheduler } from "./scheduler";
import { runSync, testConnection } from "../../src/modules/airline-connectors/services/SyncService";
import { AirlineWalletRepository } from "../../src/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "../../src/modules/airline-connectors/services/ConnectorRegistry";
import type { AirlineKey } from "../../src/modules/airline-connectors/core/types";

const app = express();
app.use(express.json());

// Health check must NOT require the internal API key — Railway/Render/Fly
// etc. hit this with their own health-check probe, which doesn't (and
// shouldn't) know the shared secret.
app.get("/internal/health", (_req, res) => res.json({ ok: true }));

app.use(requireInternalApiKey);

function assertKnownAirline(airline: string, res: express.Response): airline is AirlineKey {
  if (!ConnectorRegistry.isImplemented(airline)) {
    res.status(404).json({
      error: `"${airline}" is not an implemented connector (Category B airlines aren't built yet — see connectors/README.md)`,
    });
    return false;
  }
  return true;
}

// POST /internal/connectors/:airline/sync
app.post("/internal/connectors/:airline/sync", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const trigger = req.body?.trigger === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
  console.log(`[sync] starting ${trigger} sync for ${airline}`);
  try {
    const result = await runSync(airline, trigger);
    console.log(`[sync] result for ${airline}:`, JSON.stringify(result));
    const statusCode = result.status === "SUCCESS" ? 200 : 502;
    res.status(statusCode).json(result);
  } catch (err) {
    console.error(`[sync] uncaught error for ${airline}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /internal/connectors/:airline/test
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

// GET /internal/connectors/:airline/status
app.get("/internal/connectors/:airline/status", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const [wallet, settings] = await Promise.all([
    AirlineWalletRepository.getWallet(airline),
    AirlineWalletRepository.getSettings(airline),
  ]);
  res.json({ wallet, settings });
});

// GET /internal/connectors/:airline/history
app.get("/internal/connectors/:airline/history", async (req, res) => {
  const airline = req.params.airline.toUpperCase();
  if (!assertKnownAirline(airline, res)) return;

  const limit = Math.min(200, Number(req.query.limit) || 50);
  const history = await AirlineWalletRepository.getHistory(airline, limit);
  res.json({ history });
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[connector-service] listening on :${PORT}`);
  startScheduler();
});
