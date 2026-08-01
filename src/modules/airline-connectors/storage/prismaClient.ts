import { PrismaClient } from "@prisma/client";

// Deliberately standalone (no "@/lib/*" alias) so this module can be
// imported both from the Next.js app (src/app/api/connectors/...) and from
// the independently-deployed connector-service (connector-service/src/...)
// without either context needing to resolve the other's path aliases.
//
// Both processes point at the SAME PostgreSQL database (DATABASE_URL) —
// Postgres is the shared source of truth per the architecture: Airline
// Portal -> Connector Service -> PostgreSQL -> Sync Service -> Firestore.

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Neon (the current DATABASE_URL) is serverless — its compute suspends
// after idle and the FIRST connection after that takes a few seconds to
// wake it back up, surfacing as "Can't reach database server" on whatever
// query happens to be first. Matched narrowly to connection-ESTABLISHMENT
// failures only (never a generic timeout, which could mean a query ran
// server-side but the response was lost) — retrying a write is only safe
// when we're confident the original attempt never reached the server at
// all, which is exactly what this class of error means.
function isTransientConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /can't reach database server|econnrefused|connection.*(closed|reset|refused)/i.test(message);
}

function withRetry(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          let attempt = 0;
          for (;;) {
            try {
              return await query(args);
            } catch (err) {
              attempt++;
              if (attempt > MAX_RETRIES || !isTransientConnectionError(err)) throw err;
              console.warn(
                `[prisma] ${model}.${operation} hit a transient connection error (likely a Neon cold start) — retrying ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS * attempt}ms`
              );
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
          }
        },
      },
    },
  }) as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { __connectorPrisma?: PrismaClient };

export const prisma = globalForPrisma.__connectorPrisma ?? withRetry(new PrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.__connectorPrisma = prisma;
