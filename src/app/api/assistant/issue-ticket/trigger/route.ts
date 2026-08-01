import { NextResponse } from "next/server";
import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";
import { connectorServiceClient } from "@/lib/connectorServiceClient";

export const maxDuration = 30; // just fires the request, doesn't wait for the multi-minute automation

// Triggers ticket-issuing for a SPECIFIC PNR — never "the latest booking".
// The caller (ConversationOrchestrator's "Issue <PNR>" command, or a WhatsApp/
// web "Issue Now" list-option reply) always supplies the exact PNR the
// booking confirmation itself carried, so a user with several active holds
// can never have the wrong one paid for.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pnr = typeof body?.pnr === "string" ? body.pnr.trim().toUpperCase() : null;
  if (!pnr) {
    return NextResponse.json({ error: '"pnr" is required' }, { status: 400 });
  }

  const job = await BookingJobRepository.findByPnr(pnr);
  if (!job) {
    return NextResponse.json({ error: `No booking found with PNR "${pnr}"` }, { status: 404 });
  }
  if (job.ticketStatus === "ISSUED") {
    return NextResponse.json({ error: `PNR "${pnr}" is already issued`, ticketStatus: job.ticketStatus }, { status: 409 });
  }
  if (job.ticketStatus === "ISSUING") {
    return NextResponse.json({ error: `PNR "${pnr}" is already being issued`, jobId: job.id, ticketStatus: job.ticketStatus }, { status: 409 });
  }

  try {
    const { ok, status, body: connectorBody } = await connectorServiceClient.issueTicket(job.id);
    if (!ok) {
      const reason = (connectorBody as { error?: string })?.error || `connector-service returned ${status}`;
      return NextResponse.json({ error: reason }, { status: 502 });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ jobId: job.id, pnr });
}
