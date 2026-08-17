import { NextResponse } from "next/server";
import { AirlineDepositRepository } from "@/modules/travel-assistant/storage/AirlineDepositRepository";
import { AirlineOpeningBalanceRepository } from "@/modules/travel-assistant/storage/AirlineOpeningBalanceRepository";
import { formatDepositReport } from "@/modules/travel-assistant/deposits/formatDepositReport";
import { lagosToday } from "@/modules/travel-assistant/deposits/lagosDate";

export const runtime = "nodejs";

// GET so this is trivially callable/cacheable and easy to hit directly
// while testing — chatId scopes the report to whichever group's deposits
// are being asked about; date defaults to today's Lagos calendar day (the
// "@TDISbot credit update" command), but accepts an explicit
// ?date=YYYY-MM-DD so the eventual Phase 2 scheduler can request
// yesterday's day the same way without any change here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "chatId is required" }, { status: 400 });
  }
  const dateIso = url.searchParams.get("date") || lagosToday();

  try {
    const [deposits, openingBalances] = await Promise.all([
      AirlineDepositRepository.getDepositsForDate(chatId, dateIso),
      AirlineOpeningBalanceRepository.getOpeningBalances(chatId, dateIso),
    ]);
    const report = formatDepositReport(
      dateIso,
      deposits.map((d) => ({ airline: d.airline, amount: Number(d.amount) })),
      openingBalances
    );
    return NextResponse.json({ date: dateIso, count: deposits.length, report });
  } catch (err) {
    console.error("[assistant/deposits/report] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
