"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
// Deliberately standalone (no "@/lib/*" alias) so this module can be
// imported both from the Next.js app (src/app/api/connectors/...) and from
// the independently-deployed connector-service (connector-service/src/...)
// without either context needing to resolve the other's path aliases.
//
// Both processes point at the SAME PostgreSQL database (DATABASE_URL) —
// Postgres is the shared source of truth per the architecture: Airline
// Portal -> Connector Service -> PostgreSQL -> Sync Service -> Firestore.
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.__connectorPrisma ?? new client_1.PrismaClient();
if (process.env.NODE_ENV !== "production")
    globalForPrisma.__connectorPrisma = exports.prisma;
