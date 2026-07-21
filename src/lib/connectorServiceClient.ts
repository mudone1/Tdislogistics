// Server-side only — never import this from a "use client" component.
// Attaches the shared internal API key so it never reaches the browser.

const BASE_URL = process.env.CONNECTOR_SERVICE_URL; // e.g. http://connector-service.internal:4100
const API_KEY = process.env.CONNECTOR_SERVICE_API_KEY;

async function call(path: string, init?: RequestInit) {
  if (!BASE_URL || !API_KEY) {
    throw new Error(
      "CONNECTOR_SERVICE_URL / CONNECTOR_SERVICE_API_KEY are not set — the connector-service " +
        "isn't reachable from this deployment yet. See connector-service/README.md."
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": API_KEY,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export const connectorServiceClient = {
  sync: (airline: string, trigger: "MANUAL" | "SCHEDULED" = "MANUAL") =>
    call(`/internal/connectors/${airline}/sync`, { method: "POST", body: JSON.stringify({ trigger }) }),
  test: (airline: string) => call(`/internal/connectors/${airline}/test`, { method: "POST" }),
  // Kicks off a Book-on-Hold run for an already-created BookingJob row. Returns
  // 202 immediately; the outcome is written back to the row and polled from there.
  bookHold: (jobId: string) =>
    call(`/internal/travel-assistant/book-hold`, { method: "POST", body: JSON.stringify({ jobId }) }),
};
