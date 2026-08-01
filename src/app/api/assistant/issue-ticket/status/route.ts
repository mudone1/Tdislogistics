import { NextResponse } from "next/server";
import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";

// Poll endpoint for a ticket-issuing run — GET ?jobId=<id from trigger>.
// Mirrors book-hold's poll shape; screenshot bytes are served from the
// existing /api/assistant/book-hold/[id]/screenshot route (same underlying
// column, overwritten with the issue-page screenshot once ISSUED).
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: '"jobId" query param is required' }, { status: 400 });
  }

  const job = await BookingJobRepository.findById(jobId);
  if (!job) {
    return NextResponse.json({ error: `No booking job ${jobId}` }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    pnr: job.pnr,
    ticketStatus: job.ticketStatus,
    ...(job.ticketStatus === "ISSUED" && {
      result: {
        ticketNumber: job.ticketNumber,
        totalPayable: job.totalPayable != null ? Number(job.totalPayable) : null,
        currency: job.currency,
        issuedAt: job.issuedAt,
        hasScreenshot: job.screenshot != null,
        screenshotUrl: job.screenshot != null ? `/api/assistant/book-hold/${job.id}/screenshot` : null,
      },
    }),
    // ticketStatus stays BOOKED on a failed attempt (retryable) — issueError
    // is the signal a poller checks to know the LAST attempt failed, distinct
    // from "never attempted yet" (also BOOKED, but issueError is null).
    ...(job.ticketStatus === "BOOKED" &&
      job.issueError && {
        error: { detail: job.issueError },
      }),
  });
}
