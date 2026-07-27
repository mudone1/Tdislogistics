import { NextResponse } from "next/server";
import { triggerBalanceUpdate } from "@/lib/balanceUpdateService";

export const maxDuration = 30; // just fires the sync requests, doesn't wait for them to finish

// Triggers a manual sync across every implemented airline connector and
// returns immediately with the trigger instant — the actual Playwright
// syncs run in the background on connector-service. The caller (see
// ConversationOrchestrator's "balance update" handling) polls
// /api/assistant/balance-update/status?since=<triggeredAt> to know when
// fresh balances are ready, the same job+poll shape as Book-on-Hold.
export async function POST() {
  try {
    const result = await triggerBalanceUpdate();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[balance-update/trigger] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
