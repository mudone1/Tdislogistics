import { getBookingJobStatus, getBookingScreenshot } from "./assistantClient";

const POLL_MS = 4000;
const MAX_ATTEMPTS = 90; // ~6 min, matching ChatBubble's own budget for a Book-on-Hold run

export interface BookingPollSender {
  sendText: (text: string) => Promise<void>;
  sendImage: (buffer: Buffer, caption?: string) => Promise<void>;
}

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
// state for a WhatsApp chat. When a confirmation screenshot is available
// (same as the browser's BookingResultCard image), it's sent as the
// caption-bearing image itself rather than a separate text message.
export function pollBookingJob(jobId: string, sender: BookingPollSender): void {
  let attempts = 0;

  const tick = async (): Promise<void> => {
    attempts++;
    try {
      const job = await getBookingJobStatus(jobId);
      if (job.status === "SUCCESS" && job.result) {
        const text = formatSuccessMessage(job.result);
        if (job.result.hasScreenshot && job.result.screenshotUrl) {
          try {
            const screenshot = await getBookingScreenshot(job.result.screenshotUrl);
            await sender.sendImage(screenshot, text);
            return;
          } catch (err) {
            console.error(`[whatsapp] screenshot fetch failed for job ${jobId}, falling back to text-only:`, err);
          }
        }
        await sender.sendText(text);
        return;
      }
      if (job.status === "FAILED") {
        const reason = job.error?.detail || job.error?.message || "unknown error";
        await sender.sendText(`⚠️ I couldn't complete that hold.${errorContactNote(reason)}`);
        return;
      }
    } catch (err) {
      console.error(`[whatsapp] booking poll failed for job ${jobId}:`, err);
    }

    if (attempts >= MAX_ATTEMPTS) {
      await sender.sendText("The hold is taking longer than expected — it may still complete. Check with an admin or try again.");
      return;
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, 3000); // first check after 3s, matching ChatBubble
}
