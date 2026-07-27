import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import P from "pino";
import { handleIncomingMessage, type IncomingMessage, type OutgoingMessage } from "./messageHandler";

const AUTH_DIR = "auth_info"; // persisted WhatsApp session credentials — see README for why this must survive restarts

// Wraps Baileys (an unofficial WhatsApp Web protocol client — see the
// service README for why this is used instead of Meta's official Cloud
// API, which doesn't support a bot participating in group chats).
// Reconnects automatically on any disconnect except an explicit logout
// (scanning a new QR code is only needed after a real logout).
export async function connectWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }) as never, // Baileys' logger type is a structural subset of pino's; silent is all we need
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code with WhatsApp (Settings -> Linked Devices -> Link a Device):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[whatsapp] connection closed (statusCode=${statusCode}) — ${loggedOut ? "logged out, not reconnecting" : "reconnecting"}`);
      if (!loggedOut) {
        connectWhatsApp().catch((err) => console.error("[whatsapp] reconnect failed:", err));
      }
    } else if (connection === "open") {
      console.log("[whatsapp] connected");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue; // ignore the bot's own messages, avoids reply loops
      const chatId = m.key.remoteJid;
      if (!chatId) continue;

      const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
      if (!text.trim()) continue; // non-text message (image, audio, etc.) — not handled yet

      const incoming: IncomingMessage = {
        chatId,
        isGroup: chatId.endsWith("@g.us"),
        senderName: m.pushName ?? null,
        text,
      };

      await handleIncomingMessage(incoming, async (out: OutgoingMessage) => {
        await sock.sendMessage(out.chatId, { text: out.text });
      }).catch((err) => console.error(`[whatsapp] handling message from ${chatId} failed:`, err));
    }
  });
}
