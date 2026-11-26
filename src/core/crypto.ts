import { createCipheriv, createHash, randomBytes } from "crypto";

/**
 * Encrypts the EPG channel API user password, as described on the EcoCash portal:
 *
 * 1. SHA-1 hash of the encryption key (UTF-8), truncated to 16 bytes, is the AES-128 key.
 * 2. A random 12-byte IV.
 * 3. AES-GCM, no padding, 128-bit auth tag.
 * 4. IV + cipher text + auth tag, Base64 encoded.
 *
 * The output differs on every call because the IV is random. That is expected.
 */
export function encryptPassword(password: string, encryptionKey: string): string {
  const key = createHash("sha1").update(encryptionKey, "utf8").digest().subarray(0, 16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64");
}
