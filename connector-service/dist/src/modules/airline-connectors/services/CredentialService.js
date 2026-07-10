import crypto from "crypto";
// AES-256-GCM credential encryption. The key comes from
// CONNECTOR_ENCRYPTION_KEY (32 raw bytes, base64-encoded) — never hard-code
// it, never commit it. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Ciphertext format: base64(iv[12] + authTag[16] + encrypted).
// Decryption only ever happens inside services/SyncService.ts, server-side,
// immediately before a login() call — plaintext credentials are never
// logged, returned from an API route, or sent to the frontend.
function getKey() {
    const raw = process.env.CONNECTOR_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error("CONNECTOR_ENCRYPTION_KEY is not set. Generate one with: " +
            `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error("CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
    }
    return key;
}
export function encryptSecret(plaintext) {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}
export function decryptSecret(ciphertextB64) {
    const key = getKey();
    const raw = Buffer.from(ciphertextB64, "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
}
