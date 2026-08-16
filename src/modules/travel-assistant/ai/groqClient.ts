const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// KEPT AS FALLBACK (2026-08-16): the primary path moved to Meta's Model
// API (see museClient.ts, which now wraps this file) while that migration
// gets proven out in production. Per product direction: don't remove Groq
// yet — if Muse has a rough day (auth hiccup, an outage, a surprise quota
// on a brand-new account), every image-parsing and conversational path in
// this app should still work by quietly falling back here, rather than
// betting the whole app on an integration that's still being validated.
// This file is intentionally no longer imported directly by any consumer
// — museClient.ts is the only caller now. Once Muse is confirmed solid,
// this whole file (and the fallback branch in museClient.ts) can come out.
//
// RESTORED (2026-08-10): this file existed before, was deleted in
// 9d85d9e "Switch AI travel assistant from Groq to OpenAI (gpt-4o-mini)",
// and is now back because the OpenAI account's $5 credit ran out —
// confirmed live: every request silently fell back to the old
// deterministic regex parser (see /api/assistant/quote/route.ts), which
// can only ever run a plain flight search and has no concept of
// Book-on-Hold at all. That's what made EVERY booking request across
// EVERY airline turn into a quote no matter what got fixed upstream.
//
// Groq's free tier enforces a separate tokens-per-day cap PER MODEL, not
// account-wide. When our primary model's daily cap is exhausted (confirmed
// in production: llama-3.3-70b-versatile hit "Rate limit reached ... on
// tokens per day (TPD): Limit 100000" mid-day), every call 429s and the
// caller falls back to the much dumber deterministic regex parser for the
// rest of the day. Retrying the SAME model does nothing for a daily cap, so
// on a 429 we fail over to a smaller model with its own separate quota —
// degraded quality is far better than losing conversational ability
// entirely until the cap resets. Unlike the OpenAI $5 exhaustion this
// module replaces, this cap resets every day automatically — no billing
// action required, just degraded quality until midnight (UTC) if it's hit.
//
// CORRECTED (2026-08-15): llama-3.1-8b-instant is Groq's own scheduled
// shutdown for 2026-08-16 (announced 2026-06-17, per
// console.groq.com/docs/deprecations) — literally the next day at the time
// of this fix. Swapped for their own recommended replacement,
// openai/gpt-oss-20b, before it actually goes dark and silently breaks
// this exact fallback path the same way the vision models just did (see
// VISION_MODELS below).
const MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"];

export class GroqNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set");
    this.name = "GroqNotConfiguredError";
  }
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Groq's vision-capable models — kept separate from MODELS above because
// the text-only models there can't see images; a vision request has to
// fail over to another *vision* model, not a text one.
//
// CORRECTED (2026-08-15, live): both models this array previously held —
// meta-llama/llama-4-scout-17b-16e-instruct and
// meta-llama/llama-4-maverick-17b-128e-instruct — are gone from Groq's
// current lineup (Scout: shut down 2026-07-17 per
// console.groq.com/docs/deprecations, confirmed live via a real "HTTP 404
// model_not_found" on a WhatsApp ID-card upload; Maverick: not listed on
// console.groq.com/docs/vision's current model set either). Every vision
// call was failing outright. qwen/qwen3.6-27b is the only model
// console.groq.com/docs/vision currently documents as multimodal — no
// second vision model exists to list as a fallback right now.
const VISION_MODELS = ["qwen/qwen3.6-27b"];

// Extracts structured JSON from one or more images. Each image is a data
// URL (e.g. "data:image/png;base64,...."). Same JSON-mode + per-model
// 429 failover contract as groqJsonCompletion, but over vision models.
export async function groqVisionJsonCompletion(prompt: string, imageDataUrls: string[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new GroqNotConfiguredError();

  const content = [
    { type: "text", text: prompt },
    ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  let lastError: Error | null = null;

  for (const model of VISION_MODELS) {
    const res = await fetch(GROQ_URL, {
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
      if (typeof text !== "string") throw new Error("Groq vision response missing message content");
      return text;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`Groq vision request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);
    // Fail over on a rate/quota limit (429) OR a model that's been
    // deprecated/removed out from under us (404 model_not_found — live-
    // confirmed 2026-08-15: Groq shut down llama-4-scout with zero warning
    // to this codebase, and the old "only 429 fails over" logic let that
    // 404 propagate immediately instead of ever trying the next model).
    // Any other error (bad request, auth, server error) fails identically
    // on every model, so retrying would just waste time.
    if (res.status !== 429 && res.status !== 404) throw lastError;
    console.warn(`[groq] vision model ${model} unavailable (HTTP ${res.status}), trying next model`, lastError.message);
  }

  throw lastError ?? new Error("Groq vision request failed: no models available");
}

export async function groqJsonCompletion(messages: GroqMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new GroqNotConfiguredError();

  let lastError: Error | null = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const res = await fetch(GROQ_URL, {
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
      if (typeof content !== "string") throw new Error("Groq response missing message content");
      return content;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`Groq request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);

    // Fail over on a rate/quota limit (429) OR a model that's been
    // deprecated/removed out from under us (404 model_not_found — same
    // real failure class hit live on the vision models, see
    // VISION_MODELS' comment above). Any other error (bad request, auth,
    // server error) fails identically on every model, so retrying would
    // just waste time.
    if (res.status !== 429 && res.status !== 404) throw lastError;
    console.warn(`[groq] ${model} unavailable (HTTP ${res.status}), trying next model`, lastError.message);
  }

  throw lastError ?? new Error("Groq request failed: no models available");
}
