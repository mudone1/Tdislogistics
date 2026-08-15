import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { AirlineKey, BookingErrorCategory, BookingJobStatus, BookingStage, CabinClass } from "@prisma/client";

// Jobs a best-effort CANCEL/RESET/ABORT/STOP still has a chance to affect —
// QUEUED is represented as status PENDING with stage "QUEUED" (see
// markQueued below), so PENDING covers both "not yet picked up at all" and
// "waiting in a worker-pool queue"; RUNNING covers the automation actually
// in flight. SUCCESS/FAILED/CANCELLED are all terminal — nothing left to cancel.
const OPEN_STATUSES: BookingJobStatus[] = ["PENDING", "RUNNING"];

// Coordination row for a Book-on-Hold run (see the BookingJob model in
// prisma/schema.prisma for the why). Next.js creates it PENDING and hands
// the id to connector-service; connector-service moves it RUNNING ->
// SUCCESS/FAILED as the multi-minute Playwright automation progresses; the
// chat client polls it until terminal. Both processes share one Postgres,
// so this row is the only channel between them.

export interface CreateBookingJobInput {
  airline: AirlineKey;
  sessionKey?: string | null;
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string | null; // omit for one-way
  title?: string; // defaults to "Mr"
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  // Passengers beyond the lead one above, same PNR — adults share the lead
  // passenger's phone/email, child/infant passengers carry dateOfBirth
  // instead (see the Prisma column comment). Omit for a single-passenger hold.
  additionalPassengers?: {
    type?: "ADULT" | "CHILD" | "INFANT";
    title: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
  }[];
  preferredDepartureTime?: string | null;
  preferredReturnTime?: string | null;
  cabinClass?: CabinClass | null;
  createdBy?: string | null;
}

export interface BookingSuccess {
  pnr: string | null;
  holdExpiresAt: string | null;
  totalPayable: number | null;
  currency: string | null;
  screenshot: Uint8Array | null;
  pdf?: Uint8Array | null;
  durationMs: number;
}

// Prisma's Bytes column types as Uint8Array<ArrayBuffer>; a Node Buffer (what
// Playwright's page.screenshot returns) is a Uint8Array over ArrayBufferLike,
// which TS rejects. A fresh Uint8Array copy normalizes the backing buffer type.
function toBytes(data: Uint8Array | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (!data) return null;
  const copy = new Uint8Array(data.length); // length ctor => Uint8Array<ArrayBuffer>
  copy.set(data);
  return copy;
}

export const BookingJobRepository = {
  create(input: CreateBookingJobInput) {
    return prisma.bookingJob.create({
      data: {
        airline: input.airline,
        sessionKey: input.sessionKey ?? null,
        origin: input.origin,
        destination: input.destination,
        departureDate: input.departureDate,
        returnDate: input.returnDate ?? null,
        title: input.title ?? "Mr",
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        additionalPassengers: input.additionalPassengers?.length ? input.additionalPassengers : undefined,
        preferredDepartureTime: input.preferredDepartureTime ?? null,
        preferredReturnTime: input.preferredReturnTime ?? null,
        cabinClass: input.cabinClass ?? "ECONOMY",
        createdBy: input.createdBy ?? null,
      },
    });
  },

  findById(id: string) {
    return prisma.bookingJob.findUnique({ where: { id } });
  },

  markRunning(id: string) {
    return prisma.bookingJob.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date(), stage: null, queuePosition: null },
    });
  },

  // Worker-pool queue state — status stays PENDING (the job hasn't started
  // running yet, it's just waiting its turn for a free account/worker).
  // See EnuguWorkerPool.ts.
  markQueued(id: string, position: number) {
    return prisma.bookingJob.update({
      where: { id },
      data: { stage: "QUEUED", queuePosition: position },
    });
  },

  updateQueuePosition(id: string, position: number) {
    return prisma.bookingJob.update({
      where: { id },
      data: { queuePosition: position },
    });
  },

  // Fine-grained progress once the automation is actually RUNNING —
  // queuePosition is meaningless past this point, cleared for clarity.
  updateStage(id: string, stage: BookingStage) {
    return prisma.bookingJob.update({
      where: { id },
      data: { stage, queuePosition: null },
    });
  },

  markSuccess(id: string, result: BookingSuccess) {
    return prisma.bookingJob.update({
      where: { id },
      data: {
        status: "SUCCESS",
        pnr: result.pnr,
        holdExpiresAt: result.holdExpiresAt,
        totalPayable: result.totalPayable,
        currency: result.currency,
        screenshot: toBytes(result.screenshot),
        pdf: toBytes(result.pdf),
        durationMs: result.durationMs,
        finishedAt: new Date(),
      },
    });
  },

  markFailed(id: string, category: BookingErrorCategory, message: string, durationMs: number) {
    return prisma.bookingJob.update({
      where: { id },
      data: {
        status: "FAILED",
        errorCategory: category,
        // errorMessage is the real reason, kept so TDIS staff can relay it to
        // Muhammed (same product direction as the search flow) — the chat maps
        // errorCategory to a friendly line and can show this on request.
        errorMessage: message,
        durationMs,
        finishedAt: new Date(),
      },
    });
  },

  // Every job still eligible for a best-effort CANCEL for this chat number
  // — see OPEN_STATUSES above. Used by the CANCEL/RESET/ABORT/STOP handler
  // in ConversationOrchestrator.ts.
  findOpenBySessionKey(sessionKey: string) {
    return prisma.bookingJob.findMany({
      where: { sessionKey, status: { in: OPEN_STATUSES } },
    });
  },

  // User-initiated cancel, noticed before the automation reached a point of
  // no return (still QUEUED, or RUNNING but not yet past its last stage
  // checkpoint) — no PNR was ever created. See
  // recordCancelledButCompleted below for the rarer opposite case.
  markCancelled(id: string) {
    return prisma.bookingJob.update({
      where: { id },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
  },

  // The narrow edge case "best-effort" cancellation can't actually prevent:
  // the automation was cancelled, but by the time connector-service's live
  // status re-check ran (immediately before what would have been
  // markSuccess), the hold had ALREADY been created on the airline's own
  // portal. Never silently reported as an ordinary SUCCESS — status stays
  // CANCELLED — but the real PNR/hold details are still recorded (not
  // discarded) so TDIS staff can see a possible orphaned hold needing
  // manual attention rather than losing track of it entirely.
  recordCancelledButCompleted(id: string, result: BookingSuccess) {
    return prisma.bookingJob.update({
      where: { id },
      data: {
        status: "CANCELLED",
        pnr: result.pnr,
        holdExpiresAt: result.holdExpiresAt,
        totalPayable: result.totalPayable,
        currency: result.currency,
        screenshot: toBytes(result.screenshot),
        pdf: toBytes(result.pdf),
        durationMs: result.durationMs,
        errorMessage:
          "Cancelled by the user, but the automation had already placed this hold on the airline's own portal before noticing — needs manual review.",
        finishedAt: new Date(),
      },
    });
  },
};
