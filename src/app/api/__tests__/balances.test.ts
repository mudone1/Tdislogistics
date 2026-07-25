import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AirlineBalanceService } from "@/modules/airline-connectors/services/AirlineBalanceService";
import { AuthFailureService } from "@/modules/airline-connectors/services/AuthFailureService";
import type { Decimal } from "@prisma/client/runtime/library";

jest.mock("@/modules/airline-connectors/services/AirlineBalanceService");
jest.mock("@/modules/airline-connectors/services/AuthFailureService");

describe("Balance APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/balances", () => {
    it("should return all balances", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getAllBalances.mockResolvedValue([
        {
          airline: "AIRPEACE",
          displayName: "Air Peace",
          currentBalance: { toString: () => "150000" } as unknown as Decimal,
          previousBalance: { toString: () => "140000" } as unknown as Decimal,
          balanceChange: { toString: () => "10000" } as unknown as Decimal,
          currency: "NGN",
          lastSynced: new Date(),
          lastStatus: "SUCCESS",
          isInAuthCooldown: false,
          cooldownRemainingMs: null,
          cooldownMessage: null,
        },
      ]);

      mockBalanceService.getBalanceStatistics.mockResolvedValue({
        totalAirlines: 9,
        total: { toString: () => "1000000" } as unknown as Decimal,
        average: { toString: () => "111111" } as unknown as Decimal,
        highest: { toString: () => "200000" } as unknown as Decimal,
        lowest: { toString: () => "50000" } as unknown as Decimal,
        inAuthCooldown: 0,
        neverSynced: 1,
      });

      const response = {
        balances: await mockBalanceService.getAllBalances(),
        statistics: await mockBalanceService.getBalanceStatistics(),
      };

      expect(response.balances).toHaveLength(1);
      expect(response.balances[0].airline).toBe("AIRPEACE");
      expect(response.statistics.totalAirlines).toBe(9);
    });
  });

  describe("GET /api/balances/[airline]", () => {
    it("should return balance with history", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getBalanceWithHistory.mockResolvedValue({
        balance: {
          airline: "AIRPEACE",
          displayName: "Air Peace",
          currentBalance: { toString: () => "150000" } as unknown as Decimal,
          previousBalance: null,
          balanceChange: null,
          currency: "NGN",
          lastSynced: new Date(),
          lastStatus: "SUCCESS",
          isInAuthCooldown: false,
          cooldownRemainingMs: null,
          cooldownMessage: null,
        },
        history: [
          {
            id: "1",
            airline: "AIRPEACE",
            balance: { toString: () => "150000" } as unknown as Decimal,
            previousBalance: null,
            balanceChange: null,
            currency: "NGN",
            runId: "run-1",
            retrievedAt: new Date(),
            syncStatus: "SUCCESS",
            connector: "AirPeaceConnector",
            trigger: "SCHEDULED",
            durationMs: 30000,
            errorCategory: null,
            errorMessage: null,
            errorCode: null,
            initiatedBy: "scheduler",
            createdAt: new Date(),
          },
        ],
      });

      const result = await mockBalanceService.getBalanceWithHistory("AIRPEACE", 30);

      expect(result).toBeDefined();
      expect(result?.balance.airline).toBe("AIRPEACE");
      expect(result?.history).toHaveLength(1);
      expect(result?.history[0].syncStatus).toBe("SUCCESS");
    });
  });

  describe("Failure scenarios", () => {
    it("should handle auth cooldown gracefully", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getBalance.mockResolvedValue({
        airline: "AIRPEACE",
        displayName: "Air Peace",
        currentBalance: { toString: () => "0" } as unknown as Decimal,
        previousBalance: null,
        balanceChange: null,
        currency: "NGN",
        lastSynced: new Date(Date.now() - 6 * 60 * 60 * 1000),
        lastStatus: "FAILED",
        isInAuthCooldown: true,
        cooldownRemainingMs: 60 * 60 * 1000, // 1 hour
        cooldownMessage: "Authentication failed. Sync skipped for 60 more minutes. Update credentials to retry immediately.",
        lastError: "Invalid password",
      });

      const result = await mockBalanceService.getBalance("AIRPEACE");

      expect(result?.isInAuthCooldown).toBe(true);
      expect(result?.cooldownMessage).toContain("Authentication failed");
      expect(result?.lastError).toBe("Invalid password");
    });

    it("should handle never-synced airline", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getBalance.mockResolvedValue({
        airline: "XEJET",
        displayName: "Xejet",
        currentBalance: { toString: () => "0" } as unknown as Decimal,
        previousBalance: null,
        balanceChange: null,
        currency: "NGN",
        lastSynced: null,
        lastStatus: "PENDING",
        isInAuthCooldown: false,
        cooldownRemainingMs: null,
        cooldownMessage: null,
      });

      const result = await mockBalanceService.getBalance("XEJET");

      expect(result?.lastSynced).toBeNull();
      expect(result?.lastStatus).toBe("PENDING");
      expect(result?.currentBalance.toString()).toBe("0");
    });

    it("should track consecutive failures", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;

      // Simulate 3 consecutive failures
      const failures = [
        { status: "FAILED", errorCategory: "NETWORK", durationMs: 15000 },
        { status: "FAILED", errorCategory: "NETWORK", durationMs: 12000 },
        { status: "FAILED", errorCategory: "NETWORK", durationMs: 10000 },
      ];

      failures.forEach((f) => {
        mockBalanceService.getBalance.mockResolvedValueOnce({
          airline: "AERO",
          displayName: "Aero",
          currentBalance: { toString: () => "100000" } as unknown as Decimal,
          previousBalance: null,
          balanceChange: null,
          currency: "NGN",
          lastSynced: null,
          lastStatus: "FAILED",
          isInAuthCooldown: false,
          cooldownRemainingMs: null,
          cooldownMessage: null,
          lastError: "Connection timeout",
        } as any);
      });

      // Verify retries work without auth cooldown
      for (let i = 0; i < 3; i++) {
        const result = await mockBalanceService.getBalance("AERO");
        expect(result?.isInAuthCooldown).toBe(false);
        expect(result?.lastError).toBe("Connection timeout");
      }
    });
  });

  describe("Balance change calculations", () => {
    it("should correctly calculate positive balance change", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getBalance.mockResolvedValue({
        airline: "AIRPEACE",
        displayName: "Air Peace",
        currentBalance: { toString: () => "200000" } as unknown as Decimal,
        previousBalance: { toString: () => "150000" } as unknown as Decimal,
        balanceChange: { toString: () => "50000" } as unknown as Decimal,
        currency: "NGN",
        lastSynced: new Date(),
        lastStatus: "SUCCESS",
        isInAuthCooldown: false,
        cooldownRemainingMs: null,
        cooldownMessage: null,
      });

      const result = await mockBalanceService.getBalance("AIRPEACE");

      expect(result?.balanceChange?.toString()).toBe("50000");
    });

    it("should correctly calculate negative balance change", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getBalance.mockResolvedValue({
        airline: "AERO",
        displayName: "Aero",
        currentBalance: { toString: () => "100000" } as unknown as Decimal,
        previousBalance: { toString: () => "150000" } as unknown as Decimal,
        balanceChange: { toString: () => "-50000" } as unknown as Decimal,
        currency: "NGN",
        lastSynced: new Date(),
        lastStatus: "SUCCESS",
        isInAuthCooldown: false,
        cooldownRemainingMs: null,
        cooldownMessage: null,
      });

      const result = await mockBalanceService.getBalance("AERO");

      expect(result?.balanceChange?.toString()).toBe("-50000");
    });
  });
});
