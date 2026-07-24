// Centralized configuration management via AppConfig table.
// Allows changing cooldowns, intervals, and timeouts without code changes.

import { prisma } from "../storage/prismaClient";

export interface AirlineConnectorConfig {
  defaultSyncIntervalMinutes: number;
  authCooldownMinutes: number;
  networkErrorBackoffMinutes: number;
  portalErrorBackoffMinutes: number;
  maxRetryAttempts: number;
  maxConcurrentSyncs: number;
}

export const ConfigService = {
  /**
   * Get all configuration for a module (e.g., 'airline-connectors').
   * Returns defaults if not set in database.
   */
  async getConfig(module: string): Promise<Record<string, unknown>> {
    const configs = await prisma.appConfig.findMany({ where: { module } });
    const result: Record<string, unknown> = {};

    for (const config of configs) {
      try {
        result[config.key] = JSON.parse(config.value);
      } catch {
        result[config.key] = config.value; // Fall back to string if not JSON
      }
    }

    return result;
  },

  /**
   * Get single config value with fallback to default.
   */
  async getConfigValue(
    module: string,
    key: string,
    defaultValue: unknown
  ): Promise<unknown> {
    const config = await prisma.appConfig.findUnique({
      where: { module_key: { module, key } },
    });

    if (!config) return defaultValue;

    try {
      return JSON.parse(config.value);
    } catch {
      return config.value;
    }
  },

  /**
   * Set a config value (creates or updates).
   */
  async setConfig(module: string, key: string, value: unknown): Promise<void> {
    await prisma.appConfig.upsert({
      where: { module_key: { module, key } },
      update: { value: JSON.stringify(value) },
      create: { module, key, value: JSON.stringify(value) },
    });
  },

  /**
   * Get all airline-connectors config with defaults.
   */
  async getAirlineConnectorConfig(): Promise<AirlineConnectorConfig> {
    const config = await this.getConfig("airline-connectors");

    return {
      defaultSyncIntervalMinutes:
        (config.defaultSyncIntervalMinutes as number) ?? 30,
      authCooldownMinutes: (config.authCooldownMinutes as number) ?? 300,
      networkErrorBackoffMinutes:
        (config.networkErrorBackoffMinutes as number) ?? 5,
      portalErrorBackoffMinutes: (config.portalErrorBackoffMinutes as number) ?? 30,
      maxRetryAttempts: (config.maxRetryAttempts as number) ?? 3,
      maxConcurrentSyncs: (config.maxConcurrentSyncs as number) ?? 3,
    };
  },

  /**
   * Set airline-connectors config.
   */
  async setAirlineConnectorConfig(
    config: Partial<AirlineConnectorConfig>
  ): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        await this.setConfig("airline-connectors", key, value);
      }
    }
  },
};
