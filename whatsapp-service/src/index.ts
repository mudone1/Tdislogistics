import "dotenv/config";
import express from "express";
import { PORT } from "./config";
import { connectWhatsApp } from "./whatsapp";

const app = express();

app.get("/internal/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[whatsapp-service] health check listening on :${PORT}`);
});

connectWhatsApp().catch((err) => {
  console.error("[whatsapp-service] failed to start WhatsApp connection:", err);
  process.exit(1);
});
