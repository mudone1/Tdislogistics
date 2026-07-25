"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncRunLogger = exports.SYNC_STEPS = void 0;
exports.SYNC_STEPS = {
    LOGIN_STARTED: "LOGIN_STARTED",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    NAVIGATION: "NAVIGATION",
    BALANCE_RETRIEVED: "BALANCE_RETRIEVED",
    BALANCE_SAVED: "BALANCE_SAVED",
    LOGOUT: "LOGOUT",
    ERROR: "ERROR",
};
/**
 * A logger scoped to a single sync run. Buffers in memory during the run
 * (so a crashed browser doesn't lose partial logs mid-write) and is
 * persisted in one batch insert by SyncService once the run finishes,
 * success or fail.
 */
class SyncRunLogger {
    airline;
    runId;
    lines = [];
    constructor(airline, runId) {
        this.airline = airline;
        this.runId = runId;
    }
    log(step, message, level = "info") {
        const line = { airline: this.airline, runId: this.runId, step, message, level, createdAt: new Date() };
        this.lines.push(line);
        const tag = `[connector:${this.airline}:${this.runId.slice(0, 8)}]`;
        if (level === "error")
            console.error(tag, step, message);
        else if (level === "warn")
            console.warn(tag, step, message);
        else
            console.log(tag, step, message);
    }
    getLines() {
        return this.lines;
    }
}
exports.SyncRunLogger = SyncRunLogger;
