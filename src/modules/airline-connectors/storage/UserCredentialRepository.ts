import { prisma } from "./prismaClient";
import type { AirlineKey } from "@prisma/client";

export const UserCredentialRepository = {
  async findByUserAndAirline(userId: string, airline: AirlineKey) {
    return prisma.userAirlineCredential.findUnique({
      where: {
        userId_airline: { userId, airline },
      },
    });
  },

  async listByUser(userId: string) {
    return prisma.userAirlineCredential.findMany({
      where: { userId },
    });
  },

  async listByAirline(airline: AirlineKey) {
    return prisma.userAirlineCredential.findMany({
      where: { airline },
    });
  },

  async upsert(
    userId: string,
    airline: AirlineKey,
    data: {
      encryptedUsername: string;
      encryptedPassword: string;
    }
  ) {
    return prisma.userAirlineCredential.upsert({
      where: {
        userId_airline: { userId, airline },
      },
      update: data,
      create: {
        userId,
        airline,
        ...data,
      },
    });
  },

  async delete(userId: string, airline: AirlineKey) {
    return prisma.userAirlineCredential.delete({
      where: {
        userId_airline: { userId, airline },
      },
    });
  },

  async setConnectionStatus(userId: string, airline: AirlineKey, status: "CONFIGURED" | "ERROR", errorMessage?: string) {
    return prisma.userAirlineCredential.update({
      where: {
        userId_airline: { userId, airline },
      },
      data: {
        connectionStatus: status,
        lastTestedAt: new Date(),
        lastTestError: errorMessage ?? null,
      },
    });
  },
};
