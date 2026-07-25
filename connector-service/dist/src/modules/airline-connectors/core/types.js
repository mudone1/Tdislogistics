"use strict";
// Shared types for the Airline Connector Framework.
// Kept framework-agnostic of Prisma's generated types so `core`/`interfaces`
// don't need to import the Prisma client — only `storage` does.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorError = void 0;
class ConnectorError extends Error {
    step;
    airline;
    cause;
    nonRetryable;
    constructor(message, step, airline, cause, 
    // Set on errors where retrying with the SAME credentials can't
    // possibly help (e.g. the portal rejected the login outright) — most
    // agent accounts have their password rotated every 2-3 months, so a
    // wrong-credentials failure almost always means the stored password
    // is stale, not a fluke worth retrying. retryWithBackoff stops
    // immediately when this is true, instead of hammering the live
    // portal with the same bad password up to 3 times (which risks
    // tripping the airline's own lockout policy).
    nonRetryable) {
        super(message);
        this.step = step;
        this.airline = airline;
        this.cause = cause;
        this.nonRetryable = nonRetryable;
        this.name = "ConnectorError";
    }
}
exports.ConnectorError = ConnectorError;
