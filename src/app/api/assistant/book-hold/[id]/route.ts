import { NextResponse } from "next/server";
import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";
import { bookingErrorMessage } from "@/modules/travel-assistant/booking/bookingErrorMessages";

// Rough, single-passenger average — used only to give a queued user a
// ballpark wait, not a precise ETA. Matches the confirmation-page timeout
// scaling in VarsBookOnHold.ts (30-150s depending on party size), so this
// deliberately sits in the middle of that range rather than at either end.
const AVERAGE_BOOKING_DURATION_SECONDS = 90;

// Poll endpoint for a Book-on-Hold job. Returns lightweight status +
// result metadata only — the screenshot bytes are served separately from
// /[id]/screenshot so a poll response stays small. The chat polls this
// until status is terminal (SUCCESS | FAILED).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await BookingJobRepository.findById(id);
  if (!job) {
    return NextResponse.json({ error: `No booking job ${id}` }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    airline: job.airline,
    route: {
      origin: job.origin,
      destination: job.destination,
      departureDate: job.departureDate,
      returnDate: job.returnDate,
      departureTime: job.preferredDepartureTime,
      returnTime: job.preferredReturnTime,
    },
    passenger: { title: job.title, firstName: job.firstName, lastName: job.lastName },
    // Additional passengers beyond the lead one, if this was a
    // multi-passenger hold — same shape as what was stored at creation time.
    additionalPassengers: job.additionalPassengers ?? null,
    // Worker-pool progress — see BookingStage in schema.prisma. stage is
    // QUEUED (with queuePosition set) while waiting on a free account, then
    // one of the automation milestones once a worker picks it up; both are
    // null before either has happened yet, or once the job is terminal.
    stage: job.stage,
    queuePosition: job.queuePosition,
    estimatedWaitSeconds: job.queuePosition != null ? job.queuePosition * AVERAGE_BOOKING_DURATION_SECONDS : null,
    ...(job.status === "SUCCESS" && {
      result: {
        pnr: job.pnr,
        holdExpiresAt: job.holdExpiresAt,
        totalPayable: job.totalPayable != null ? Number(job.totalPayable) : null,
        currency: job.currency,
        hasScreenshot: job.screenshot != null,
        screenshotUrl: job.screenshot != null ? `/api/assistant/book-hold/${job.id}/screenshot` : null,
      },
    }),
    ...(job.status === "FAILED" && {
      error: {
        category: job.errorCategory,
        message: bookingErrorMessage(job.errorCategory),
        // Raw reason for staff to relay to Muhammed (product direction: staff
        // chat surfaces the real cause, unlike a customer-facing bot).
        detail: job.errorMessage,
      },
    }),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
  });
}
