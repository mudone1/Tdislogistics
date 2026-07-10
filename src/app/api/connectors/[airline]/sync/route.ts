import { NextResponse } from "next/server";
import { connectorServiceClient } from "@/lib/connectorServiceClient";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";

// NOTE ON AUTH: this route (and the rest of /api/connectors/*) should be
// gated to admin users only. The existing app's auth is entirely
// client-side (local-credentials or Firebase Auth in the browser — see
// src/lib/store.tsx), so there's no server-side session to check against
// here yet. Until real server-side session verification exists, treat
// these routes as protected only by not linking to them from non-admin UI,
// and prioritize adding proper server-side auth before this goes to
// production with real credentials behind it.
export async function POST(_req: Request, { params }: { params: Promise<{ airline: string }> }) {
  const airline = (await params).airline.toUpperCase();
  if (!ConnectorRegistry.isImplemented(airline)) {
    return NextResponse.json(
      { error: `"${airline}" is not an implemented connector yet (Category B).` },
      { status: 404 }
    );
  }

  try {
    const { status, body } = await connectorServiceClient.sync(airline, "MANUAL");
    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
