import { NextResponse } from "next/server";
import { parseFlightQuery } from "@/modules/travel-assistant/parser/parseFlightQuery";
import type { FlightSearchResult, FlightOption } from "@/modules/travel-assistant/core/types";

export const maxDuration = 60;

const BASE_URL = process.env.CONNECTOR_SERVICE_URL;
const API_KEY = process.env.CONNECTOR_SERVICE_API_KEY;

interface PendingRoundTrip {
  origin: string;
  destination: string;
  date: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { message?: string; pending?: PendingRoundTrip };
  const message = body.message;
  if (!message || !message.trim()) {
    return NextResponse.json({ reply: 'Send me a route and a date, e.g. "Enugu ABV-LOS today".' });
  }

  if (body.pending) {
    const dateOnly = parseFlightQuery(message).date;
    if (!dateOnly) {
      return NextResponse.json({
        reply: "I still couldn't find a date in that. What date would you like to return?",
        pending: body.pending,
      });
    }
    return runRoundTrip(body.pending.origin, body.pending.destination, body.pending.date, dateOnly);
  }

  const parsed = parseFlightQuery(message);

  if (!parsed.origin || !parsed.destination) {
    return NextResponse.json({
      reply:
        'I couldn\'t figure out the route from that. Try something like "ABV-LOS today" or "from Lagos to Enugu tomorrow".',
      parsed,
    });
  }

  const date = parsed.date ?? new Date().toISOString().slice(0, 10);

  if (parsed.isRoundTrip && parsed.needsReturnDate) {
    return NextResponse.json({
      reply: `Got it — one-way to ${parsed.destination} on ${date} confirmed. What date would you like to return?`,
      pending: { origin: parsed.origin, destination: parsed.destination, date } as PendingRoundTrip,
      parsed,
    });
  }

  if (parsed.isRoundTrip && parsed.returnDate) {
    return runRoundTrip(parsed.origin, parsed.destination, date, parsed.returnDate);
  }

  return runOneWay(parsed.origin, parsed.destination, date);
}

async function runOneWay(origin: string, destination: string, date: string) {
  const check = ensureConfigured();
  if (check) return check;

  try {
    const data = await callSearch(origin, destination, date);
    if (data.error) return NextResponse.json({ reply: `Search failed: ${data.error}` });
    return NextResponse.json({ reply: formatLeg(data), result: data });
  } catch (err) {
    return NextResponse.json({ reply: `Search failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function runRoundTrip(origin: string, destination: string, outboundDate: string, returnDate: string) {
  const check = ensureConfigured();
  if (check) return check;

  try {
    // Sequential, not Promise.all — running two full Chromium instances at
    // once appears to exceed Railway's available memory, causing one to
    // get killed mid-search ("Target page, context or browser has been
    // closed"). Slower, but reliable.
    const outbound = await callSearch(origin, destination, outboundDate);
    const back = await callSearch(destination, origin, returnDate);

    if (outbound.error || back.error) {
      return NextResponse.json({ reply: `Search failed: ${outbound.error || back.error}` });
    }

    const reply =
      `Outbound (${origin}\u2192${destination}, ${outboundDate}):\n${formatLeg(outbound)}\n\n` +
      `Return (${destination}\u2192${origin}, ${returnDate}):\n${formatLeg(back)}`;

    return NextResponse.json({ reply, outbound, return: back });
  } catch (err) {
    return NextResponse.json({ reply: `Search failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function ensureConfigured() {
  if (!BASE_URL || !API_KEY) {
    return NextResponse.json({ reply: "The search service isn't configured yet — ask an admin to check CONNECTOR_SERVICE_URL." });
  }
  return null;
}

async function callSearch(origin: string, destination: string, date: string): Promise<FlightSearchResult & { error?: string }> {
  const res = await fetch(`${BASE_URL}/internal/travel-assistant/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": API_KEY! },
    body: JSON.stringify({ origin, destination, date }),
    cache: "no-store",
  });
  const data = (await res.json()) as FlightSearchResult & { error?: string };
  if (!res.ok && !data.error) {
    return { ...data, error: `HTTP ${res.status}` };
  }
  return data;
}

function formatLeg(result: FlightSearchResult): string {
  if (result.options.length === 0) {
    return `No flights found ${result.query.origin}\u2192${result.query.destination} on ${result.query.date}.`;
  }

  const airline = result.options[0].airline;
  const lines = result.options.map((o: FlightOption) => {
    const priceLabel = o.fare != null ? o.fare.toLocaleString() : o.seatStatus ?? "unavailable";
    return `${o.departureTime}@${priceLabel}`;
  });

  return `${airline}\n${lines.join("\n")}`;
}
