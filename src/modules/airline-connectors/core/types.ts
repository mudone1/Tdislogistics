// Shared types for the Airline Connector Framework.
// Kept framework-agnostic of Prisma's generated types so `core`/`interfaces`
// don't need to import the Prisma client — only `storage` does.

export type AirlineKey = "AIRPEACE" | "AERO" | "ARIK" | "IBOM" | "NGEAGLE" | "ENUGU";

// Category B airlines (United, Rano, XEJet) are still NOT part of
// AirlineKey — see connectors/README.md. ENUGU is the first Category B
// airline implemented (its own connector, extending BaseConnector
// directly rather than BaseCraneConnector — a different platform
// entirely: a VARS/Videcom ASP.NET WebForms agent portal, not Crane).

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
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
