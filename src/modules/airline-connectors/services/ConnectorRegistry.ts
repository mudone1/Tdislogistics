import type { IAirlineConnector } from "../interfaces/IAirlineConnector";
import type { AirlineKey } from "../core/types";
import { AirPeaceConnector } from "../connectors/airpeace/AirPeaceConnector";
import { AeroConnector } from "../connectors/aero/AeroConnector";
import { ArikConnector } from "../connectors/arik/ArikConnector";
import { IbomConnector } from "../connectors/ibom/IbomConnector";
import { NGEagleConnector } from "../connectors/ngeagle/NGEagleConnector";

export interface ConnectorMeta {
  airline: AirlineKey;
  displayName: string;
}

/**
 * Simple DI container / factory. SyncService and API routes ask this
 * registry for a connector by AirlineKey — they never import a concrete
 * connector class directly. That's what makes adding Category B airlines
 * later a registry-only change (see connectors/README.md).
 */
const factories: Record<AirlineKey, () => IAirlineConnector> = {
  AIRPEACE: () => new AirPeaceConnector(),
  AERO: () => new AeroConnector(),
  ARIK: () => new ArikConnector(),
  IBOM: () => new IbomConnector(),
  NGEAGLE: () => new NGEagleConnector(),
};

export const ConnectorRegistry = {
  create(airline: AirlineKey): IAirlineConnector {
    const factory = factories[airline];
    if (!factory) {
      throw new Error(
        `No connector registered for "${airline}". If this is a Category B airline, ` +
          `see connectors/README.md — it hasn't been implemented yet.`
      );
    }
    return factory();
  },

  listAll(): ConnectorMeta[] {
    return (Object.keys(factories) as AirlineKey[]).map((airline) => {
      const instance = factories[airline]();
      return { airline, displayName: instance.displayName };
    });
  },

  isImplemented(airline: string): airline is AirlineKey {
    return airline in factories;
  },
};
