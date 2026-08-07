import { getBookingJobStatus, getBookingScreenshot, type BookingJobStatus } from "./assistantClient";
import { keepTypingAlive } from "./typingIndicator";

const POLL_MS = 4000;
const MAX_ATTEMPTS = 90; // ~6 min, matching ChatBubble's own budget for a Book-on-Hold run

export interface BookingPollSender {
  sendText: (text: string) => Promise<void>;
  sendImage: (buffer: Buffer, caption?: string) => Promise<void>;
  setTyping: () => Promise<void>;
}

function errorContactNote(reason: string): string {
  // Same "surface the real reason" policy as the rest of the assistant —
  // these are TDIS staff, not public customers.
  return ` Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
}

// Deliberately terse — per explicit product direction, the full
// passenger/airline/route/date write-up was too verbose next to the
// screenshot (which already shows all of that visually as the caption's
// attached image). Just the two pieces of info that actually matter as
// TEXT. Fare is whatever was captured at hold-time (an estimate, not a
// final payable figure — payment itself happens on the airline's own flow).
function formatSuccessMessage(job: BookingJobStatus): string {
  const result = job.result!;
  const lines = ["✅ Booking Successful"];
  if (result.pnr) lines.push(`PNR: ${result.pnr}`);
  if (result.totalPayable != null) {
    lines.push(`Amount: ${result.currency ? `${result.currency} ` : ""}${result.totalPayable.toLocaleString()}`);
  }

  return lines.join("\n");
}

// One concise line per automation milestone — see VarsBookOnHold.ts's
// reportStage for exactly where each of these fires.
const STAGE_MESSAGES: Partial<Record<NonNullable<BookingJobStatus["stage"]>, string>> = {
  SEARCHING: "Searching flights...",
  FLIGHT_FOUND: "Flight found.",
  FILLING_PASSENGER_DETAILS: "Filling passenger details...",
  REVIEWING_ITINERARY: "Reviewing itinerary...",
  CREATING_HOLD: "Creating hold...",
};

function formatQueuedMessage(job: BookingJobStatus): string {
  const waitMin = job.estimatedWaitSeconds != null ? Math.max(1, Math.round(job.estimatedWaitSeconds / 60)) : null;
  const lines = [`You are #${job.queuePosition} in the queue.`];
  if (waitMin != null) lines.push(`Estimated wait: ~${waitMin} min.`);
  return lines.join(" ");
}

// Polls a Book-on-Hold job until it's terminal, then sends exactly one
// follow-up WhatsApp message with the outcome — mirrors ChatBubble's
// pollBookingJob, just server-side since there's no browser tab holding
// state for a WhatsApp chat. When a confirmation screenshot is available
// (same as the browser's BookingResultCard image), it's sent as the
// caption-bearing image itself rather than a separate text message.
//
// Deliberately terse per explicit product direction: no per-milestone
// "Searching flights.../Flight found./..." messages and no "Booking
// starting now..." — those turned out to add noise, not clarity. The ONLY
// message before the final result is the queue position (when the job is
// actually queued behind a busy worker); everything else is silence until
// success or failure. Stage is still tracked (STAGE_MESSAGES) purely to
// label which step a failure happened at.
export function pollBookingJob(jobId: string, sender: BookingPollSender): void {
  let attempts = 0;
  let sentQueueNotice = false;
  const stopTyping = keepTypingAlive(sender.setTyping);

  const tick = async (): Promise<void> => {
    attempts++;
    try {
      const job = await getBookingJobStatus(jobId);

      if (!sentQueueNotice && job.stage === "QUEUED" && job.queuePosition != null) {
        sentQueueNotice = true;
        await sender.sendText(formatQueuedMessage(job)).catch((err) => console.error(`[whatsapp] queue notice failed for job ${jobId}:`, err));
      }

      if (job.status === "SUCCESS" && job.result) {
        stopTyping();
        const text = formatSuccessMessage(job);
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
        stopTyping();
        const reason = job.error?.detail || job.error?.message || "unknown error";
        // Reports the exact stage it died at, when known — the last stage
        // recorded before failure (BookingJobRepository.markFailed never
        // clears it), so staff relaying the error to Muhammed can say
        // exactly where it broke, not just "it failed somewhere."
        const stageLabel = job.stage ? STAGE_MESSAGES[job.stage] ?? job.stage : null;
        const stageNote = stageLabel ? ` (failed during: ${stageLabel})` : "";
        await sender.sendText(`⚠️ I couldn't complete that hold${stageNote}.${errorContactNote(reason)}`);
        return;
      }
    } catch (err) {
      console.error(`[whatsapp] booking poll failed for job ${jobId}:`, err);
    }

    if (attempts >= MAX_ATTEMPTS) {
      stopTyping();
      await sender.sendText("The hold is taking longer than expected — it may still complete. Check with an admin or try again.");
      return;
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, 3000); // first check after 3s, matching ChatBubble
}
