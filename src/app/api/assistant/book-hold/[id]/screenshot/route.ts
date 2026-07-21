import { BookingJobRepository } from "@/modules/travel-assistant/storage/BookingJobRepository";

// Serves the confirmation-page PNG for a successful hold. Kept out of the
// poll response so that stays small; the chat renders this via an <img src>.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await BookingJobRepository.findById(id);
  if (!job || !job.screenshot) {
    return new Response("Not found", { status: 404 });
  }

  // Prisma Bytes come back as a Buffer/Uint8Array; hand it to Response as-is.
  const bytes = new Uint8Array(job.screenshot);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="hold-${job.id}.png"`,
    },
  });
}
