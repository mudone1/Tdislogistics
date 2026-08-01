import { getIssueTicketStatus, getBookingScreenshot } from "./assistantClient";
import { keepTypingAlive } from "./typingIndicator";

const POLL_MS = 4000;
const MAX_ATTEMPTS = 90; // ~6 min, same budget as the booking/hold poll

export interface IssueTicketPollSender {
  sendText: (text: string) => Promise<void>;
  sendImage: (buffer: Buffer, caption?: string) => Promise<void>;
  setTyping: () => Promise<void>;
}

function errorContactNote(reason: string): string {
  return ` Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
}

function formatIssuedMessage(pnr: string, result: NonNullable<Awaited<ReturnType<typeof getIssueTicketStatus>>["result"]>): string {
  const lines = ["✅ Ticket issued successfully", ""];
  lines.push(`PNR: ${pnr}`);
  if (result.ticketNumber) lines.push(`Ticket number: ${result.ticketNumber}`);
  lines.push("Payment status: Paid");
  if (result.totalPayable != null) {
    lines.push(`Amount paid: ${result.currency ? `${result.currency} ` : ""}${result.totalPayable.toLocaleString()}`);
  }
  return lines.join("\n");
}

// Polls a ticket-issuing job until terminal (ISSUED, or back to BOOKED with
// an issueError on failure), then sends exactly one follow-up message —
// same shape as pollBookingJob.
export function pollIssueTicketJob(jobId: string, pnr: string, sender: IssueTicketPollSender): void {
  let attempts = 0;
  const stopTyping = keepTypingAlive(sender.setTyping);

  const tick = async (): Promise<void> => {
    attempts++;
    try {
      const job = await getIssueTicketStatus(jobId);
      if (job.ticketStatus === "ISSUED" && job.result) {
        stopTyping();
        const text = formatIssuedMessage(pnr, job.result);
        if (job.result.hasScreenshot && job.result.screenshotUrl) {
          try {
            const screenshot = await getBookingScreenshot(job.result.screenshotUrl);
            await sender.sendImage(screenshot, text);
            return;
          } catch (err) {
            console.error(`[whatsapp] issue-ticket screenshot fetch failed for job ${jobId}, falling back to text-only:`, err);
          }
        }
        await sender.sendText(text);
        return;
      }
      if (job.ticketStatus === "BOOKED" && job.error?.detail) {
        stopTyping();
        await sender.sendText(`⚠️ I couldn't issue PNR ${pnr}.${errorContactNote(job.error.detail)}`);
        return;
      }
    } catch (err) {
      console.error(`[whatsapp] issue-ticket poll failed for job ${jobId}:`, err);
    }

    if (attempts >= MAX_ATTEMPTS) {
      stopTyping();
      await sender.sendText(`Issuing PNR ${pnr} is taking longer than expected — it may still complete. Check with an admin or try again.`);
      return;
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, 3000);
}
