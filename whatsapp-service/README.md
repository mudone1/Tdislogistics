# TDIS WhatsApp Bot Service

Connects a WhatsApp number to the existing TDIS AI assistant (the same
`ConversationOrchestrator` the browser chat bubble uses), so staff can book
flights, run searches, or ask sales questions directly from WhatsApp — in a
group by mentioning `@tdisbot`, or in a 1:1 chat with no mention needed.

## Important: this uses an unofficial WhatsApp client, not Meta's Business API

This service is built on [Baileys](https://github.com/WhiskeySockets/Baileys),
which reverse-engineers the WhatsApp Web protocol. It was chosen deliberately
over Meta's official WhatsApp Cloud API because the official API does not
support a bot that sits in a group chat and responds when mentioned — it's
built around 1:1 business-customer conversations.

**Tradeoff:** using Baileys is against WhatsApp's Terms of Service. The
number connected this way carries a real (if generally low in practice) risk
of being banned. Use a number you're comfortable with being at risk —
**not** a number that's load-bearing for anything else. If that risk isn't
acceptable, the alternative is a 1:1-only bot on the official Cloud API,
which drops the group/`@mention` behavior entirely.

## How it works

1. This service holds a persistent WebSocket connection to WhatsApp
   (`src/whatsapp.ts`) — that's why it's a separate always-on process rather
   than part of the serverless Next.js app, the same reason
   `connector-service` is separate for Playwright.
2. Every incoming message is checked (`src/messageHandler.ts`): a group
   message is ignored unless it contains `@tdisbot` (configurable via
   `BOT_MENTION_TRIGGER`); a direct 1:1 message always gets a response.
3. The (trigger-stripped) message is forwarded to the main app's existing
   `POST /api/assistant/quote` — the same endpoint the browser chat bubble
   calls — using a session key derived from the WhatsApp chat
   (`whatsapp:<chatId>`), so conversation memory (slots, prior turns) is
   scoped per WhatsApp chat automatically via the existing
   `ChatMemoryRepository`.
4. If that call starts a Book-on-Hold, this service polls
   `GET /api/assistant/book-hold/[id]` itself (`src/bookingPoll.ts`, mirrors
   `ChatBubble.tsx`'s own poll loop) and sends a follow-up WhatsApp message
   with the PNR once it's ready — since there's no browser tab to do that
   polling for a WhatsApp chat.

This service holds no database connection and does no persistence of its
own; all state lives in the main app.

## Setup

```bash
cd whatsapp-service
npm install
cp .env.example .env
# edit .env — set MAIN_APP_URL to wherever the main app is reachable
npm run dev
```

On first run, a QR code prints to the terminal. Scan it from the WhatsApp
account you want to use as the bot:

**WhatsApp app → Settings → Linked Devices → Link a Device**

Once paired, the session is saved to `auth_info/` (gitignored — this
directory contains live session credentials; treat it like a secret) and
persists across restarts. You only need to re-scan if that directory is
deleted or the account is explicitly logged out from the phone.

## Adding the bot to a group

Add the WhatsApp number you paired above to the group as a normal
participant, the same way you'd add any contact. No further setup is
needed — it'll respond to any message in that group containing
`@tdisbot`.

## Deployment

Deploy this alongside (but as a separate process/container from)
`connector-service` — anywhere that can run a long-lived Node process and
persist the `auth_info/` directory across restarts (a Docker volume, or a
VPS with a real filesystem). It does not need inbound network access
beyond its own health check; it only makes outbound connections to
WhatsApp's servers and to `MAIN_APP_URL`.
