// Shared types for the Airline Connector Framework.
// Kept framework-agnostic of Prisma's generated types so `core`/`interfaces`
// don't need to import the Prisma client — only `storage` does.

export type AirlineKey =
  | "AIRPEACE"
  | "AERO"
  | "ARIK"
  | "IBOM"
  | "NGEAGLE"
  | "ENUGU"
  | "UNITED"
  | "RANO"
  | "XEJET";

// Category B airlines (Enugu, United, Rano, XeJet) all share one
// platform — a VARS/Videcom ASP.NET WebForms agent portal, a different
// system entirely from the Crane airlines above — and so share one
// connector base (connectors/vars/BaseVarsConnector.ts) rather than
// BaseCraneConnector. See connectors/README.md.

export type SyncStatus = "SUCCESS" | "FAILED" | "IN_PROGRESS" | "PENDING";
export type SyncTrigger = "MANUAL" | "SCHEDULED";

export interface BalanceReading {
  totalBalance: number;
  currency: string;
  partnerCard?: string;
  invoiceReference?: string;
  srName?: string;
}

export interface SyncResult {
  airline: AirlineKey;
  status: SyncStatus;
  balance?: BalanceReading;
  error?: string;
  durationMs: number;
  runId: string;
}

export interface DecryptedCredentials {
  username: string;
  password: string;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly airline: AirlineKey,
    public readonly cause?: unknown,
    // Set on errors where retrying with the SAME credentials can't
    // possibly help (e.g. the portal rejected the login outright) — most
    // agent accounts have their password rotated every 2-3 months, so a
    // wrong-credentials failure almost always means the stored password
    // is stale, not a fluke worth retrying. retryWithBackoff stops
    // immediately when this is true, instead of hammering the live
    // portal with the same bad password up to 3 times (which risks
    // tripping the airline's own lockout policy).
    public readonly nonRetryable?: boolean
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
