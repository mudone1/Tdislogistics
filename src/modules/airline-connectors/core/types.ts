// Shared types for the Airline Connector Framework.
// Kept framework-agnostic of Prisma's generated types so `core`/`interfaces`
// don't need to import the Prisma client — only `storage` does.

export type AirlineKey = "AIRPEACE" | "AERO" | "ARIK" | "IBOM" | "NGEAGLE";

// Category B is intentionally NOT part of AirlineKey yet — see
// connectors/README.md. Adding a Category B airline later means adding a
// value here, a Prisma enum value, and a new connector class. Nothing in
// `core`, `scheduler`, or `services` needs to change (Open/Closed).

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
