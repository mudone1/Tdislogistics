import { getBookingJobStatus } from "./assistantClient";

const POLL_MS = 4000;
const MAX_ATTEMPTS = 90; // ~6 min, matching ChatBubble's own budget for a Book-on-Hold run

function errorContactNote(reason: string): string {
  // Same "surface the real reason" policy as the rest of the assistant —
  // these are TDIS staff, not public customers.
  return ` Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
}

function formatSuccessMessage(result: NonNullable<Awaited<ReturnType<typeof getBookingJobStatus>>["result"]>): string {
  const lines = ["✅ Hold confirmed"];
  if (result.pnr) lines.push(`Booking reference (PNR): ${result.pnr}`);
  if (result.holdExpiresAt) lines.push(`Held until: ${result.holdExpiresAt}`);
  if (result.totalPayable != null) {
    lines.push(`Total payable: ${result.currency ? `${result.currency} ` : ""}${result.totalPayable.toLocaleString()}`);
  }
  return lines.join("\n");
}

// Polls a Book-on-Hold job until it's terminal, then sends exactly one
// follow-up WhatsApp message with the outcome — mirrors ChatBubble's
// pollBookingJob, just server-side since there's no browser tab holding
// state for a WhatsApp chat.
export function pollBookingJob(jobId: string, sendMessage: (text: string) => Promise<void>): void {
  let attempts = 0;

  const tick = async (): Promise<void> => {
    attempts++;
    try {
      const job = await getBookingJobStatus(jobId);
      if (job.status === "SUCCESS" && job.result) {
        await sendMessage(formatSuccessMessage(job.result));
        return;
      }
      if (job.status === "FAILED") {
        const reason = job.error?.detail || job.error?.message || "unknown error";
        await sendMessage(`⚠️ I couldn't complete that hold.${errorContactNote(reason)}`);
        return;
      }
    } catch (err) {
      console.error(`[whatsapp] booking poll failed for job ${jobId}:`, err);
    }

    if (attempts >= MAX_ATTEMPTS) {
      await sendMessage("The hold is taking longer than expected — it may still complete. Check with an admin or try again.");
      return;
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, 3000); // first check after 3s, matching ChatBubble
}
