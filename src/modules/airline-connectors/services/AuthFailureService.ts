// Manages authentication failure cooldown periods.
// When auth fails: enters cooldown, skips retries.
// When password updated: clears cooldown immediately.

import { AirlineWalletRepository } from "../storage/AirlineWalletRepository";
import { ConfigService } from "./ConfigService";
import type { AirlineKey } from "../core/types";

export const AuthFailureService = {
  /**
   * Record an authentication failure and enter cooldown period.
   * The cooldown duration comes from ConfigService (configurable).
   */
  async recordAuthFailure(airline: AirlineKey, errorMessage: string): Promise<void> {
    const config = await ConfigService.getAirlineConnectorConfig();
    const cooldownMs = config.authCooldownMinutes * 60 * 1000;
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + cooldownMs);

    await AirlineWalletRepository.upsertSettings(airline, {
      authFailureCount: 1, // Reset count to 1 for new failure
      authFailureSince: now,
      authCooldownUntil: cooldownUntil,
    });
  },

  /**
   * Check if airline is currently in authentication cooldown.
   */
  async isInAuthCooldown(airline: AirlineKey): Promise<boolean> {
    const settings = await AirlineWalletRepository.getSettings(airline);
    if (!settings?.authCooldownUntil) return false;
    return new Date() < settings.authCooldownUntil;
  },

  /**
   * Get milliseconds remaining in cooldown (0 if not in cooldown).
   */
  async getAuthCooldownRemaining(airline: AirlineKey): Promise<number> {
    const settings = await AirlineWalletRepository.getSettings(airline);
    if (!settings?.authCooldownUntil) return 0;
    const remaining = settings.authCooldownUntil.getTime() - Date.now();
    return Math.max(0, remaining);
  },

  /**
   * Clear authentication cooldown (e.g., when password is updated).
   * This allows the next sync to retry authentication immediately.
   */
  async clearAuthCooldown(airline: AirlineKey): Promise<void> {
    await AirlineWalletRepository.upsertSettings(airline, {
      authFailureCount: 0,
      authFailureSince: null,
      authCooldownUntil: null,
      passwordUpdatedAt: new Date(), // Track when password was updated
    });
  },

  /**
   * Get formatted message for cooldown status.
   */
  async getCooldownMessage(airline: AirlineKey): Promise<string | null> {
    if (!(await this.isInAuthCooldown(airline))) return null;

    const remaining = await this.getAuthCooldownRemaining(airline);
    const minutes = Math.ceil(remaining / 60 / 1000);

    return `Authentication failed. Sync skipped for ${minutes} more minute${minutes === 1 ? "" : "s"}. Update credentials to retry immediately.`;
  },
};
