import { NextResponse } from "next/server";
import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";
import { bookingErrorMessage } from "@/modules/travel-assistant/booking/bookingErrorMessages";

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
    route: { origin: job.origin, destination: job.destination, departureDate: job.departureDate, returnDate: job.returnDate },
    passenger: { title: job.title, firstName: job.firstName, lastName: job.lastName },
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
