import { NextResponse } from "next/server";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";
import { NotificationRepository } from "@/modules/travel-assistant/storage/NotificationRepository";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionKey?: string };
  if (!body.sessionKey) return NextResponse.json({ notifications: [] });

  try {
    const session = await ChatMemoryRepository.getOrCreateSession(body.sessionKey, null, false);
    const rows = await NotificationRepository.listForSession(session.id, 30);
    return NextResponse.json({
      notifications: rows.map((n: (typeof rows)[number]) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.read,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    console.error("[assistant/notifications] failed:", err);
    return NextResponse.json({ notifications: [] });
  }
}
