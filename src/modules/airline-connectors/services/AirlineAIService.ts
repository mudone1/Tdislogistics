// AI-friendly service layer for airline balance and sync queries.
// Used by: ConversationOrchestrator, AI chatbot
// Provides structured responses for LLM consumption.

import { AirlineBalanceService } from "./AirlineBalanceService";
import { SyncHistoryService } from "./SyncHistoryService";
import { ConnectorRegistry } from "./ConnectorRegistry";
import type { AirlineKey } from "../core/types";

export interface AirlineQueryResponse {
  type: "balance" | "status" | "history" | "statistics";
  data: any;
  message: string;
  airlinesQueried: string[];
  timestamp: Date;
}

export const AirlineAIService = {
  /**
   * "Show failed airlines today"
   * Get airlines that failed sync today.
   */
  async getFailedAirlinesToday(): Promise<AirlineQueryResponse> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const failures = await SyncHistoryService.getAuthFailures(today);

    const groupedByAirline = new Map<string, any>();
    failures.forEach((failure) => {
      if (!groupedByAirline.has(failure.airline)) {
        groupedByAirline.set(failure.airline, []);
      }
      groupedByAirline.get(failure.airline)!.push(failure);
    });

    const result = Array.from(groupedByAirline.entries()).map(([airline, history]) => ({
      airline,
      failureCount: history.length,
      lastFailure: history[0],
      errorCategories: [...new Set(history.map((h: any) => h.errorCategory))],
    }));

    return {
      type: "status",
      data: result,
      message: `${result.length} airline${result.length === 1 ? "" : "s"} failed sync today`,
      airlinesQueried: Array.from(groupedByAirline.keys()),
      timestamp: new Date(),
    };
  },

  /**
   * "Which airline hasn't synced for 3 days?"
   * Get stale airlines (not synced in N days).
   */
  async getOutdatedAirlines(daysOld: number = 3): Promise<AirlineQueryResponse> {
    const minutesOld = daysOld * 24 * 60;
    const outdated = await SyncHistoryService.getOutdatedAirlines(minutesOld);

    const result = outdated.map((airline) => ({
      airline: airline.airline,
      displayName: ConnectorRegistry.getDisplayName(airline.airline),
      lastSynced: airline.lastSynced,
      daysSinceSyncAsOf: daysOld,
    }));

    return {
      type: "status",
      data: result,
      message: `${result.length} airline${result.length === 1 ? "" : "s"} not synced for ${daysOld} day${daysOld === 1 ? "" : "s"}`,
      airlinesQueried: result.map((r) => r.airline),
      timestamp: new Date(),
    };
  },

  /**
   * "Which airline changed balance today?"
   * Get airlines with balance movements today.
   */
  async getAirlinesChangedToday(): Promise<AirlineQueryResponse> {
    const changed = await SyncHistoryService.getAirlinesChangedToday();

    const result = changed.map((entry) => ({
      airline: entry.airline,
      displayName: ConnectorRegistry.getDisplayName(entry.airline),
      newBalance: entry.balance,
      previousBalance: entry.previousBalance,
      change: entry.balance.minus(entry.previousBalance || 0),
      changePercentage:
        entry.previousBalance && entry.previousBalance.gt(0)
          ? entry.balance
              .minus(entry.previousBalance)
              .dividedBy(entry.previousBalance)
              .times(100)
              .toNumber()
          : 0,
    }));

    const increases = result.filter((r) => r.change.gt(0));
    const decreases = result.filter((r) => r.change.lt(0));

    return {
      type: "status",
      data: { all: result, increases, decreases },
      message: `${result.length} airline${result.length === 1 ? "" : "s"} changed balance today (${increases.length} up, ${decreases.length} down)`,
      airlinesQueried: result.map((r) => r.airline),
      timestamp: new Date(),
    };
  },

  /**
   * "Show auth failures this week"
   * Get authentication failures in date range.
   */
  async getAuthFailuresSince(daysBack: number = 7): Promise<AirlineQueryResponse> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const failures = await SyncHistoryService.getAuthFailures(since);

    const groupedByAirline = new Map<string, any[]>();
    failures.forEach((failure) => {
      if (!groupedByAirline.has(failure.airline)) {
        groupedByAirline.set(failure.airline, []);
      }
      groupedByAirline.get(failure.airline)!.push(failure);
    });

    const result = Array.from(groupedByAirline.entries())
      .map(([airline, history]) => ({
        airline,
        displayName: ConnectorRegistry.getDisplayName(airline as AirlineKey),
        failureCount: history.length,
        failures: history.map((h: any) => ({
          timestamp: h.retrievedAt,
          error: h.errorMessage,
          errorCode: h.errorCode,
        })),
      }))
      .sort((a, b) => b.failureCount - a.failureCount);

    return {
      type: "history",
      data: result,
      message: `${result.length} airline${result.length === 1 ? "" : "s"} with auth failures in past ${daysBack} day${daysBack === 1 ? "" : "s"}`,
      airlinesQueried: result.map((r) => r.airline),
      timestamp: new Date(),
    };
  },

  /**
   * "Which airline failed most often this month?"
   * Get most problematic airline (highest failure count).
   */
  async getMostProblematicAirline(daysBack: number = 30): Promise<AirlineQueryResponse> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const problematic = await SyncHistoryService.getMostProblematicAirline(since);

    if (!problematic) {
      return {
        type: "statistics",
        data: null,
        message: `No failures recorded in the past ${daysBack} days`,
        airlinesQueried: [],
        timestamp: new Date(),
      };
    }

    const result = {
      airline: problematic.airline,
      displayName: ConnectorRegistry.getDisplayName(problematic.airline as AirlineKey),
      failureCount: problematic._count,
      periodDays: daysBack,
    };

    return {
      type: "status",
      data: result,
      message: `${result.displayName} failed sync ${result.failureCount} times in the past ${daysBack} days`,
      airlinesQueried: [result.airline],
      timestamp: new Date(),
    };
  },

  /**
   * "What's the balance for [airline]?"
   * Get current balance with status.
   */
  async getAirlineBalance(airline: AirlineKey): Promise<AirlineQueryResponse> {
    if (!ConnectorRegistry.isImplemented(airline)) {
      throw new Error(`Unknown airline: ${airline}`);
    }

    const balance = await AirlineBalanceService.getBalance(airline);

    if (!balance) {
      return {
        type: "balance",
        data: null,
        message: `No balance data available for ${airline}`,
        airlinesQueried: [airline],
        timestamp: new Date(),
      };
    }

    return {
      type: "balance",
      data: {
        airline: balance.airline,
        displayName: balance.displayName,
        balance: balance.currentBalance,
        previousBalance: balance.previousBalance,
        change: balance.balanceChange,
        currency: balance.currency,
        lastSynced: balance.lastSynced,
        isInCooldown: balance.isInAuthCooldown,
        cooldownRemaining: balance.cooldownRemainingMs,
        cooldownMessage: balance.cooldownMessage,
      },
      message: `${balance.displayName} balance: ₦${Number(balance.currentBalance).toLocaleString()} (updated ${balance.lastSynced ? new Date(balance.lastSynced).toLocaleString("en-NG") : "never"})`,
      airlinesQueried: [airline],
      timestamp: new Date(),
    };
  },

  /**
   * "Show all airline balances"
   * Get summary of all airlines.
   */
  async getAllAirlineBalances(): Promise<AirlineQueryResponse> {
    const balances = await AirlineBalanceService.getAllBalances();
    const stats = await AirlineBalanceService.getBalanceStatistics();

    const result = balances.map((b) => ({
      airline: b.airline,
      displayName: b.displayName,
      balance: b.currentBalance,
      change: b.balanceChange,
      status: b.isInAuthCooldown ? "IN_COOLDOWN" : b.lastStatus,
    }));

    return {
      type: "statistics",
      data: {
        balances: result,
        summary: {
          totalAirlines: stats.totalAirlines,
          totalBalance: stats.total,
          averageBalance: stats.average,
          highestBalance: stats.highest,
          lowestBalance: stats.lowest,
          inAuthCooldown: stats.inAuthCooldown,
          neverSynced: stats.neverSynced,
        },
      },
      message: `${stats.totalAirlines} airlines tracked, total balance: ₦${Number(stats.total).toLocaleString()}`,
      airlinesQueried: result.map((r) => r.airline),
      timestamp: new Date(),
    };
  },

  /**
   * Detect intent and route to appropriate query handler.
   * Used by ConversationOrchestrator for intent-based dispatch.
   */
  async queryByIntent(intent: string, entities: Record<string, any>): Promise<AirlineQueryResponse> {
    const intent_lower = intent.toLowerCase();

    if (intent_lower.includes("auth") || intent_lower.includes("authentication") || intent_lower.includes("cooldown")) {
      const days = entities.days || 7;
      return this.getAuthFailuresSince(days);
    }

    if (intent_lower.includes("most") || intent_lower.includes("problematic") || intent_lower.includes("worst")) {
      const days = entities.days || 30;
      return this.getMostProblematicAirline(days);
    }

    if (intent_lower.includes("failed") || intent_lower.includes("fail")) {
      return this.getFailedAirlinesToday();
    }

    if (intent_lower.includes("outdated") || intent_lower.includes("synced") || intent_lower.includes("days")) {
      const days = entities.days || 3;
      return this.getOutdatedAirlines(days);
    }

    if (intent_lower.includes("changed") || intent_lower.includes("change") || intent_lower.includes("movement")) {
      return this.getAirlinesChangedToday();
    }

    if (intent_lower.includes("balance")) {
      if (entities.airline) {
        return this.getAirlineBalance(entities.airline as AirlineKey);
      } else {
        return this.getAllAirlineBalances();
      }
    }

    throw new Error(`Unknown query intent: ${intent}`);
  },
};
