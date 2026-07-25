import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AuthFailureService } from "../AuthFailureService";
import { AirlineWalletRepository } from "../../storage/AirlineWalletRepository";
import { ConfigService } from "../ConfigService";

jest.mock("../../storage/AirlineWalletRepository");
jest.mock("../ConfigService");

describe("AuthFailureService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("recordAuthFailure", () => {
    it("should record auth failure and set cooldown", async () => {
      const mockConfigService = ConfigService as jest.Mocked<typeof ConfigService>;
      mockConfigService.getAirlineConnectorConfig.mockResolvedValue({
        defaultSyncIntervalMinutes: 30,
        authCooldownMinutes: 300,
        networkErrorBackoffMinutes: 5,
        portalErrorBackoffMinutes: 30,
        maxRetryAttempts: 3,
        maxConcurrentSyncs: 3,
      });

      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.upsertSettings.mockResolvedValue({} as any);

      await AuthFailureService.recordAuthFailure("AIRPEACE", "Invalid password");

      expect(mockRepo.upsertSettings).toHaveBeenCalledWith("AIRPEACE", {
        authFailureCount: 1,
        authFailureSince: expect.any(Date),
        authCooldownUntil: expect.any(Date),
      });

      const callArgs = mockRepo.upsertSettings.mock.calls[0][1];
      const cooldownDuration = callArgs.authCooldownUntil!.getTime() - callArgs.authFailureSince!.getTime();
      // Should be approximately 5 hours (300 minutes * 60 * 1000 ms)
      expect(cooldownDuration).toBeGreaterThan(5 * 60 * 60 * 1000 - 1000);
      expect(cooldownDuration).toBeLessThan(5 * 60 * 60 * 1000 + 1000);
    });

    it("should use configurable cooldown duration", async () => {
      const mockConfigService = ConfigService as jest.Mocked<typeof ConfigService>;
      mockConfigService.getAirlineConnectorConfig.mockResolvedValue({
        defaultSyncIntervalMinutes: 30,
        authCooldownMinutes: 60, // 1 hour instead of 5
        networkErrorBackoffMinutes: 5,
        portalErrorBackoffMinutes: 30,
        maxRetryAttempts: 3,
        maxConcurrentSyncs: 3,
      });

      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.upsertSettings.mockResolvedValue({} as any);

      await AuthFailureService.recordAuthFailure("AERO", "Unauthorized");

      const callArgs = mockRepo.upsertSettings.mock.calls[0][1];
      const cooldownDuration = callArgs.authCooldownUntil!.getTime() - callArgs.authFailureSince!.getTime();
      // Should be approximately 1 hour (60 minutes * 60 * 1000 ms)
      expect(cooldownDuration).toBeGreaterThan(60 * 60 * 1000 - 1000);
      expect(cooldownDuration).toBeLessThan(60 * 60 * 1000 + 1000);
    });
  });

  describe("isInAuthCooldown", () => {
    it("should return false when no cooldown set", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: null,
      } as any);

      const result = await AuthFailureService.isInAuthCooldown("AIRPEACE");
      expect(result).toBe(false);
    });

    it("should return true when in active cooldown", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: futureDate,
      } as any);

      const result = await AuthFailureService.isInAuthCooldown("AIRPEACE");
      expect(result).toBe(true);
    });

    it("should return false when cooldown expired", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: pastDate,
      } as any);

      const result = await AuthFailureService.isInAuthCooldown("AIRPEACE");
      expect(result).toBe(false);
    });
  });

  describe("getAuthCooldownRemaining", () => {
    it("should return milliseconds remaining", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      const futureDate = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: futureDate,
      } as any);

      const result = await AuthFailureService.getAuthCooldownRemaining("AIRPEACE");
      // Should be approximately 5 minutes
      expect(result).toBeGreaterThan(5 * 60 * 1000 - 1000);
      expect(result).toBeLessThan(5 * 60 * 1000 + 1000);
    });

    it("should return 0 when no cooldown", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: null,
      } as any);

      const result = await AuthFailureService.getAuthCooldownRemaining("AIRPEACE");
      expect(result).toBe(0);
    });

    it("should return 0 when expired", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: pastDate,
      } as any);

      const result = await AuthFailureService.getAuthCooldownRemaining("AIRPEACE");
      expect(result).toBe(0);
    });
  });

  describe("clearAuthCooldown", () => {
    it("should clear all auth failure state", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.upsertSettings.mockResolvedValue({} as any);

      await AuthFailureService.clearAuthCooldown("AIRPEACE");

      expect(mockRepo.upsertSettings).toHaveBeenCalledWith("AIRPEACE", {
        authFailureCount: 0,
        authFailureSince: null,
        authCooldownUntil: null,
        passwordUpdatedAt: expect.any(Date),
      });
    });
  });

  describe("getCooldownMessage", () => {
    it("should return message with remaining time", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      const futureDate = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: futureDate,
      } as any);

      const message = await AuthFailureService.getCooldownMessage("AIRPEACE");
      expect(message).toContain("Authentication failed");
      expect(message).toContain("5 more minute");
    });

    it("should return null when not in cooldown", async () => {
      const mockRepo = AirlineWalletRepository as jest.Mocked<typeof AirlineWalletRepository>;
      mockRepo.getSettings.mockResolvedValue({
        authCooldownUntil: null,
      } as any);

      const message = await AuthFailureService.getCooldownMessage("AIRPEACE");
      expect(message).toBeNull();
    });
  });
});
