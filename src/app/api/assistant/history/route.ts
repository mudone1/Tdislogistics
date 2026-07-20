import { NextResponse } from "next/server";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";
import { FlightSearchHistoryRepository } from "@/modules/travel-assistant/storage/FlightSearchHistoryRepository";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionKey?: string };
  if (!body.sessionKey) return NextResponse.json({ searches: [] });

  try {
    const session = await ChatMemoryRepository.getOrCreateSession(body.sessionKey, null, false);
    const records = await FlightSearchHistoryRepository.getRecentForSession(session.id, 20);
    return NextResponse.json({
      searches: records.map((r) => ({
        referenceId: r.referenceId,
        origin: r.origin,
        destination: r.destination,
        date: r.date,
        resultCount: r.resultCount,
        createdAt: r.createdAt,
        result: r.resultsJson,
      })),
    });
  } catch (err) {
    console.error("[assistant/history] failed:", err);
    return NextResponse.json({ searches: [] });
  }
}
