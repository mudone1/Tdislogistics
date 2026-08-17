import { NextResponse } from "next/server";
import { isBalanceUpdateMessage, parseBalanceUpdateMessage } from "@/modules/travel-assistant/deposits/balanceUpdateParser";
import { AirlineOpeningBalanceRepository } from "@/modules/travel-assistant/storage/AirlineOpeningBalanceRepository";
import { lagosToday } from "@/modules/travel-assistant/deposits/lagosDate";

export const runtime = "nodejs";

interface RequestBody {
  chatId: string;
  text: string;
}

// whatsapp-service calls this for any group message it thinks LOOKS like a
// nightly "Balance Update" post — but the real classification and parsing
// happens here, not there, same division of labor as every other
// deposit-tracking endpoint (the client only ever forwards raw text/images
// and reacts to a status code, it never itself decides what counts).
// Re-validates isBalanceUpdateMessage independently rather than trusting
// the caller's own gating.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || !body.chatId || !body.text) {
    return NextResponse.json({ error: "chatId and text are required" }, { status: 400 });
  }

  if (!isBalanceUpdateMessage(body.text)) {
    return NextResponse.json({ recorded: 0, airlines: [] });
  }

  const entries = parseBalanceUpdateMessage(body.text);
  const dateLagos = lagosToday();

  try {
    await AirlineOpeningBalanceRepository.recordManualBalances(body.chatId, dateLagos, body.text, entries);
    return NextResponse.json({ recorded: entries.length, airlines: entries.map((e) => e.airline) });
  } catch (err) {
    console.error("[assistant/deposits/opening-balance] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
