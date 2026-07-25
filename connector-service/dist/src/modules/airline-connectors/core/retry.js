"use strict";
// Generic retry helper — used by BaseConnector around each sync attempt.
// Max 3 attempts, exponential backoff (1s, 2s, 4s) as specified.
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWithBackoff = retryWithBackoff;
// Duck-typed rather than `instanceof ConnectorError` so this generic helper
// doesn't need to import that class — any thrown error with this shape
// (see ConnectorError.nonRetryable) skips the remaining attempts.
function isNonRetryable(err) {
    return typeof err === "object" && err !== null && err.nonRetryable === true;
}
async function retryWithBackoff(fn, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? 3;
    const baseDelayMs = opts.baseDelayMs ?? 1000;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            opts.onRetry?.(attempt, err);
            if (isNonRetryable(err))
                break;
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}
