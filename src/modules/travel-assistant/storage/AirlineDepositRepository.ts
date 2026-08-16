import type { AirlineKey, Prisma } from "@prisma/client";
import { prisma } from "../../airline-connectors/storage/prismaClient";
import type { PaymentReceiptParseResult } from "../deposits/PaymentReceiptParser";
import { lagosToday } from "../deposits/lagosDate";

export interface RecordDepositInput {
  chatId: string;
  airline: AirlineKey;
  amount: number;
  screenshotMessageId: string | null;
  extraction: PaymentReceiptParseResult;
  isPaystack: boolean;
}

export type RecordDepositOutcome = { status: "recorded" } | { status: "duplicate" };

/**
 * Repository pattern — mirrors FlightSearchHistoryRepository/
 * AirlineWalletRepository. Only ever called once a payment has been tagged
 * "credited" (see whatsapp-service's depositTracking.ts and the
 * /api/assistant/deposits/tag route) — this module never itself decides
 * credited/not-credited, it just persists what's already been decided.
 */
export const AirlineDepositRepository = {
  /**
   * Writes a confirmed deposit. Returns "duplicate" instead of throwing
   * when this exact (chatId, screenshotMessageId) pair is already
   * recorded — a screenshot re-tagged "credited" a second time (re-
   * discussed, replied to again, etc.) must not double-count, and the
   * caller (the API route) turns this into an honest "already recorded"
   * reply rather than a 500.
   */
  async recordDeposit(input: RecordDepositInput): Promise<RecordDepositOutcome> {
    try {
      await prisma.airlineDeposit.create({
        data: {
          chatId: input.chatId,
          airline: input.airline,
          amount: input.amount,
          depositDateLagos: lagosToday(),
          paymentTime: input.extraction.paymentTime,
          referenceNumber: input.extraction.referenceNumber,
          narration: input.extraction.narration,
          bankChannel: input.extraction.bankChannel,
          isPaystack: input.isPaystack,
          screenshotMessageId: input.screenshotMessageId,
          rawExtraction: input.extraction as unknown as Prisma.InputJsonValue,
        },
      });
      return { status: "recorded" };
    } catch (err) {
      // P2002 = unique constraint violation on [chatId, screenshotMessageId]
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
        return { status: "duplicate" };
      }
      throw err;
    }
  },

  /** Every confirmed deposit recorded for this chat on this Lagos calendar day. */
  async getDepositsForDate(chatId: string, dateIso: string) {
    return prisma.airlineDeposit.findMany({
      where: { chatId, depositDateLagos: dateIso },
      orderBy: { receivedAt: "asc" },
    });
  },

  /**
   * True if this exact screenshot was already recorded — used as an extra
   * guard right before insert in case whatsapp-service's own in-memory
   * pending-cache got out of sync (e.g. a restart between the tag and the
   * write). screenshotMessageId is required here; a null-ID fallback-path
   * record has no reliable way to be checked this way and relies on the
   * caller's own in-memory state instead.
   */
  async isAlreadyRecorded(chatId: string, screenshotMessageId: string): Promise<boolean> {
    const existing = await prisma.airlineDeposit.findUnique({
      where: { chatId_screenshotMessageId: { chatId, screenshotMessageId } },
    });
    return existing !== null;
  },
};
