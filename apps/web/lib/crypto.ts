import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getCredentialEncryptionKey } from "@/lib/env";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export function isEncryptionConfigured(): boolean {
  return getCredentialEncryptionKey() !== null;
}

/** AES-256-GCM. The key lives only in a server environment variable (CREDENTIAL_ENCRYPTION_KEY). */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getCredentialEncryptionKey();
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptSecret(secret: Pick<EncryptedSecret, "ciphertext" | "iv" | "authTag">): string {
  const key = getCredentialEncryptionKey();
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const keyHint = (apiKey: string): string => `…${apiKey.slice(-4)}`;
