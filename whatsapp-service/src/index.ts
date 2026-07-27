import "dotenv/config";
import express from "express";
import QRCode from "qrcode";
import { PORT } from "./config";
import { connectWhatsApp, getQRState } from "./whatsapp";

const app = express();

app.get("/internal/health", (_req, res) => res.json({ ok: true }));

// A real scannable QR image over HTTP — ASCII art in a web-based log
// viewer (rather than a real terminal) distorts under line-wrapping and
// font aspect ratio and becomes unscannable. Auto-refreshes every 3s
// until paired, then shows a plain "connected" message.
app.get("/qr", async (_req, res) => {
  const { qr, status } = getQRState();

  if (status === "open") {
    res.send(`<!doctype html><html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
      <h2>✅ Connected</h2>
      <p>This WhatsApp session is already paired — nothing to scan.</p>
    </body></html>`);
    return;
  }

  if (!qr) {
    res.send(`<!doctype html><html><head><meta http-equiv="refresh" content="2"></head><body style="font-family: sans-serif; text-align: center; padding: 40px;">
      <p>Waiting for a QR code to be generated…</p>
    </body></html>`);
    return;
  }

  const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
  res.send(`<!doctype html><html><head><meta http-equiv="refresh" content="20"></head><body style="font-family: sans-serif; text-align: center; padding: 40px;">
    <h2>Scan with WhatsApp</h2>
    <p>Settings → Linked Devices → Link a Device</p>
    <img src="${dataUrl}" alt="WhatsApp QR code" style="border: 1px solid #ccc; padding: 16px;" />
    <p style="color: #666; font-size: 13px;">This page refreshes automatically — a new code replaces this one if it expires before you scan it.</p>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`[whatsapp-service] health check listening on :${PORT}`);
});

connectWhatsApp().catch((err) => {
  console.error("[whatsapp-service] failed to start WhatsApp connection:", err);
  process.exit(1);
});
