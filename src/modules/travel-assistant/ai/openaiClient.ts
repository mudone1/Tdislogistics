const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-4o-mini is fast/cheap and handles structured JSON extraction well —
// the same role llama-3.3-70b-versatile played on Groq. gpt-4o is the
// fallback on a 429 (rate limit), same failover shape the Groq client used.
const MODELS = ["gpt-4o-mini", "gpt-4o"];

export class OpenAINotConfiguredError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not set");
    this.name = "OpenAINotConfiguredError";
  }
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Both gpt-4o and gpt-4o-mini are vision-capable, so the same two models
// double as the vision fallback pair — mirrors the Groq client's separate
// VISION_MODELS list, but OpenAI doesn't need a distinct text-only vs
// vision model split the way Groq's Llama lineup did.
const VISION_MODELS = ["gpt-4o-mini", "gpt-4o"];

// Extracts structured JSON from one or more images. Each image is a data
// URL (e.g. "data:image/png;base64,...."). Same JSON-mode + per-model
// 429 failover contract as openaiJsonCompletion, but over vision models.
export async function openaiVisionJsonCompletion(prompt: string, imageDataUrls: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAINotConfiguredError();

  const content = [
    { type: "text", text: prompt },
    ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  let lastError: Error | null = null;

  for (const model of VISION_MODELS) {
    const res = await fetch(OPENAI_URL, {
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
      if (typeof text !== "string") throw new Error("OpenAI vision response missing message content");
      return text;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`OpenAI vision request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);
    if (res.status !== 429) throw lastError;
    console.warn(`[openai] vision model ${model} rate-limited, trying next model`, lastError.message);
  }

  throw lastError ?? new Error("OpenAI vision request failed: no models available");
}

export async function openaiJsonCompletion(messages: OpenAIMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAINotConfiguredError();

  let lastError: Error | null = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const res = await fetch(OPENAI_URL, {
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
      if (typeof content !== "string") throw new Error("OpenAI response missing message content");
      return content;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`OpenAI request failed (${model}): HTTP ${res.status} ${body.slice(0, 300)}`);

    // Only a rate/quota limit is worth failing over for — any other error
    // (bad request, auth, server error) will fail identically on every
    // model, so retrying would just waste time.
    if (res.status !== 429) throw lastError;
    console.warn(`[openai] ${model} rate-limited, trying next model`, lastError.message);
  }

  throw lastError ?? new Error("OpenAI request failed: no models available");
}
