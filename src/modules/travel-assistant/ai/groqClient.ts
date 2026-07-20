const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Groq's free tier enforces a separate tokens-per-day cap PER MODEL, not
// account-wide. When our primary model's daily cap is exhausted (confirmed
// in production: llama-3.3-70b-versatile hit "Rate limit reached ... on
// tokens per day (TPD): Limit 100000" mid-day), every call 429s and the
// caller falls back to the much dumber deterministic regex parser for the
// rest of the day. Retrying the SAME model does nothing for a daily cap, so
// on a 429 we fail over to a smaller model with its own separate quota —
// degraded quality is far better than losing conversational ability
// entirely until the cap resets.
const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

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

    // Only a rate/quota limit is worth failing over for — any other error
    // (bad request, auth, server error) will fail identically on every
    // model, so retrying would just waste time.
    if (res.status !== 429) throw lastError;
    console.warn(`[groq] ${model} rate-limited, trying next model`, lastError.message);
  }

  throw lastError ?? new Error("Groq request failed: no models available");
}
