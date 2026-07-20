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
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
