import { NextResponse } from "next/server";
import type { AirlineKey } from "@prisma/client";
import { AirlineDepositRepository } from "@/modules/travel-assistant/storage/AirlineDepositRepository";
import { matchAirlineFromReceipt, isPaystackReceipt, DEPOSIT_AIRLINE_MENU } from "@/modules/travel-assistant/deposits/depositAirlineAliases";
import type { PaymentReceiptParseResult } from "@/modules/travel-assistant/deposits/PaymentReceiptParser";
import { resolveAirlineForTag } from "@/modules/travel-assistant/deposits/resolveAirlineForTag";

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
// happened, is what triggered this call) — it decides WHICH airline (and
// whether this receipt is a direct airline payment or a Paystack payment
// that needs the airline asked about separately), writes the row, or
// reports why it can't yet. whatsapp-service reads isPaystack off the
// response to pick the right wording/silence for each case — see the
// "SILENT PAYMENT PROCESSING RULE" spec this was built from.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as TagRequestBody | null;
  if (!body || !body.chatId || !body.decision || !body.extraction) {
    return NextResponse.json({ error: "chatId, decision, and extraction are required" }, { status: 400 });
  }

  if (body.decision === "NOT_CREDITED") {
    // Not credited (either an airline-direct payment or a Paystack one) —
    // never recorded, never remarked on. Same response for both, since
    // there's nothing left to distinguish once it's being ignored.
    return NextResponse.json({ status: "ignored" });
  }

  const { extraction } = body;
  if (extraction.amount == null || !extraction.readable) {
    return NextResponse.json({
      status: "unreadable",
      message: "I couldn't confidently read an amount off that receipt, so I'm not recording it — could you send a clearer screenshot?",
    });
  }

  // Paystack payments never self-identify the destination airline (the
  // beneficiary is always Paystack itself) — so a Paystack receipt always
  // needs the airline asked about, regardless of what the narration says.
  // The user's inline airline tag (for example "Arik credited") is a hint
  // for a direct airline payment, but it must not short-circuit the extra
  // follow-up we need for Paystack receipts.
  const isPaystack = isPaystackReceipt(extraction.narration, extraction.beneficiary, extraction.bankChannel);
  const airline = resolveAirlineForTag(extraction, body.airlineOverride, isPaystack);

  if (!airline) {
    return NextResponse.json({
      status: "needs_airline",
      menu: DEPOSIT_AIRLINE_MENU,
      isPaystack,
    });
  }

  try {
    const outcome = await AirlineDepositRepository.recordDeposit({
      chatId: body.chatId,
      airline,
      amount: extraction.amount,
      screenshotMessageId: body.screenshotMessageId,
      extraction,
      isPaystack,
    });

    if (outcome.status === "duplicate") {
      return NextResponse.json({ status: "duplicate", airline });
    }
    return NextResponse.json({ status: "recorded", airline, amount: extraction.amount, isPaystack });
  } catch (err) {
    console.error("[assistant/deposits/tag] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
