"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorRegistry = void 0;
const AirPeaceConnector_1 = require("../connectors/airpeace/AirPeaceConnector");
const AeroConnector_1 = require("../connectors/aero/AeroConnector");
const ArikConnector_1 = require("../connectors/arik/ArikConnector");
const IbomConnector_1 = require("../connectors/ibom/IbomConnector");
const NGEagleConnector_1 = require("../connectors/ngeagle/NGEagleConnector");
const EnuguConnector_1 = require("../connectors/enugu/EnuguConnector");
const UnitedConnector_1 = require("../connectors/united/UnitedConnector");
const RanoConnector_1 = require("../connectors/rano/RanoConnector");
const XeJetConnector_1 = require("../connectors/xejet/XeJetConnector");
/**
 * Simple DI container / factory. SyncService and API routes ask this
 * registry for a connector by AirlineKey — they never import a concrete
 * connector class directly. That's what makes adding Category B airlines
 * later a registry-only change (see connectors/README.md).
 */
const factories = {
    AIRPEACE: () => new AirPeaceConnector_1.AirPeaceConnector(),
    AERO: () => new AeroConnector_1.AeroConnector(),
    ARIK: () => new ArikConnector_1.ArikConnector(),
    IBOM: () => new IbomConnector_1.IbomConnector(),
    NGEAGLE: () => new NGEagleConnector_1.NGEagleConnector(),
    ENUGU: () => new EnuguConnector_1.EnuguConnector(),
    UNITED: () => new UnitedConnector_1.UnitedConnector(),
    RANO: () => new RanoConnector_1.RanoConnector(),
    XEJET: () => new XeJetConnector_1.XeJetConnector(),
};
exports.ConnectorRegistry = {
    create(airline) {
        const factory = factories[airline];
        if (!factory) {
            throw new Error(`No connector registered for "${airline}". If this is a Category B airline, ` +
                `see connectors/README.md — it hasn't been implemented yet.`);
        }
        return factory();
    },
    listAll() {
        return Object.keys(factories).map((airline) => {
            const instance = factories[airline]();
            return { airline, displayName: instance.displayName };
        });
    },
    isImplemented(airline) {
        return airline in factories;
    },
    getDisplayName(airline) {
        const instance = factories[airline]();
        return instance.displayName;
    },
};
