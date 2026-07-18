import { NextRequest, NextResponse } from "next/server";
import { parseFlightQuery } from "@/modules/travel-assistant/parser/parseFlightQuery";

export const maxDuration = 60;

const BASE_URL = process.env.CONNECTOR_SERVICE_URL;
const API_KEY = process.env.CONNECTOR_SERVICE_API_KEY;

export async function POST(req: NextRequest) {
    const { message } = (await req.json().catch(() => ({})));
  if (!message || !message.trim()) {
    return NextResponse.json({ reply: 'Send me a route and a date, e.g. "Enugu ABV-LOS today".' });
  }

  const parsed = parseFlightQuery(message);

  if (!parsed.origin || !parsed.destination) {
    return NextResponse.json({
      reply:
        'I couldn\'t figure out the route from that. Try something like "ABV-LOS today" or "from Lagos to Enugu tomorrow".',
      parsed,
    });
  }

  const date = parsed.date || new Date().toISOString().slice(0, 10);

  if (!BASE_URL || !API_KEY) {
    return NextResponse.json({
      reply: "The search service isn't configured yet - ask an admin to check CONNECTOR_SERVICE_URL.",
      parsed,
    });
  }

  try {
    const res = await fetch(`${BASE_URL}/internal/travel-assistant/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-api-key": API_KEY },
      body: JSON.stringify({ origin: parsed.origin, destination: parsed.destination, date }),
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      return NextResponse.json({
        reply: `Search failed: ${data.error || "unknown error"}`,
        parsed,
      });
    }

    return NextResponse.json({
      reply: formatQuoteReply(data),
      parsed,
      result: data,
    });
  } catch (err) {
    return NextResponse.json({
      reply: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      parsed,
    });
  }
}

function formatQuoteReply(result: any) {
  if (result.options.length === 0) {
    return `No flights found ${result.query.origin}\u2192${result.query.destination} on ${result.query.date}.`;
  }

  const airline = result.options[0].airline;
  const lines = result.options.map((o: any) => {
    const priceLabel = o.fare != null ? o.fare.toLocaleString() : o.seatStatus || "unavailable";
    return `${o.departureTime}@${priceLabel}`;
  });

  return `${airline}\n${lines.join("\n")}`;
}