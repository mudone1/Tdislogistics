import { NextResponse } from "next/server";
import type { AirlineKey } from "@prisma/client";
import { AirlineDepositRepository } from "@/modules/travel-assistant/storage/AirlineDepositRepository";
import { matchAirlineFromNarration, DEPOSIT_AIRLINE_MENU } from "@/modules/travel-assistant/deposits/depositAirlineAliases";
import type { PaymentReceiptParseResult } from "@/modules/travel-assistant/deposits/PaymentReceiptParser";

export const runtime = "nodejs";

interface TagRequestBody {
  chatId: string;
  screenshotMessageId: string | null;
  decision: "CREDITED" | "NOT_CREDITED";
  extraction: PaymentReceiptParseResult;
  airlineOverride?: AirlineKey;
}

// Stateless by design — whatsapp-service holds the pending-payment cache
// (chatId + message ID -> extracted fields, in memory) and sends the whole
// extraction back here on every tag/airline-selection reply. This route
// never itself decides credited/not-credited (that decision already
// happened, is what triggered this call) — it only resolves WHICH airline
// and writes the row, or reports why it can't yet.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as TagRequestBody | null;
  if (!body || !body.chatId || !body.decision || !body.extraction) {
    return NextResponse.json({ error: "chatId, decision, and extraction are required" }, { status: 400 });
  }

  if (body.decision === "NOT_CREDITED") {
    return NextResponse.json({ status: "ignored" });
  }

  const { extraction } = body;
  if (extraction.amount == null || !extraction.readable) {
    return NextResponse.json({
      status: "unreadable",
      message: "I couldn't confidently read an amount off that receipt, so I'm not recording it — could you send a clearer screenshot?",
    });
  }

  const airline = body.airlineOverride ?? matchAirlineFromNarration(extraction.narration);
  if (!airline) {
    return NextResponse.json({
      status: "needs_airline",
      menu: DEPOSIT_AIRLINE_MENU,
    });
  }

  try {
    const outcome = await AirlineDepositRepository.recordDeposit({
      chatId: body.chatId,
      airline,
      amount: extraction.amount,
      screenshotMessageId: body.screenshotMessageId,
      extraction,
    });

    if (outcome.status === "duplicate") {
      return NextResponse.json({ status: "duplicate", airline });
    }
    return NextResponse.json({ status: "recorded", airline, amount: extraction.amount });
  } catch (err) {
    console.error("[assistant/deposits/tag] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
