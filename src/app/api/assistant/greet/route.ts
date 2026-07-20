import { NextResponse } from "next/server";
import { ChatMemoryRepository } from "@/modules/travel-assistant/storage/ChatMemoryRepository";

const FALLBACK_GREETING =
  'Ask me for a flight quote — e.g. "Enugu ABV-LOS today" or "ABV to LOS 12th july to return 23rd". Searches Enugu Air and United Nigeria Airlines.';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionKey?: string;
    displayName?: string | null;
    isAuthenticated?: boolean;
  };

  if (!body.sessionKey) return NextResponse.json({ reply: FALLBACK_GREETING });

  try {
    const session = await ChatMemoryRepository.getOrCreateSession(
      body.sessionKey,
      body.displayName ?? null,
      body.isAuthenticated ?? false
    );
    const isReturning = !session.isNewSession;

    const firstName = body.displayName?.trim().split(/\s+/)[0];

    let reply: string;
    if (firstName) {
      reply = isReturning
        ? `Hello, ${firstName}! Welcome back. I'm your TDIS Assistant. How may I help you today?`
        : `Hello, ${firstName}! I'm your TDIS Assistant. I can help you search flights, answer travel questions, and more. How may I help you today?`;
    } else {
      reply = isReturning
        ? "Welcome back! I'm your TDIS Assistant. What's on your mind today? How may I help you?"
        : "Hello Dear! I'm your TDIS Assistant. What's on your mind today? How may I help you?";
    }

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[assistant/greet] failed, using fallback:", err);
    return NextResponse.json({ reply: FALLBACK_GREETING });
  }
}
