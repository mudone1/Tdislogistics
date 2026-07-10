import type { Request, Response, NextFunction } from "express";

/**
 * This API is internal-only — called by the Next.js app's server-side API
 * routes, never directly by a browser. Protected by a shared secret rather
 * than full user auth, since the caller here isn't a person, it's the
 * Next.js backend. Put this service behind a private network / VPC /
 * firewall rule in addition to this check where possible — a shared
 * secret alone is a reasonable baseline, not a complete security model.
 */
export function requireInternalApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CONNECTOR_SERVICE_API_KEY;
  if (!expected) {
    console.error("[auth] CONNECTOR_SERVICE_API_KEY is not set — refusing all requests until it is.");
    return res.status(500).json({ error: "Service misconfigured" });
  }

  const provided = req.header("x-internal-api-key");
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
