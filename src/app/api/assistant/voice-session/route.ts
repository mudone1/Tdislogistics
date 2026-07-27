import { NextResponse } from "next/server";
import crypto from "crypto";
import { VOICE_SYSTEM_PROMPT } from "@/modules/travel-assistant/ai/voiceSystemPrompt";
import { STAFF_KNOWLEDGE } from "@/modules/travel-assistant/ai/staffProfiles";
import { ROUTE_TO_TRAVEL_ASSISTANT_TOOL } from "@/modules/travel-assistant/ai/voiceTool";

// Mints a short-lived OpenAI Realtime API client secret so the browser can
// open a WebRTC voice session without ever seeing OPENAI_API_KEY — same
// "server holds the real secret, client gets a scoped credential" shape as
// every other secret in this app (see CredentialService.ts, connectorServiceClient.ts).
const REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// Cheapest realtime-capable model as of this writing — confirm the current
// name and per-token audio pricing at platform.openai.com/docs/pricing
// before assuming this is still accurate; OpenAI has renamed this line at
// least once already.
const REALTIME_MODEL = "gpt-realtime-2.1";
const REALTIME_VOICE = "marin";

// Keep spoken replies short — both for the "voice mode" UX (nobody wants a
// paragraph read aloud) and because this directly bounds worst-case
// output-token cost per turn.
const MAX_RESPONSE_OUTPUT_TOKENS = 300;

// In-memory, per-instance, resets on cold start — deliberately not a
// distributed/DB-backed limiter. This is an internal staff tool, not a
// public one, and the real cost control is the client-enforced per-session
// duration cap; this daily count exists only to catch a runaway/looping
// client, not to defend against abuse.
const DAILY_MINT_CAP = 150;
let mintCountDay = "";
let mintCount = 0;

function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== mintCountDay) {
    mintCountDay = today;
    mintCount = 0;
  }
  if (mintCount >= DAILY_MINT_CAP) return false;
  mintCount++;
  return true;
}

// OpenAI's OpenAI-Safety-Identifier header wants a hashed, non-reversible
// identifier — never send the raw sessionKey (which for logged-in users is
// `fb:${firebaseUid}`, real user PII) off to a third party.
function hashSessionKey(sessionKey: string): string {
  return crypto.createHash("sha256").update(sessionKey).digest("hex").slice(0, 32);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionKey?: string };
  const sessionKey = body.sessionKey;
  if (!sessionKey || typeof sessionKey !== "string") {
    return NextResponse.json({ error: "sessionKey is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice mode isn't configured yet — ask an admin to set OPENAI_API_KEY." },
      { status: 503 }
    );
  }

  if (!underDailyCap()) {
    return NextResponse.json(
      { error: "Voice mode has hit today's usage cap — try again tomorrow, or use text chat instead." },
      { status: 429 }
    );
  }

  try {
    const res = await fetch(REALTIME_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "openai-safety-identifier": hashSessionKey(sessionKey),
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: `${VOICE_SYSTEM_PROMPT}\n\n${STAFF_KNOWLEDGE}`,
          // input.transcription turns on text transcripts of the user's own
          // speech (surfaced client-side as conversation.item events) so the
          // UI can echo what was heard, same as a typed message would show —
          // field nesting confirmed for audio.output.voice directly from
          // OpenAI's docs; audio.input.transcription is inferred by analogy
          // and not independently doc-confirmed, so verify live and adjust
          // if the transcript events don't show up.
          audio: {
            input: { transcription: { model: "whisper-1" } },
            output: { voice: REALTIME_VOICE },
          },
          tools: [ROUTE_TO_TRAVEL_ASSISTANT_TOOL],
          tool_choice: "auto",
          max_response_output_tokens: MAX_RESPONSE_OUTPUT_TOKENS,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[voice-session] mint failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
      return NextResponse.json(
        { error: "Couldn't start a voice session just now — try again in a moment." },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { value?: string };
    if (!data.value) {
      console.error("[voice-session] mint response missing 'value' field:", JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: "Voice session setup failed — try again." }, { status: 502 });
    }

    return NextResponse.json({ clientSecret: data.value, model: REALTIME_MODEL });
  } catch (err) {
    console.error("[voice-session] request threw:", err);
    return NextResponse.json({ error: "Couldn't reach the voice service — try again in a moment." }, { status: 502 });
  }
}
