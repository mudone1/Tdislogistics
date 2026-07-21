import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { AirlineKey, BookingErrorCategory } from "@prisma/client";

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
      data: { status: "RUNNING", startedAt: new Date() },
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
};
