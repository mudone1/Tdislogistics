import { NextResponse } from "next/server";
import { connectorServiceClient } from "@/lib/connectorServiceClient";
import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";
import type { AirlineKey } from "@prisma/client";

export const maxDuration = 60;

// Airlines with a Book-on-Hold automation wired up. Others are rejected up
// front rather than creating a job that could never run. Keep in sync with
// BOOK_ON_HOLD_HANDLERS in connector-service/src/server.ts.
const BOOKABLE_AIRLINES = new Set<AirlineKey>(["ENUGU"]);

interface BookHoldBody {
  airline?: string;
  origin?: string;
  destination?: string;
  departureDate?: string; // YYYY-MM-DD
  returnDate?: string; // omit for one-way
  title?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  sessionKey?: string;
  createdBy?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Creates a PENDING BookingJob row, then asks connector-service to run it.
// Returns the job id the chat polls. The run itself takes minutes and lives
// entirely on connector-service; this route never waits for it.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as BookHoldBody;

  const airline = (body.airline || "ENUGU").toUpperCase() as AirlineKey;
  if (!BOOKABLE_AIRLINES.has(airline)) {
    return NextResponse.json(
      { error: `Book-on-Hold isn't available for ${airline} yet — only Enugu Air is wired up so far.` },
      { status: 400 }
    );
  }

  const missing: string[] = [];
  if (!body.origin) missing.push("origin");
  if (!body.destination) missing.push("destination");
  if (!body.departureDate) missing.push("departureDate");
  if (!body.firstName) missing.push("firstName");
  if (!body.lastName) missing.push("lastName");
  // The passenger form requires both — the automation fills email + its
  // verification field and a mobile number, so demand them here.
  if (!body.email) missing.push("email");
  if (!body.phone) missing.push("phone");
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required field(s): ${missing.join(", ")}` }, { status: 400 });
  }

  if (!DATE_RE.test(body.departureDate!)) {
    return NextResponse.json({ error: "departureDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.returnDate && !DATE_RE.test(body.returnDate)) {
    return NextResponse.json({ error: "returnDate must be YYYY-MM-DD" }, { status: 400 });
  }

  const job = await BookingJobRepository.create({
    airline,
    sessionKey: body.sessionKey ?? null,
    origin: body.origin!.toUpperCase(),
    destination: body.destination!.toUpperCase(),
    departureDate: body.departureDate!,
    returnDate: body.returnDate ?? null,
    title: body.title,
    firstName: body.firstName!,
    lastName: body.lastName!,
    phone: body.phone!,
    email: body.email!,
    createdBy: body.createdBy ?? null,
  });

  try {
    const { ok, status, body: triggerBody } = await connectorServiceClient.bookHold(job.id);
    if (!ok) {
      // connector-service reachable but refused the job — surface it and mark
      // the job failed so the client doesn't poll a job that will never run.
      const reason = (triggerBody as { error?: string })?.error || `connector-service returned ${status}`;
      await BookingJobRepository.markFailed(job.id, "UNKNOWN", reason, 0);
      return NextResponse.json({ jobId: job.id, status: "FAILED", error: reason }, { status: 502 });
    }
  } catch (err) {
    // connector-service unreachable — same treatment, categorized as a portal
    // problem so the chat shows the right friendly line.
    const reason = err instanceof Error ? err.message : String(err);
    await BookingJobRepository.markFailed(job.id, "PORTAL_UNAVAILABLE", reason, 0);
    return NextResponse.json({ jobId: job.id, status: "FAILED", error: reason }, { status: 503 });
  }

  return NextResponse.json({ jobId: job.id, status: "PENDING" }, { status: 202 });
}
