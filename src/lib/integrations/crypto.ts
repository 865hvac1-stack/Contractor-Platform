import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KEY_SALT = "contractoryou-integrations-v1";
const ALGORITHM = "aes-256-gcm";

export type EncryptedSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

/**
 * AES-256-GCM for provider tokens. Server-side only.
 * Never log plaintext. Never send ciphertext or plaintext to the browser.
 */
export function getIntegrationKey(): Buffer {
  const secret =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.INTEGRATION_SECRET ||
    process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY, INTEGRATION_SECRET, or SESSION_SECRET (32+ characters) is required to encrypt provider credentials."
    );
  }
  return scryptSync(secret, KEY_SALT, 32);
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getIntegrationKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion: 1,
  };
}

export function decryptSecret(stored: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, getIntegrationKey(), stored.iv);
  decipher.setAuthTag(stored.authTag);
  const plain = Buffer.concat([decipher.update(stored.ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

export type ProviderTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
};

export function encryptProviderTokens(payload: ProviderTokenPayload): EncryptedSecret {
  return encryptSecret(JSON.stringify(payload));
}

export function decryptProviderTokens(stored: EncryptedSecret): ProviderTokenPayload {
  const parsed = JSON.parse(decryptSecret(stored)) as ProviderTokenPayload;
  if (!parsed || typeof parsed.accessToken !== "string") {
    throw new Error("Invalid credential payload.");
  }
  return parsed;
}
