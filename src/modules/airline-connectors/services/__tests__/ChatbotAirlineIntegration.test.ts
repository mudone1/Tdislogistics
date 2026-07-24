import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ChatbotAirlineIntegration } from "../ChatbotAirlineIntegration";
import { AirlineAIService } from "../AirlineAIService";

jest.mock("../AirlineAIService");

describe("ChatbotAirlineIntegration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("extractIntent", () => {
    it("should extract FAILED_AIRLINES intent from 'failed' keyword", () => {
      const query = ChatbotAirlineIntegration.extractIntent("Show failed airlines");
      expect(query?.intent).toBe("FAILED_AIRLINES");
    });

    it("should extract OUTDATED_AIRLINES intent and parse days", () => {
      const query = ChatbotAirlineIntegration.extractIntent(
        "Which airlines haven't synced for 5 days?"
      );
      expect(query?.intent).toBe("OUTDATED_AIRLINES");
      expect(query?.entities.days).toBe(5);
    });

    it("should default to 3 days for OUTDATED_AIRLINES if not specified", () => {
      const query = ChatbotAirlineIntegration.extractIntent("Which airlines are outdated?");
      expect(query?.intent).toBe("OUTDATED_AIRLINES");
      expect(query?.entities.days).toBe(3);
    });

    it("should extract CHANGED_AIRLINES intent", () => {
      const query = ChatbotAirlineIntegration.extractIntent(
        "Which airlines changed balance today?"
      );
      expect(query?.intent).toBe("CHANGED_AIRLINES");
    });

    it("should extract AUTH_FAILURES intent", () => {
      const query = ChatbotAirlineIntegration.extractIntent("Show authentication failures");
      expect(query?.intent).toBe("AUTH_FAILURES");
    });

    it("should extract MOST_PROBLEMATIC intent", () => {
      const query = ChatbotAirlineIntegration.extractIntent(
        "Which airline failed most often this month?"
      );
      expect(query?.intent).toBe("MOST_PROBLEMATIC");
    });

    it("should extract AIRLINE_BALANCE intent with airline", () => {
      const query = ChatbotAirlineIntegration.extractIntent("What's the balance for AIRPEACE?");
      expect(query?.intent).toBe("AIRLINE_BALANCE");
      expect(query?.entities.airline).toBe("AIRPEACE");
    });

    it("should extract ALL_BALANCES intent when no airline specified", () => {
      const query = ChatbotAirlineIntegration.extractIntent("Show all airline balances");
      expect(query?.intent).toBe("ALL_BALANCES");
    });

    it("should return null for non-airline queries", () => {
      const query = ChatbotAirlineIntegration.extractIntent("What time is it?");
      expect(query).toBeNull();
    });
  });

  describe("handleQuery", () => {
    it("should call getFailedAirlinesToday for FAILED_AIRLINES intent", async () => {
      const mockAirlineAIService = AirlineAIService as jest.Mocked<typeof AirlineAIService>;
      mockAirlineAIService.getFailedAirlinesToday.mockResolvedValue({
        type: "status",
        data: [],
        message: "No failures",
        airlinesQueried: [],
        timestamp: new Date(),
      });

      const response = await ChatbotAirlineIntegration.handleQuery({
        intent: "FAILED_AIRLINES",
        entities: {},
      });

      expect(response.message).toBe("No failures");
      expect(mockAirlineAIService.getFailedAirlinesToday).toHaveBeenCalled();
    });

    it("should call getOutdatedAirlines for OUTDATED_AIRLINES intent", async () => {
      const mockAirlineAIService = AirlineAIService as jest.Mocked<typeof AirlineAIService>;
      mockAirlineAIService.getOutdatedAirlines.mockResolvedValue({
        type: "status",
        data: [],
        message: "No outdated airlines",
        airlinesQueried: [],
        timestamp: new Date(),
      });

      const response = await ChatbotAirlineIntegration.handleQuery({
        intent: "OUTDATED_AIRLINES",
        entities: { days: 5 },
      });

      expect(mockAirlineAIService.getOutdatedAirlines).toHaveBeenCalledWith(5);
    });

    it("should handle errors gracefully", async () => {
      const mockAirlineAIService = AirlineAIService as jest.Mocked<typeof AirlineAIService>;
      mockAirlineAIService.getFailedAirlinesToday.mockRejectedValue(new Error("Database error"));

      const response = await ChatbotAirlineIntegration.handleQuery({
        intent: "FAILED_AIRLINES",
        entities: {},
      });

      expect(response.message).toContain("error");
      expect(response.message).toContain("Database error");
    });
  });

  describe("processMessage", () => {
    it("should process airline query message", async () => {
      const mockAirlineAIService = AirlineAIService as jest.Mocked<typeof AirlineAIService>;
      mockAirlineAIService.getFailedAirlinesToday.mockResolvedValue({
        type: "status",
        data: [],
        message: "All systems operational",
        airlinesQueried: [],
        timestamp: new Date(),
      });

      const response = await ChatbotAirlineIntegration.processMessage(
        "Show me failed airlines"
      );

      expect(response).not.toBeNull();
      expect(response?.message).toBe("All systems operational");
    });

    it("should return null for non-airline queries", async () => {
      const response = await ChatbotAirlineIntegration.processMessage(
        "What's the weather today?"
      );
      expect(response).toBeNull();
    });
  });

  describe("getExampleQueries", () => {
    it("should return list of example queries", () => {
      const examples = ChatbotAirlineIntegration.getExampleQueries();
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0]).toContain("Show failed airlines");
    });
  });

  describe("formatResultForDisplay", () => {
    it("should format list result with multiple items", () => {
      const result = {
        message: "2 airlines found",
        data: [
          {
            airline: "AIRPEACE",
            displayName: "Air Peace",
            failureCount: 3,
            balance: 150000,
          },
          {
            airline: "AERO",
            displayName: "Aero",
            failureCount: 1,
            balance: 100000,
          },
        ],
        timestamp: new Date(),
      };

      const formatted = ChatbotAirlineIntegration.formatResultForDisplay(result);
      expect(formatted).toContain("2 airlines found");
      expect(formatted).toContain("Air Peace");
      expect(formatted).toContain("Aero");
      expect(formatted).toContain("3 failures");
      expect(formatted).toContain("1 failure");
    });

    it("should format single balance result", () => {
      const result = {
        message: "Air Peace balance: ₦150,000",
        data: {
          airline: "AIRPEACE",
          currency: "NGN",
          lastSynced: new Date().toISOString(),
          isInCooldown: false,
        },
        timestamp: new Date(),
      };

      const formatted = ChatbotAirlineIntegration.formatResultForDisplay(result);
      expect(formatted).toContain("NGN");
      expect(formatted).toContain("Last Synced");
    });

    it("should format summary result", () => {
      const result = {
        message: "9 airlines tracked",
        data: {
          summary: {
            totalBalance: { toLocaleString: () => "1,000,000" },
            averageBalance: { toLocaleString: () => "111,111" },
            highestBalance: { toLocaleString: () => "200,000" },
            lowestBalance: { toLocaleString: () => "50,000" },
            inAuthCooldown: 2,
            neverSynced: 1,
          },
        },
        timestamp: new Date(),
      };

      const formatted = ChatbotAirlineIntegration.formatResultForDisplay(result);
      expect(formatted).toContain("Total Balance");
      expect(formatted).toContain("1,000,000");
      expect(formatted).toContain("In Auth Cooldown");
      expect(formatted).toContain("2");
    });

    it("should return message only when no data provided", () => {
      const result = {
        message: "No data available",
        timestamp: new Date(),
      };

      const formatted = ChatbotAirlineIntegration.formatResultForDisplay(result);
      expect(formatted).toBe("No data available");
    });
  });
});
