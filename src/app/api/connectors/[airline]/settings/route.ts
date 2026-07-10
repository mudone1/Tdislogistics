import { NextResponse } from "next/server";
import { AirlineWalletRepository } from "@/modules/airline-connectors/storage/AirlineWalletRepository";
import { ConnectorRegistry } from "@/modules/airline-connectors/services/ConnectorRegistry";
import { encryptSecret } from "@/modules/airline-connectors/services/CredentialService";
import type { AirlineKey } from "@/modules/airline-connectors/core/types";

interface SettingsPayload {
  enabled?: boolean;
  username?: string; // plaintext in the request body (HTTPS in transit) — encrypted before it touches the DB
  password?: string;
  syncIntervalMinutes?: number | null;
  dailyRunAtUtc?: string | null;
}

// Credentials arrive here as plaintext over the wire (same as any login
// form) but are AES-256-GCM encrypted immediately, before the Prisma write
// — see CredentialService.ts. Nothing plaintext ever reaches Postgres, and
// this route never echoes a password back in its response.
export async function POST(req: Request, { params }: { params: Promise<{ airline: string }> }) {
  const airline = (await params).airline.toUpperCase();
  if (!ConnectorRegistry.isImplemented(airline)) {
    return NextResponse.json(
      { error: `"${airline}" is not an implemented connector yet (Category B).` },
      { status: 404 }
    );
  }

  const payload = (await req.json().catch(() => ({}))) as SettingsPayload;

  try {
    const settings = await AirlineWalletRepository.upsertSettings(airline as AirlineKey, {
      enabled: payload.enabled,
      encryptedUsername: payload.username ? encryptSecret(payload.username) : undefined,
      encryptedPassword: payload.password ? encryptSecret(payload.password) : undefined,
      syncIntervalMinutes: payload.syncIntervalMinutes,
      dailyRunAtUtc: payload.dailyRunAtUtc,
    });

    return NextResponse.json({
      enabled: settings.enabled,
      hasCredentials: Boolean(settings.encryptedUsername && settings.encryptedPassword),
      syncIntervalMinutes: settings.syncIntervalMinutes,
      dailyRunAtUtc: settings.dailyRunAtUtc,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
