// Categorizes errors into AUTH, NETWORK, PORTAL, or UNKNOWN
// to enable smart retry logic and cooldown management.

export type ErrorCategory = "AUTH" | "NETWORK" | "PORTAL" | "UNKNOWN";
export type ErrorCode =
  | "INVALID_PASSWORD"
  | "UNAUTHORIZED"
  | "CREDENTIALS_EXPIRED"
  | "TIMEOUT"
  | "DNS_FAILURE"
  | "CONNECTION_REFUSED"
  | "SERVICE_UNAVAILABLE"
  | "CAPTCHA_DETECTED"
  | "HTML_PARSING_FAILED"
  | "MAINTENANCE_MODE"
  | "UNKNOWN";

export interface ClassifiedError {
  category: ErrorCategory;
  code: ErrorCode;
  message: string;
  isRetryable: boolean;
  shouldEnterCooldown: boolean;
  suggestedBackoffMs: number;
}

export const ErrorClassificationService = {
  /**
   * Classify an error into a category with retry behavior.
   * Returns structured error info used by SyncService to decide:
   * - Whether to retry
   * - Whether to enter auth cooldown
   * - How long to wait before retrying
   */
  classify(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);

    // === AUTHENTICATION ERRORS ===
    const authPatterns = [
      /invalid\s+(password|credentials)/i,
      /unauthorized/i,
      /authentication\s+failed/i,
      /password\s+(changed|expired|incorrect)/i,
      /credentials?\s+(expired|invalid|incorrect)/i,
      /invalid\s+username/i,
      /account\s+(locked|disabled)/i,
      /login\s+(failed|incorrect)/i,
    ];

    if (authPatterns.some((p) => p.test(message))) {
      return {
        category: "AUTH",
        code: this.classifyAuthError(message),
        message,
        isRetryable: false,
        shouldEnterCooldown: true,
        suggestedBackoffMs: 0,
      };
    }

    // === NETWORK ERRORS ===
    const networkPatterns = [
      /timeout/i,
      /econnrefused|connection.*refused/i,
      /enotfound|dns.*failed/i,
      /econnreset|connection.*reset/i,
      /enetunreach|network.*unreachable/i,
      /socket.*hangup/i,
      /temporarily.*unavailable/i,
      /eaddrnotavail/i,
    ];

    if (networkPatterns.some((p) => p.test(message))) {
      return {
        category: "NETWORK",
        code: this.classifyNetworkError(message),
        message,
        isRetryable: true,
        shouldEnterCooldown: false,
        suggestedBackoffMs: 5 * 60 * 1000, // 5 min
      };
    }

    // === PORTAL ERRORS ===
    const portalPatterns = [
      /maintenance|under.*maintenance/i,
      /captcha|recaptcha/i,
      /parsing.*failed|html.*changed|structure.*changed/i,
      /unexpected.*html|unexpected.*response/i,
      /selector.*not.*found|element.*not.*found/i,
      /page.*did.*not.*load/i,
    ];

    if (portalPatterns.some((p) => p.test(message))) {
      return {
        category: "PORTAL",
        code: this.classifyPortalError(message),
        message,
        isRetryable: true,
        shouldEnterCooldown: false,
        suggestedBackoffMs: 30 * 60 * 1000, // 30 min
      };
    }

    // === UNKNOWN ===
    return {
      category: "UNKNOWN",
      code: "UNKNOWN",
      message,
      isRetryable: true,
      shouldEnterCooldown: false,
      suggestedBackoffMs: 5 * 60 * 1000, // 5 min
    };
  },

  classifyAuthError(message: string): ErrorCode {
    if (/password.*changed|changed.*password/i.test(message))
      return "INVALID_PASSWORD";
    if (/expired|expir/i.test(message)) return "CREDENTIALS_EXPIRED";
    if (/unauthorized|invalid.*credential/i.test(message))
      return "UNAUTHORIZED";
    return "INVALID_PASSWORD";
  },

  classifyNetworkError(message: string): ErrorCode {
    if (/timeout|timed out/i.test(message)) return "TIMEOUT";
    if (/dns|enotfound|not.*found/i.test(message)) return "DNS_FAILURE";
    if (/econnrefused|refused/i.test(message)) return "CONNECTION_REFUSED";
    if (/unavailable/i.test(message)) return "SERVICE_UNAVAILABLE";
    return "TIMEOUT";
  },

  classifyPortalError(message: string): ErrorCode {
    if (/captcha|recaptcha/i.test(message)) return "CAPTCHA_DETECTED";
    if (/parsing|html|structure|selector/i.test(message))
      return "HTML_PARSING_FAILED";
    if (/maintenance/i.test(message)) return "MAINTENANCE_MODE";
    return "MAINTENANCE_MODE";
  },
};
