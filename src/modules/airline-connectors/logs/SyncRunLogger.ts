import type { AirlineKey } from "../core/types";

export type LogLevel = "info" | "warn" | "error";

export interface SyncLogLine {
  airline: AirlineKey;
  runId: string;
  step: string;
  message: string;
  level: LogLevel;
  createdAt: Date;
}

export const SYNC_STEPS = {
  LOGIN_STARTED: "LOGIN_STARTED",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  NAVIGATION: "NAVIGATION",
  BALANCE_RETRIEVED: "BALANCE_RETRIEVED",
  BALANCE_SAVED: "BALANCE_SAVED",
  LOGOUT: "LOGOUT",
  ERROR: "ERROR",
} as const;

/**
 * A logger scoped to a single sync run. Buffers in memory during the run
 * (so a crashed browser doesn't lose partial logs mid-write) and is
 * persisted in one batch insert by SyncService once the run finishes,
 * success or fail.
 */
export class SyncRunLogger {
  private lines: SyncLogLine[] = [];

  constructor(
    private readonly airline: AirlineKey,
    private readonly runId: string
  ) {}

  log(step: string, message: string, level: LogLevel = "info") {
    const line: SyncLogLine = { airline: this.airline, runId: this.runId, step, message, level, createdAt: new Date() };
    this.lines.push(line);
    const tag = `[connector:${this.airline}:${this.runId.slice(0, 8)}]`;
    if (level === "error") console.error(tag, step, message);
    else if (level === "warn") console.warn(tag, step, message);
    else console.log(tag, step, message);
  }

  getLines(): SyncLogLine[] {
    return this.lines;
  }
}
