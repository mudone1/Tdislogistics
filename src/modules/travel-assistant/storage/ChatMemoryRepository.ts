import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { ConversationSlots } from "../core/types";

/**
 * Repository pattern — mirrors AirlineWalletRepository. Callers never talk
 * to `prisma` directly for chat data.
 */
export const ChatMemoryRepository = {
  async getOrCreateSession(sessionKey: string, displayName: string | null, isAuthenticated: boolean) {
    const existing = await prisma.chatSession.findUnique({ where: { sessionKey } });
    if (existing) {
      if (displayName && displayName !== existing.displayName) {
        const updated = await prisma.chatSession.update({
          where: { sessionKey },
          data: { displayName, isAuthenticated },
        });
        return { ...updated, isNewSession: false };
      }
      return { ...existing, isNewSession: false };
    }
    const created = await prisma.chatSession.create({
      data: { sessionKey, displayName, isAuthenticated },
    });
    return { ...created, isNewSession: true };
  },

  async getRecentMessages(sessionId: string, limit: number) {
    const rows = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.reverse();
  },

  async appendMessage(
    sessionId: string,
    role: "USER" | "ASSISTANT",
    text: string,
    intent?: string | null,
    entities?: unknown
  ) {
    return prisma.chatMessage.create({
      data: { sessionId, role, text, intent: intent ?? null, entities: entities ?? undefined },
    });
  },

  async updateSlots(sessionId: string, slots: ConversationSlots) {
    return prisma.chatSession.update({
      where: { id: sessionId },
      data: { slots: slots as object },
    });
  },
};
