import { getBalanceUpdateStatus, type BalanceUpdateStatus } from "./assistantClient";
import { keepTypingAlive } from "./typingIndicator";

const POLL_MS = 5000;
const MAX_ATTEMPTS = 18; // ~90s — several airlines' Playwright syncs can run concurrently, but a
// connector that's down or slow shouldn't hold everyone else's numbers hostage indefinitely.

function formatDateTime(date: Date): string {
  // Nigerian business, Nigerian time zone — matters for a "date and time"
  // a reader in Lagos is going to read literally.
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatBalanceMessage(balances: BalanceUpdateStatus["balances"]): string {
  const header = `Balance update -(${formatDateTime(new Date())})`;
  const lines = balances.map((b, i) => {
    const amount = Math.round(b.balance).toLocaleString();
    return `${b.displayName} - ${amount}${i === balances.length - 1 ? "." : ""}`;
  });
  return [header, ...lines].join("\n");
}

// Polls until every airline's balance has synced more recently than the
// trigger instant, or the poll budget runs out — whichever comes first —
// then sends exactly one formatted "Balance update" message with
// whatever's freshest at that point. Mirrors bookingPoll.ts's shape.
export function pollBalanceUpdate(triggeredAt: string, sendText: (text: string) => Promise<void>, setTyping: () => Promise<void>): void {
  let attempts = 0;
  const stopTyping = keepTypingAlive(setTyping);

  const tick = async (): Promise<void> => {
    attempts++;
    try {
      const status = await getBalanceUpdateStatus(triggeredAt);
      if (status.ready || attempts >= MAX_ATTEMPTS) {
        stopTyping();
        await sendText(formatBalanceMessage(status.balances));
        return;
      }
    } catch (err) {
      console.error("[whatsapp] balance update poll failed:", err);
      if (attempts >= MAX_ATTEMPTS) {
        stopTyping();
        await sendText("I couldn't pull the updated balances just now — mind trying \"balance update\" again in a moment?");
        return;
      }
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, 3000);
}
