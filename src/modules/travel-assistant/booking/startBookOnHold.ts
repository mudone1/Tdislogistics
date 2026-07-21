import { BookingJobRepository } from "../storage/BookingJobRepository";
import { connectorServiceClient } from "../../../lib/connectorServiceClient";
import type { AirlineKey } from "@prisma/client";

// Airlines with a Book-on-Hold automation wired up. Others are rejected up
// front rather than creating a job that could never run. Keep in sync with
// BOOK_ON_HOLD_HANDLERS in connector-service/src/server.ts.
export const BOOKABLE_AIRLINES = new Set<AirlineKey>(["ENUGU"]);

export interface StartBookOnHoldInput {
  airline: AirlineKey;
  sessionKey?: string | null;
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string | null; // omit for one-way
  title?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  createdBy?: string | null;
}

export interface StartBookOnHoldResult {
  jobId: string;
  status: "PENDING" | "FAILED";
  error?: string;
}

// Creates a PENDING BookingJob row and asks connector-service to run it.
// Shared by the REST route (POST /api/assistant/book-hold) and the chat
// orchestrator so both create-and-trigger through one code path. Never waits
// for the multi-minute run — that outcome is written back to the row and
// polled from there. If the trigger itself can't be delivered, the job is
// marked FAILED so no client polls a run that will never start.
export async function startBookOnHold(input: StartBookOnHoldInput): Promise<StartBookOnHoldResult> {
  const job = await BookingJobRepository.create({
    airline: input.airline,
    sessionKey: input.sessionKey ?? null,
    origin: input.origin.toUpperCase(),
    destination: input.destination.toUpperCase(),
    departureDate: input.departureDate,
    returnDate: input.returnDate ?? null,
    title: input.title,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email,
    createdBy: input.createdBy ?? null,
  });

  try {
    const { ok, status, body } = await connectorServiceClient.bookHold(job.id);
    if (!ok) {
      const reason = (body as { error?: string })?.error || `connector-service returned ${status}`;
      await BookingJobRepository.markFailed(job.id, "UNKNOWN", reason, 0);
      return { jobId: job.id, status: "FAILED", error: reason };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await BookingJobRepository.markFailed(job.id, "PORTAL_UNAVAILABLE", reason, 0);
    return { jobId: job.id, status: "FAILED", error: reason };
  }

  return { jobId: job.id, status: "PENDING" };
}
