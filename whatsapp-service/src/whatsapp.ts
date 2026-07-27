import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import P from "pino";
import { handleIncomingMessage, type IncomingMessage } from "./messageHandler";

// Persisted WhatsApp session credentials — see README for why this must
// survive restarts. Configurable so a Railway (or similar) deployment can
// point it at a mounted volume instead of the container's ephemeral
// filesystem, which gets wiped on every redeploy.
const AUTH_DIR = process.env.AUTH_DIR || "auth_info";

// The latest pending QR string, if any — read by the /qr HTTP route (see
// index.ts) so it can be rendered as a real scannable image. ASCII-art QR
// codes in a web-based log viewer (rather than a real terminal) often
// distort under line-wrapping/font-aspect-ratio and become unscannable,
// which is exactly what happened trying to pair this on Railway.
let latestQR: string | null = null;
let connectionStatus: "connecting" | "open" | "closed" = "connecting";

export function getQRState(): { qr: string | null; status: typeof connectionStatus } {
  return { qr: latestQR, status: connectionStatus };
}

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
      latestQR = qr;
      connectionStatus = "connecting";
      console.log("\nScan this QR code with WhatsApp (Settings -> Linked Devices -> Link a Device):\n");
      console.log("Or, more reliably, open this service's /qr HTTP endpoint in a browser.\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      connectionStatus = "closed";
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[whatsapp] connection closed (statusCode=${statusCode}) — ${loggedOut ? "logged out, not reconnecting" : "reconnecting"}`);
      if (!loggedOut) {
        connectWhatsApp().catch((err) => console.error("[whatsapp] reconnect failed:", err));
      }
    } else if (connection === "open") {
      latestQR = null;
      connectionStatus = "open";
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

      await handleIncomingMessage(incoming, {
        sendText: async (targetChatId, text) => {
          await sock.sendMessage(targetChatId, { text });
        },
        sendImage: async (targetChatId, buffer, caption) => {
          await sock.sendMessage(targetChatId, { image: buffer, caption });
        },
        // WhatsApp's "typing…" indicator — makes a multi-second (or
        // multi-minute, for a Book-on-Hold/balance sync) wait feel like
        // the bot is actually working rather than just gone silent. The
        // indicator times out client-side after a while, so callers doing
        // long operations re-send this periodically rather than once.
        setTyping: async (targetChatId) => {
          await sock.sendPresenceUpdate("composing", targetChatId).catch(() => {});
        },
      }).catch((err) => console.error(`[whatsapp] handling message from ${chatId} failed:`, err));
    }
  });
}
