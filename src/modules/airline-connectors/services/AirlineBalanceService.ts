// Single source of truth for balance data.
// Used by: Dashboard, Chatbot, Reports, Mobile app, etc.
// All features read from this service to ensure consistency.

import { Decimal } from "@prisma/client/runtime/library";
import { AirlineWalletRepository } from "../storage/AirlineWalletRepository";
import { AuthFailureService } from "./AuthFailureService";
import { ConnectorRegistry } from "./ConnectorRegistry";
import type { AirlineKey, SyncStatus } from "../core/types";

export interface AirlineBalance {
  airline: AirlineKey;
  displayName: string;
  currentBalance: Decimal;
  previousBalance: Decimal | null;
  balanceChange: Decimal | null;
  currency: string;
  lastSynced: Date | null;
  lastStatus: SyncStatus;
  isInAuthCooldown: boolean;
  cooldownRemainingMs: number | null;
  cooldownMessage: string | null;
  lastError?: string;
}

export const AirlineBalanceService = {
  /**
   * Get current balance for one airline.
   * Used by: Chatbot, Reports, Mobile API, etc.
   */
  async getBalance(airline: AirlineKey): Promise<AirlineBalance | null> {
    const wallet = await AirlineWalletRepository.getWallet(airline);
    if (!wallet) return null;

    const inCooldown = await AuthFailureService.isInAuthCooldown(airline);
    const cooldownRemaining = inCooldown
      ? await AuthFailureService.getAuthCooldownRemaining(airline)
      : null;
    const cooldownMessage = inCooldown
      ? await AuthFailureService.getCooldownMessage(airline)
      : null;

    // Get latest error
    const latestFailure = await AirlineWalletRepository.getLatestFailure(airline);

    // Calculate balance change
    const balanceChange =
      wallet.previousBalance !== null
        ? new Decimal(wallet.currentBalance).minus(wallet.previousBalance)
        : null;

    return {
      airline,
      displayName: ConnectorRegistry.getDisplayName(airline),
      currentBalance: wallet.currentBalance,
      previousBalance: wallet.previousBalance,
      balanceChange,
      currency: wallet.currency,
      lastSynced: wallet.lastSynced,
      lastStatus: wallet.lastStatus,
      isInAuthCooldown: inCooldown,
      cooldownRemainingMs: cooldownRemaining,
      cooldownMessage,
      lastError: latestFailure?.errorMessage ?? undefined,
    };
  },

  /**
   * Get balances for all airlines at once.
   * Used by: Dashboard (main balances view)
   */
  async getAllBalances(): Promise<AirlineBalance[]> {
    const airlines = ConnectorRegistry.listAll().map((m) => m.airline);
    const balances = await Promise.all(airlines.map((a) => this.getBalance(a)));
    return balances.filter((b) => b !== null) as AirlineBalance[];
  },

  /**
   * Get balance with historical data.
   * Used by: Reports, AI Assistant for trend analysis
   */
  async getBalanceWithHistory(airline: AirlineKey, limit = 30) {
    const balance = await this.getBalance(airline);
    if (!balance) return null;

    const history = await AirlineWalletRepository.getHistory(airline, limit);

    return { balance, history };
  },

  /**
   * Query balances with filters.
   * Used by: Reports, Analytics, AI queries
   */
  async queryBalances(filters: {
    airlines?: AirlineKey[];
    since?: Date;
    until?: Date;
    status?: SyncStatus;
    errorCategory?: string;
  }) {
    return AirlineWalletRepository.queryHistory(filters);
  },

  /**
   * Get balances for specific airlines.
   * Used by: Mobile API, specific report views
   */
  async getBalancesForAirlines(airlines: AirlineKey[]): Promise<AirlineBalance[]> {
    const balances = await Promise.all(
      airlines.map((a) => this.getBalance(a))
    );
    return balances.filter((b) => b !== null) as AirlineBalance[];
  },

  /**
   * Get total balance across all airlines.
   * Used by: Dashboard summary
   */
  async getTotalBalance(): Promise<Decimal> {
    const balances = await this.getAllBalances();
    return balances.reduce((sum, b) => sum.plus(b.currentBalance), new Decimal(0));
  },

  /**
   * Get balance statistics for analytics/AI.
   */
  async getBalanceStatistics() {
    const balances = await this.getAllBalances();

    const total = balances.reduce((s, b) => s.plus(b.currentBalance), new Decimal(0));
    const average = balances.length > 0 ? total.dividedBy(balances.length) : new Decimal(0);
    const highest = balances.reduce((max, b) => (b.currentBalance.gt(max) ? b.currentBalance : max), new Decimal(0));
    const lowest = balances.reduce((min, b) => (b.currentBalance.lt(min) ? b.currentBalance : min), new Decimal(Infinity));

    const inCooldown = balances.filter((b) => b.isInAuthCooldown).length;
    const neverSynced = balances.filter((b) => !b.lastSynced).length;

    return {
      totalAirlines: balances.length,
      total,
      average,
      highest,
      lowest,
      inAuthCooldown: inCooldown,
      neverSynced,
    };
  },
};
