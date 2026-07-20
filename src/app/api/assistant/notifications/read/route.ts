import { NextResponse } from "next/server";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";
import { NotificationRepository } from "@/modules/travel-assistant/storage/NotificationRepository";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionKey?: string; id?: string; all?: boolean };
  if (!body.sessionKey) return NextResponse.json({ ok: false });

  try {
    if (body.id) {
      await NotificationRepository.markRead(body.id);
      return NextResponse.json({ ok: true });
    }
    if (body.all) {
      const session = await ChatMemoryRepository.getOrCreateSession(body.sessionKey, null, false);
      await NotificationRepository.markAllRead(session.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false });
  } catch (err) {
    console.error("[assistant/notifications/read] failed:", err);
    return NextResponse.json({ ok: false });
  }
}
