import { describe, it, expect } from "@jest/globals";
import { ErrorClassificationService } from "../ErrorClassificationService";

describe("ErrorClassificationService", () => {
  describe("classify", () => {
    describe("AUTH errors", () => {
      it("should classify invalid password as AUTH", () => {
        const result = ErrorClassificationService.classify("Invalid password");
        expect(result.category).toBe("AUTH");
        expect(result.code).toBe("INVALID_PASSWORD");
        expect(result.isRetryable).toBe(false);
        expect(result.shouldEnterCooldown).toBe(true);
      });

      it("should classify unauthorized as AUTH", () => {
        const result = ErrorClassificationService.classify("Unauthorized");
        expect(result.category).toBe("AUTH");
        expect(result.isRetryable).toBe(false);
        expect(result.shouldEnterCooldown).toBe(true);
      });

      it("should classify expired credentials as AUTH", () => {
        const result = ErrorClassificationService.classify("Credentials expired");
        expect(result.category).toBe("AUTH");
        expect(result.code).toBe("CREDENTIALS_EXPIRED");
        expect(result.shouldEnterCooldown).toBe(true);
      });

      it("should classify authentication failed as AUTH", () => {
        const result = ErrorClassificationService.classify("Authentication failed - invalid username");
        expect(result.category).toBe("AUTH");
        expect(result.shouldEnterCooldown).toBe(true);
      });

      it("should be case insensitive", () => {
        const result = ErrorClassificationService.classify("INVALID PASSWORD");
        expect(result.category).toBe("AUTH");
        expect(result.shouldEnterCooldown).toBe(true);
      });
    });

    describe("NETWORK errors", () => {
      it("should classify timeout as NETWORK", () => {
        const result = ErrorClassificationService.classify("Request timeout");
        expect(result.category).toBe("NETWORK");
        expect(result.code).toBe("TIMEOUT");
        expect(result.isRetryable).toBe(true);
        expect(result.shouldEnterCooldown).toBe(false);
        expect(result.suggestedBackoffMs).toBe(5 * 60 * 1000);
      });

      it("should classify connection refused as NETWORK", () => {
        const result = ErrorClassificationService.classify("ECONNREFUSED: Connection refused");
        expect(result.category).toBe("NETWORK");
        expect(result.code).toBe("CONNECTION_REFUSED");
        expect(result.isRetryable).toBe(true);
      });

      it("should classify DNS failure as NETWORK", () => {
        const result = ErrorClassificationService.classify("ENOTFOUND: DNS lookup failed");
        expect(result.category).toBe("NETWORK");
        expect(result.code).toBe("DNS_FAILURE");
        expect(result.isRetryable).toBe(true);
      });

      it("should classify service unavailable as NETWORK", () => {
        const result = ErrorClassificationService.classify("Service temporarily unavailable");
        expect(result.category).toBe("NETWORK");
        expect(result.code).toBe("SERVICE_UNAVAILABLE");
        expect(result.isRetryable).toBe(true);
      });
    });

    describe("PORTAL errors", () => {
      it("should classify maintenance as PORTAL", () => {
        const result = ErrorClassificationService.classify("Portal under maintenance");
        expect(result.category).toBe("PORTAL");
        expect(result.code).toBe("MAINTENANCE_MODE");
        expect(result.isRetryable).toBe(true);
        expect(result.shouldEnterCooldown).toBe(false);
        expect(result.suggestedBackoffMs).toBe(30 * 60 * 1000);
      });

      it("should classify CAPTCHA detected as PORTAL", () => {
        const result = ErrorClassificationService.classify("CAPTCHA detected on page");
        expect(result.category).toBe("PORTAL");
        expect(result.code).toBe("CAPTCHA_DETECTED");
        expect(result.isRetryable).toBe(true);
      });

      it("should classify HTML parsing failed as PORTAL", () => {
        const result = ErrorClassificationService.classify("HTML structure changed - selector not found");
        expect(result.category).toBe("PORTAL");
        expect(result.code).toBe("HTML_PARSING_FAILED");
        expect(result.isRetryable).toBe(true);
      });

      it("should classify unexpected HTML as PORTAL", () => {
        const result = ErrorClassificationService.classify("Unexpected HTML response");
        expect(result.category).toBe("PORTAL");
        expect(result.isRetryable).toBe(true);
      });
    });

    describe("UNKNOWN errors", () => {
      it("should classify unknown error as UNKNOWN", () => {
        const result = ErrorClassificationService.classify("Something went wrong");
        expect(result.category).toBe("UNKNOWN");
        expect(result.code).toBe("UNKNOWN");
        expect(result.isRetryable).toBe(true);
        expect(result.shouldEnterCooldown).toBe(false);
      });

      it("should classify null/undefined safely", () => {
        const result = ErrorClassificationService.classify(null as any);
        expect(result.category).toBe("UNKNOWN");
      });
    });

    describe("boundary cases", () => {
      it("should handle error objects", () => {
        const error = new Error("Invalid password for user");
        const result = ErrorClassificationService.classify(error);
        expect(result.category).toBe("AUTH");
      });

      it("should distinguish network vs auth on edge case", () => {
        // "unauthorized network" should be AUTH, not NETWORK
        const result = ErrorClassificationService.classify("Unauthorized to access network");
        expect(result.category).toBe("AUTH");
      });

      it("should prioritize auth over portal", () => {
        // "Unauthorized access to portal" should be AUTH
        const result = ErrorClassificationService.classify("Unauthorized access to portal");
        expect(result.category).toBe("AUTH");
      });
    });
  });
});
