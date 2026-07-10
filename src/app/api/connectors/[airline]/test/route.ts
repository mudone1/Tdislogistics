import { NextResponse } from "next/server";
import { connectorServiceClient } from "@/lib/connectorServiceClient";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";

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
