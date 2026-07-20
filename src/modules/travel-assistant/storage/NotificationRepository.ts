import { prisma } from "../../airline-connectors/storage/prismaClient";

export type NotificationKind = "QUOTE_GENERATED" | "SYSTEM_ALERT";

/**
 * Repository pattern — mirrors ChatMemoryRepository/FlightSearchHistoryRepository.
 */
export const NotificationRepository = {
  async create(sessionId: string, kind: NotificationKind, title: string, body: string, link?: unknown) {
    return prisma.appNotification.create({
      data: { sessionId, kind, title, body, link: (link as object) ?? undefined },
    });
  },

  async listForSession(sessionId: string, limit: number) {
    return prisma.appNotification.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async markRead(id: string) {
    return prisma.appNotification.update({ where: { id }, data: { read: true } });
  },

  async markAllRead(sessionId: string) {
    return prisma.appNotification.updateMany({ where: { sessionId, read: false }, data: { read: true } });
  },
};
