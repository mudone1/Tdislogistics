import { NextResponse } from "next/server";
import { UserCredentialRepository } from "@/modules/airline-connectors/storage/UserCredentialRepository";
import { encryptSecret } from "@/modules/airline-connectors/services/CredentialService";
import type { AirlineKey } from "@prisma/client";

interface SaveCredentialBody {
  airline: string;
  username: string;
  password: string;
}

// Extract and verify Firebase ID token from Authorization header
async function verifyFirebaseToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    // For now, we'll trust the token from the client-side Firebase SDK.
    // In production, you should verify the token using Firebase Admin SDK:
    // const admin = require("firebase-admin");
    // const decoded = await admin.auth().verifyIdToken(token);
    // return decoded.uid;

    // TEMPORARY: Extract uid from token payload (not secure, for development only)
    // In production, uncomment the above and use Firebase Admin SDK
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return payload.sub || payload.uid;
  } catch (err) {
    return null;
  }
}

/**
 * POST /api/user/airline-credentials
 * Save user's airline credentials securely (encrypted).
 * Requires Firebase ID token in Authorization header: "Bearer {token}"
 */
export async function POST(req: Request) {
  const userId = await verifyFirebaseToken(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as SaveCredentialBody;

  if (!body.airline || !body.username || !body.password) {
    return NextResponse.json(
      { error: "Missing required fields: airline, username, password" },
      { status: 400 }
    );
  }

  const airline = body.airline.toUpperCase() as AirlineKey;

  try {
    const encrypted = {
      encryptedUsername: encryptSecret(body.username),
      encryptedPassword: encryptSecret(body.password),
    };

    await UserCredentialRepository.upsert(userId, airline, encrypted);

    return NextResponse.json(
      {
        success: true,
        message: `Credentials saved for ${airline}. Future bookings will use your account.`,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[user-credentials] save failed for ${userId}/${airline}:`, err);
    return NextResponse.json(
      { error: "Failed to save credentials" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user/airline-credentials
 * List all saved airline credentials (without revealing plaintext).
 */
export async function GET(req: Request) {
  const userId = await verifyFirebaseToken(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const credentials = await UserCredentialRepository.listByUser(userId);
    return NextResponse.json({
      credentials: credentials.map((c) => ({
        airline: c.airline,
        lastTestedAt: c.lastTestedAt,
        connectionStatus: c.connectionStatus,
        lastTestError: c.lastTestError,
      })),
    });
  } catch (err) {
    console.error(`[user-credentials] list failed for ${userId}:`, err);
    return NextResponse.json({ error: "Failed to list credentials" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/airline-credentials?airline=ENUGU
 * Remove saved credentials for an airline.
 */
export async function DELETE(req: Request) {
  const userId = await verifyFirebaseToken(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const airline = searchParams.get("airline");

  if (!airline) {
    return NextResponse.json({ error: "Missing airline parameter" }, { status: 400 });
  }

  try {
    await UserCredentialRepository.delete(userId, airline as AirlineKey);
    return NextResponse.json({
      success: true,
      message: `Credentials removed for ${airline}. Future bookings will use admin/agent account.`,
    });
  } catch (err) {
    console.error(`[user-credentials] delete failed for ${userId}/${airline}:`, err);
    return NextResponse.json({ error: "Failed to delete credentials" }, { status: 500 });
  }
}
