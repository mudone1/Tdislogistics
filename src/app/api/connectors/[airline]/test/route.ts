import { NextResponse } from "next/server";
import { connectorServiceClient } from "@/lib/connectorServiceClient";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";

// Playwright launching a browser + navigating a real login page routinely
// takes 15-30+ seconds — well past Vercel's 10s default function timeout
// on the Hobby plan. Without this, the request gets killed before
// connector-service ever sends back its real response, which shows up
// client-side as a vague "unknown error" instead of the actual cause.
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ airline: string }> }) {
  const airline = (await params).airline.toUpperCase();
  if (!ConnectorRegistry.isImplemented(airline)) {
    return NextResponse.json(
      { error: `"${airline}" is not an implemented connector yet (Category B).` },
      { status: 404 }
    );
  }

  try {
    const { status, body } = await connectorServiceClient.test(airline);
    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
