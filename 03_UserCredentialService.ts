/**
 * src/modules/airline-connectors/services/UserCredentialService.ts
 *
 * Manages per-user airline credentials with encryption.
 *
 * Each user can save their own airline account credentials, which are encrypted
 * with AES-256-GCM. Credentials are:
 * - Encrypted at rest in the database
 * - Decrypted just-in-time when needed for automation
 * - Never logged or included in responses
 * - Immediately discarded after use
 */

import crypto from "crypto";
import { prisma } from "../../../lib/prisma";
import type { AirlineKey } from "../core/types";

/**
 * Encryption key management.
 * In production, fetch from AWS Secrets Manager / environment.
 * The key is 32 bytes (256 bits) for AES-256.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    // 64 hex chars = 32 bytes
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be set and be 64 hex characters (32 bytes). Generate with: node -e \"console.log(crypto.randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(key, "hex");
}

export interface DecryptedCredential {
  username: string;
  password: string;
}

export interface CredentialMetadata {
  airline: AirlineKey;
  connectionStatus: string;
  lastTestedAt?: Date;
  lastTestError?: string;
}

/**
 * Encrypt a credential using AES-256-GCM
 * Returns a combined buffer: iv (12 bytes) + authTag (16 bytes) + ciphertext
 */
function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96 bits for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Combine: iv (hex) + authTag (hex) + ciphertext (hex)
  const combined = iv.toString("hex") + authTag.toString("hex") + encrypted;
  return combined;
}

/**
 * Decrypt a credential using AES-256-GCM
 */
function decryptCredential(ciphertext: string): string {
  const key = getEncryptionKey();

  // Extract components
  const iv = Buffer.from(ciphertext.slice(0, 24), "hex"); // 12 bytes = 24 hex chars
  const authTag = Buffer.from(ciphertext.slice(24, 56), "hex"); // 16 bytes = 32 hex chars
  const encrypted = ciphertext.slice(56);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Save a user's airline credentials
 */
export async function saveUserCredential(
  userId: string,
  airline: AirlineKey,
  username: string,
  password: string
): Promise<CredentialMetadata> {
  const encryptedUsername = encryptCredential(username);
  const encryptedPassword = encryptCredential(password);

  const credential = await prisma.userAirlineCredential.upsert({
    where: {
      userId_airline: {
        userId,
        airline,
      },
    },
    update: {
      encryptedUsername,
      encryptedPassword,
      connectionStatus: "CONFIGURED",
      updatedAt: new Date(),
    },
    create: {
      userId,
      airline,
      encryptedUsername,
      encryptedPassword,
      connectionStatus: "CONFIGURED",
    },
  });

  return {
    airline: credential.airline,
    connectionStatus: credential.connectionStatus,
    lastTestedAt: credential.lastTestedAt || undefined,
    lastTestError: credential.lastTestError || undefined,
  };
}

/**
 * Retrieve and decrypt a user's airline credentials
 * Credentials are decrypted just-in-time and should be immediately discarded after use.
 * NEVER log or return them in API responses.
 */
export async function getUserCredential(userId: string, airline: AirlineKey): Promise<DecryptedCredential | null> {
  const credential = await prisma.userAirlineCredential.findUnique({
    where: {
      userId_airline: {
        userId,
        airline,
      },
    },
  });

  if (!credential) {
    return null;
  }

  try {
    const username = decryptCredential(credential.encryptedUsername);
    const password = decryptCredential(credential.encryptedPassword);

    return { username, password };
  } catch (err) {
    console.error(`[UserCredentialService] decryption failed for ${userId}/${airline}:`, err);
    throw new Error("Credential decryption failed — encryption key may have changed");
  }
}

/**
 * List all airlines a user has saved credentials for
 */
export async function listUserCredentials(userId: string): Promise<CredentialMetadata[]> {
  const credentials = await prisma.userAirlineCredential.findMany({
    where: { userId },
    select: {
      airline: true,
      connectionStatus: true,
      lastTestedAt: true,
      lastTestError: true,
    },
  });

  return credentials;
}

/**
 * Delete a user's credentials for an airline
 * Used when user revokes access or wants to update
 */
export async function deleteUserCredential(userId: string, airline: AirlineKey): Promise<boolean> {
  try {
    await prisma.userAirlineCredential.delete({
      where: {
        userId_airline: {
          userId,
          airline,
        },
      },
    });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Update the test status of a credential
 * Called after attempting to verify the credentials work
 */
export async function updateCredentialTestStatus(
  userId: string,
  airline: AirlineKey,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await prisma.userAirlineCredential.update({
    where: {
      userId_airline: {
        userId,
        airline,
      },
    },
    data: {
      connectionStatus: success ? "CONFIGURED" : "ERROR",
      lastTestedAt: new Date(),
      lastTestError: errorMessage || null,
    },
  });
}

/**
 * Verify that a user has credentials saved for an airline
 */
export async function hasUserCredentials(userId: string, airline: AirlineKey): Promise<boolean> {
  const credential = await prisma.userAirlineCredential.findUnique({
    where: {
      userId_airline: {
        userId,
        airline,
      },
    },
  });
  return !!credential;
}
