// Chatbot integration example showing how to use AirlineAIService for natural language queries.
// Use this as reference when integrating with ConversationOrchestrator.

import { AirlineAIService, type AirlineQueryResponse } from "./AirlineAIService";
import type { AirlineKey } from "../core/types";

// Natural language patterns that map to airline queries
export interface AirlineQuery {
  intent: string;
  entities: {
    airline?: AirlineKey;
    days?: number;
  };
}

export interface ChatbotResponse {
  message: string;
  data?: any;
  airlinesQueried?: string[];
  timestamp: Date;
}

export const ChatbotAirlineIntegration = {
  /**
   * Extract airline query intent from user message.
   * Called by ConversationOrchestrator when airline balance query is detected.
   */
  extractIntent(userMessage: string): AirlineQuery | null {
    const message = userMessage.toLowerCase();

    // Failed airlines query
    if (message.includes("fail") || message.includes("error")) {
      return { intent: "FAILED_AIRLINES", entities: {} };
    }

    // Outdated airlines query
    if (message.includes("synced") || message.includes("updated") || message.includes("outdated")) {
      const daysMatch = userMessage.match(/(\d+)\s*days?/i);
      return {
        intent: "OUTDATED_AIRLINES",
        entities: { days: daysMatch ? parseInt(daysMatch[1]) : 3 },
      };
    }

    // Changed airlines query
    if (message.includes("changed") || message.includes("change") || message.includes("movement")) {
      return { intent: "CHANGED_AIRLINES", entities: {} };
    }

    // Auth failures query
    if (message.includes("auth") || message.includes("authentication") || message.includes("password")) {
      const daysMatch = userMessage.match(/(\d+)\s*days?/i);
      return {
        intent: "AUTH_FAILURES",
        entities: { days: daysMatch ? parseInt(daysMatch[1]) : 7 },
      };
    }

    // Most problematic airline query
    if (message.includes("most") || message.includes("worst") || message.includes("problematic")) {
      const daysMatch = userMessage.match(/(\d+)\s*days?/i);
      return {
        intent: "MOST_PROBLEMATIC",
        entities: { days: daysMatch ? parseInt(daysMatch[1]) : 30 },
      };
    }

    // Individual airline balance query
    if (message.includes("balance") || message.includes("how much")) {
      const airlines = ["AIRPEACE", "AERO", "DANA", "XEJET", "UNITED", "AIRLINE", "MEDVIEW", "OVERLAND", "AZMAN"];
      for (const airline of airlines) {
        if (message.includes(airline.toLowerCase())) {
          return { intent: "AIRLINE_BALANCE", entities: { airline: airline as AirlineKey } };
        }
      }
      return { intent: "ALL_BALANCES", entities: {} };
    }

    // All balances query
    if (
      message.includes("show all") ||
      message.includes("summary") ||
      message.includes("total") ||
      message.includes("all airlines")
    ) {
      return { intent: "ALL_BALANCES", entities: {} };
    }

    return null;
  },

  /**
   * Handle airline query and format response for chatbot.
   * Called after intent is extracted.
   */
  async handleQuery(query: AirlineQuery): Promise<ChatbotResponse> {
    try {
      let result: AirlineQueryResponse;

      switch (query.intent) {
        case "FAILED_AIRLINES":
          result = await AirlineAIService.getFailedAirlinesToday();
          break;

        case "OUTDATED_AIRLINES":
          result = await AirlineAIService.getOutdatedAirlines(query.entities.days || 3);
          break;

        case "CHANGED_AIRLINES":
          result = await AirlineAIService.getAirlinesChangedToday();
          break;

        case "AUTH_FAILURES":
          result = await AirlineAIService.getAuthFailuresSince(query.entities.days || 7);
          break;

        case "MOST_PROBLEMATIC":
          result = await AirlineAIService.getMostProblematicAirline(query.entities.days || 30);
          break;

        case "AIRLINE_BALANCE":
          result = await AirlineAIService.getAirlineBalance(query.entities.airline!);
          break;

        case "ALL_BALANCES":
          result = await AirlineAIService.getAllAirlineBalances();
          break;

        default:
          throw new Error(`Unknown intent: ${query.intent}`);
      }

      return {
        message: result.message,
        data: result.data,
        airlinesQueried: result.airlinesQueried,
        timestamp: result.timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        message: `I encountered an error while fetching airline data: ${errorMessage}`,
        timestamp: new Date(),
      };
    }
  },

  /**
   * Main entry point for chatbot integration.
   * Called by ConversationOrchestrator with user message.
   */
  async processMessage(userMessage: string): Promise<ChatbotResponse | null> {
    const query = this.extractIntent(userMessage);
    if (!query) {
      return null; // Not an airline query
    }

    return this.handleQuery(query);
  },

  /**
   * Get example queries that the chatbot understands.
   * Use in chatbot help/suggestions.
   */
  getExampleQueries(): string[] {
    return [
      "Show failed airlines today",
      "Which airlines haven't synced for 3 days?",
      "Which airlines changed balance today?",
      "Show auth failures this week",
      "Which airline has failed most often this month?",
      "What's the balance for AIRPEACE?",
      "Show all airline balances",
      "Summary of all airlines",
    ];
  },

  /**
   * Format result data for UI display.
   * Called when rendering result in chatbot interface.
   */
  formatResultForDisplay(result: ChatbotResponse): string {
    if (!result.data) {
      return result.message;
    }

    if (Array.isArray(result.data)) {
      // Handle list results (failed airlines, outdated, etc.)
      let formatted = result.message + "\n\n";
      result.data.forEach((item, index) => {
        if (item.airline && item.displayName) {
          formatted += `${index + 1}. **${item.displayName}** (${item.airline})`;
          if (item.failureCount) formatted += ` - ${item.failureCount} failure${item.failureCount > 1 ? "s" : ""}`;
          if (item.balance) formatted += ` - Balance: ₦${item.balance.toLocaleString()}`;
          formatted += "\n";
        }
      });
      return formatted;
    }

    // Handle single result (individual airline balance)
    if (result.data.airline) {
      return (
        result.message +
        "\n\n" +
        `**Currency:** ${result.data.currency}\n` +
        `**Last Synced:** ${result.data.lastSynced ? new Date(result.data.lastSynced).toLocaleString() : "Never"}\n` +
        (result.data.isInCooldown ? `**Status:** In Authentication Cooldown\n${result.data.cooldownMessage}\n` : "")
      );
    }

    // Handle summary (all balances)
    if (result.data.summary) {
      return (
        result.message +
        "\n\n" +
        `**Total Balance:** ₦${result.data.summary.totalBalance.toLocaleString()}\n` +
        `**Average Balance:** ₦${result.data.summary.averageBalance.toLocaleString()}\n` +
        `**Highest Balance:** ₦${result.data.summary.highestBalance.toLocaleString()}\n` +
        `**Lowest Balance:** ₦${result.data.summary.lowestBalance.toLocaleString()}\n` +
        `**In Auth Cooldown:** ${result.data.summary.inAuthCooldown}\n` +
        `**Never Synced:** ${result.data.summary.neverSynced}`
      );
    }

    return result.message;
  },
};
