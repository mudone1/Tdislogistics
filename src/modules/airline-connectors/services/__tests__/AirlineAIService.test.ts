import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AirlineAIService } from "../AirlineAIService";
import { AirlineBalanceService } from "../AirlineBalanceService";
import { SyncHistoryService } from "../SyncHistoryService";
import { ConnectorRegistry } from "../ConnectorRegistry";

jest.mock("../AirlineBalanceService");
jest.mock("../SyncHistoryService");
jest.mock("../ConnectorRegistry");

describe("AirlineAIService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getFailedAirlinesToday", () => {
    it("should return airlines that failed sync today", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getAuthFailures.mockResolvedValue([
        {
          airline: "AIRPEACE",
          errorCategory: "AUTH",
          errorMessage: "Invalid password",
        },
        {
          airline: "AIRPEACE",
          errorCategory: "AUTH",
          errorMessage: "Unauthorized",
        },
        {
          airline: "AERO",
          errorCategory: "AUTH",
          errorMessage: "Session expired",
        },
      ] as any);

      const result = await AirlineAIService.getFailedAirlinesToday();

      expect(result.type).toBe("status");
      expect(result.data).toHaveLength(2);
      expect(result.data[0].airline).toBe("AIRPEACE");
      expect(result.data[0].failureCount).toBe(2);
      expect(result.airlinesQueried).toContain("AIRPEACE");
      expect(result.airlinesQueried).toContain("AERO");
    });
  });

  describe("getOutdatedAirlines", () => {
    it("should return airlines not synced for N days", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockSyncHistoryService.getOutdatedAirlines.mockResolvedValue([
        {
          airline: "AIRPEACE",
          lastSynced: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        },
        {
          airline: "AERO",
          lastSynced: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      ] as any);

      mockConnectorRegistry.getDisplayName.mockImplementation((airline: string) => {
        const names: Record<string, string> = {
          AIRPEACE: "Air Peace",
          AERO: "Aero",
        };
        return names[airline] || airline;
      });

      const result = await AirlineAIService.getOutdatedAirlines(3);

      expect(result.type).toBe("status");
      expect(result.data).toHaveLength(2);
      expect(result.message).toContain("2 airlines");
      expect(result.message).toContain("3 days");
    });
  });

  describe("getAirlinesChangedToday", () => {
    it("should return airlines with balance changes", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockSyncHistoryService.getAirlinesChangedToday.mockResolvedValue([
        {
          airline: "AIRPEACE",
          balance: { minus: () => ({ times: () => 0.1 } as any) } as any,
          previousBalance: { gt: () => true } as any,
        },
        {
          airline: "AERO",
          balance: { minus: () => ({ times: () => -0.05 } as any) } as any,
          previousBalance: { gt: () => true } as any,
        },
      ] as any);

      mockConnectorRegistry.getDisplayName.mockImplementation((airline: string) => {
        const names: Record<string, string> = { AIRPEACE: "Air Peace", AERO: "Aero" };
        return names[airline] || airline;
      });

      const result = await AirlineAIService.getAirlinesChangedToday();

      expect(result.type).toBe("status");
      expect(result.data.all).toHaveLength(2);
      expect(result.message).toContain("2 airlines");
    });
  });

  describe("getAuthFailuresSince", () => {
    it("should return auth failures from past N days", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockSyncHistoryService.getAuthFailures.mockResolvedValue([
        {
          airline: "AIRPEACE",
          errorMessage: "Invalid password",
          errorCode: "AUTH_001",
          retrievedAt: new Date(),
        },
        {
          airline: "AIRPEACE",
          errorMessage: "Unauthorized",
          errorCode: "AUTH_002",
          retrievedAt: new Date(),
        },
      ] as any);

      mockConnectorRegistry.getDisplayName.mockReturnValue("Air Peace");

      const result = await AirlineAIService.getAuthFailuresSince(7);

      expect(result.type).toBe("history");
      expect(result.data).toHaveLength(1);
      expect(result.data[0].airline).toBe("AIRPEACE");
      expect(result.data[0].failureCount).toBe(2);
      expect(result.message).toContain("7 days");
    });
  });

  describe("getMostProblematicAirline", () => {
    it("should return airline with most failures", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockSyncHistoryService.getMostProblematicAirline.mockResolvedValue({
        airline: "AIRPEACE",
        _count: 15,
      } as any);

      mockConnectorRegistry.getDisplayName.mockReturnValue("Air Peace");

      const result = await AirlineAIService.getMostProblematicAirline(30);

      expect(result.type).toBe("status");
      expect(result.data.airline).toBe("AIRPEACE");
      expect(result.data.failureCount).toBe(15);
      expect(result.message).toContain("Air Peace");
      expect(result.message).toContain("15 times");
    });

    it("should handle no failures case", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getMostProblematicAirline.mockResolvedValue(null);

      const result = await AirlineAIService.getMostProblematicAirline(30);

      expect(result.type).toBe("statistics");
      expect(result.data).toBeNull();
      expect(result.message).toContain("No failures");
    });
  });

  describe("getAirlineBalance", () => {
    it("should return current balance for airline", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockConnectorRegistry.isImplemented.mockReturnValue(true);
      mockBalanceService.getBalance.mockResolvedValue({
        airline: "AIRPEACE",
        displayName: "Air Peace",
        currentBalance: { toLocaleString: () => "150,000" } as any,
        previousBalance: { toLocaleString: () => "140,000" } as any,
        balanceChange: { toString: () => "10000" } as any,
        currency: "NGN",
        lastSynced: new Date(),
        isInAuthCooldown: false,
        cooldownRemainingMs: null,
        cooldownMessage: null,
      } as any);

      const result = await AirlineAIService.getAirlineBalance("AIRPEACE");

      expect(result.type).toBe("balance");
      expect(result.data.airline).toBe("AIRPEACE");
      expect(result.data.displayName).toBe("Air Peace");
      expect(result.message).toContain("Air Peace");
      expect(result.message).toContain("₦");
    });

    it("should throw on unknown airline", async () => {
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;
      mockConnectorRegistry.isImplemented.mockReturnValue(false);

      await expect(AirlineAIService.getAirlineBalance("UNKNOWN")).rejects.toThrow("Unknown airline");
    });
  });

  describe("getAllAirlineBalances", () => {
    it("should return summary of all airlines", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;

      mockBalanceService.getAllBalances.mockResolvedValue([
        {
          airline: "AIRPEACE",
          displayName: "Air Peace",
          currentBalance: { toString: () => "150000" } as any,
          balanceChange: { toString: () => "10000" } as any,
          isInAuthCooldown: false,
          lastStatus: "SUCCESS",
        },
        {
          airline: "AERO",
          displayName: "Aero",
          currentBalance: { toString: () => "100000" } as any,
          balanceChange: { toString: () => "-5000" } as any,
          isInAuthCooldown: false,
          lastStatus: "SUCCESS",
        },
      ] as any);

      mockBalanceService.getBalanceStatistics.mockResolvedValue({
        totalAirlines: 9,
        total: { toLocaleString: () => "1,000,000" } as any,
        average: { toLocaleString: () => "111,111" } as any,
        highest: { toLocaleString: () => "200,000" } as any,
        lowest: { toLocaleString: () => "50,000" } as any,
        inAuthCooldown: 0,
        neverSynced: 1,
      } as any);

      const result = await AirlineAIService.getAllAirlineBalances();

      expect(result.type).toBe("statistics");
      expect(result.data.balances).toHaveLength(2);
      expect(result.data.summary.totalAirlines).toBe(9);
      expect(result.message).toContain("9 airlines");
    });
  });

  describe("queryByIntent", () => {
    it("should route failed intent to getFailedAirlinesToday", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getAuthFailures.mockResolvedValue([]);

      const result = await AirlineAIService.queryByIntent("Show failed airlines", {});

      expect(result.type).toBe("status");
      expect(mockSyncHistoryService.getAuthFailures).toHaveBeenCalled();
    });

    it("should route outdated intent to getOutdatedAirlines", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getOutdatedAirlines.mockResolvedValue([]);

      const result = await AirlineAIService.queryByIntent("Which airlines haven't synced in 5 days?", { days: 5 });

      expect(result.type).toBe("status");
      expect(mockSyncHistoryService.getOutdatedAirlines).toHaveBeenCalled();
    });

    it("should route changed intent to getAirlinesChangedToday", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getAirlinesChangedToday.mockResolvedValue([]);

      const result = await AirlineAIService.queryByIntent("Which airlines changed balance today?", {});

      expect(result.type).toBe("status");
      expect(mockSyncHistoryService.getAirlinesChangedToday).toHaveBeenCalled();
    });

    it("should route auth intent to getAuthFailuresSince", async () => {
      const mockSyncHistoryService = SyncHistoryService as jest.Mocked<typeof SyncHistoryService>;
      mockSyncHistoryService.getAuthFailures.mockResolvedValue([]);

      const result = await AirlineAIService.queryByIntent("Show auth failures this week", {});

      expect(result.type).toBe("history");
      expect(mockSyncHistoryService.getAuthFailures).toHaveBeenCalled();
    });

    it("should route balance intent to getAirlineBalance when airline provided", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      const mockConnectorRegistry = ConnectorRegistry as jest.Mocked<typeof ConnectorRegistry>;

      mockConnectorRegistry.isImplemented.mockReturnValue(true);
      mockBalanceService.getBalance.mockResolvedValue(null);

      const result = await AirlineAIService.queryByIntent("What's the balance for AIRPEACE?", { airline: "AIRPEACE" });

      expect(result.type).toBe("balance");
      expect(mockBalanceService.getBalance).toHaveBeenCalledWith("AIRPEACE");
    });

    it("should route balance intent to getAllAirlineBalances when no airline provided", async () => {
      const mockBalanceService = AirlineBalanceService as jest.Mocked<typeof AirlineBalanceService>;
      mockBalanceService.getAllBalances.mockResolvedValue([]);
      mockBalanceService.getBalanceStatistics.mockResolvedValue({
        totalAirlines: 9,
      } as any);

      const result = await AirlineAIService.queryByIntent("Show all airline balances", {});

      expect(result.type).toBe("statistics");
      expect(mockBalanceService.getAllBalances).toHaveBeenCalled();
    });

    it("should throw on unknown intent", async () => {
      await expect(AirlineAIService.queryByIntent("Unknown intent", {})).rejects.toThrow("Unknown query intent");
    });
  });
});
