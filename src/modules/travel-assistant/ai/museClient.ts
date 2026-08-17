import { groqJsonCompletion, groqVisionJsonCompletion, type GroqMessage } from "./groqClient";

const MUSE_URL = "https://api.meta.ai/v1/chat/completions";

// ADDED (2026-08-16): new primary path — Meta's Model API (dev.meta.ai) is
// OpenAI-compatible, same request/response shape as Groq, just a
// different base URL, auth env var, and model name — so this mirrors
// groqClient.ts's exact exported shape (a JSON-mode text completion + a
// JSON-mode vision completion, each with model failover on a 429/404)
// rather than introducing a different contract every caller would need to
// adapt to.
//
// TRIAL-PERIOD FALLBACK (2026-08-16, per product direction): Muse is brand
// new to this app and not yet confirmed reliable in production — rather
// than betting every image-parsing and conversational path on an
// unproven integration, every function here tries Muse first and, on ANY
// failure (not just 429/404 — an auth misconfiguration or a totally new
// failure mode we haven't seen yet should also fail over, since the whole
// point of keeping Groq around right now is not trusting Muse blindly
// yet), falls back to Groq (see groqClient.ts, restored for exactly this).
// Once Muse is confirmed solid over real usage, the fallback branch below
// (and groqClient.ts itself) can come out.
//
// muse-spark-1.2 is Meta's current default model and is natively
// multimodal (text, image, video, audio, PDF) — unlike Groq, which needed
// a completely separate model list for vision vs text calls, one model
// covers both here. muse-spark-1.1 is kept as a same-family fallback in
// case 1.2 is ever rate-limited or pulled without notice, same defensive
// reasoning as groqClient.ts's own model-failover list — this is tried
// BEFORE ever falling all the way back to Groq.
const MODELS = ["muse-spark-1.2", "muse-spark-1.1"];

export class MuseNotConfiguredError extends Error {
  constructor() {
    super("MUSE_API_KEY is not set");
    this.name = "MuseNotConfiguredError";
  }
}

export interface MuseMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Tries every Muse model (failing over on 429/404, same as groqClient.ts).
// Returns the raw completion text, or throws the last Muse error if every
// Muse model failed — the caller (museVisionJsonCompletion) decides
// whether to fall back to Groq from there.
async function tryMuseVision(prompt: string, imageDataUrls: string[]): Promise<string> {
  const apiKey = process.env.MUSE_API_KEY;
  if (!apiKey) throw new MuseNotConfiguredError();

  const content = [
    { type: "text", text: prompt },
    ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  let lastError: Error | null = null;

  for (const model of MODELS) {
    const res = await fetch(MUSE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Muse vision response missing message content");
      return text;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`Muse vision request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);
    if (res.status !== 429 && res.status !== 404) throw lastError;
    console.warn(`[muse] vision model ${model} unavailable (HTTP ${res.status}), trying next model`, lastError.message);
  }

  throw lastError ?? new Error("Muse vision request failed: no models available");
}

async function tryMuseText(messages: MuseMessage[]): Promise<string> {
  const apiKey = process.env.MUSE_API_KEY;
  if (!apiKey) throw new MuseNotConfiguredError();

  let lastError: Error | null = null;

  for (const model of MODELS) {
    const res = await fetch(MUSE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Muse response missing message content");
      return content;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`Muse request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);
    if (res.status !== 429 && res.status !== 404) throw lastError;
    console.warn(`[muse] ${model} unavailable (HTTP ${res.status}), trying next model`, lastError.message);
  }

  throw lastError ?? new Error("Muse request failed: no models available");
}

// Extracts structured JSON from one or more images. Each image is a data
// URL (e.g. "data:image/png;base64,...."). Muse first, Groq on any Muse
// failure — see the trial-period-fallback comment above.
export async function museVisionJsonCompletion(prompt: string, imageDataUrls: string[]): Promise<string> {
  try {
    return await tryMuseVision(prompt, imageDataUrls);
  } catch (museErr) {
    console.warn("[muse] vision failed, falling back to Groq:", museErr instanceof Error ? museErr.message : museErr);
    try {
      return await groqVisionJsonCompletion(prompt, imageDataUrls);
    } catch (groqErr) {
      // Both providers failed — surface a combined error so logs/alerts
      // show the real reason from each, not just whichever happened last.
      const museMsg = museErr instanceof Error ? museErr.message : String(museErr);
      const groqMsg = groqErr instanceof Error ? groqErr.message : String(groqErr);
      throw new Error(`Both Muse and Groq vision requests failed. Muse: ${museMsg} | Groq: ${groqMsg}`);
    }
  }
}

export async function museJsonCompletion(messages: MuseMessage[]): Promise<string> {
  try {
    return await tryMuseText(messages);
  } catch (museErr) {
    console.warn("[muse] text completion failed, falling back to Groq:", museErr instanceof Error ? museErr.message : museErr);
    try {
      // MuseMessage and GroqMessage are structurally identical — no
      // conversion needed, just a type name difference between the two
      // client modules.
      return await groqJsonCompletion(messages as GroqMessage[]);
    } catch (groqErr) {
      const museMsg = museErr instanceof Error ? museErr.message : String(museErr);
      const groqMsg = groqErr instanceof Error ? groqErr.message : String(groqErr);
      throw new Error(`Both Muse and Groq requests failed. Muse: ${museMsg} | Groq: ${groqMsg}`);
    }
  }
}
