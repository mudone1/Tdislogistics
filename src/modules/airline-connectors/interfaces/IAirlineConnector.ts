import type { Page, Browser } from "playwright";
import type { AirlineKey, BalanceReading, DecryptedCredentials, SyncResult } from "../core/types";

/**
 * Every airline connector — regardless of which booking platform it
 * automates — implements this interface. The framework (scheduler,
 * SyncService, API routes) only ever depends on this interface, never on
 * a concrete connector class. New connectors (Category B, later) plug in
 * by implementing this interface and registering with ConnectorRegistry —
 * no existing code changes (Open/Closed Principle).
 */
export interface IAirlineConnector {
  readonly airline: AirlineKey;
  readonly displayName: string;

  /** Launch the browser and prepare a fresh page/context. */
  connect(): Promise<void>;

  /** Fill in and submit login credentials. */
  login(credentials: DecryptedCredentials): Promise<void>;

  /** Verify the session actually landed in an authenticated state. */
  isLoggedIn(): Promise<boolean>;

  /** Navigate to the balance report and read the current wallet balance. */
  syncBalance(): Promise<BalanceReading>;

  /** Optional — not all Phase 1 airlines expose a transaction list yet. */
  syncTransactions(): Promise<void>;

  /** Explicit logout, distinct from just closing the browser. */
  logout(): Promise<void>;

  /** Tear down the browser/context. Always called, even after failure. */
  disconnect(): Promise<void>;

  /**
   * Orchestrates the full connect -> login -> verify -> syncBalance ->
   * logout -> disconnect flow, with retry/backoff and structured logging.
   * This is what SyncService actually calls — implemented once on
   * BaseConnector, not per-connector.
   */
  runFullSync(credentials: DecryptedCredentials, runId: string): Promise<SyncResult>;
}

/** Internal handle a BaseConnector keeps to its live browser session. */
export interface BrowserSession {
  browser: Browser;
  page: Page;
}
