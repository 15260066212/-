/**
 * AES-256-GCM encryption module
 * Unified encryption scheme shared between account-vault and server.
 *
 * Format: enc:base64(iv):base64(ciphertext):base64(authTag)
 * Salt:   geo-assistant-v1
 * Env:    CREDENTIAL_ENCRYPTION_KEY
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'geo-assistant-v1';
const ENCRYPTION_PREFIX = 'enc:';

let cachedKey: Buffer | null = null;

function deriveKey(envKey?: string): Buffer {
  if (cachedKey) return cachedKey;
  const passphrase = envKey || process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.ACCOUNT_VAULT_KEY;
  if (!passphrase) {
    console.warn('[Crypto] CREDENTIAL_ENCRYPTION_KEY not set, using development default.');
  }
  const key = crypto.scryptSync(passphrase || 'dev-only-encryption-key', SALT, 32);
  cachedKey = key;
  return key;
}

/** Encrypt a plaintext string. Returns "enc:base64(iv):base64(ct):base64(tag)". */
export function encrypt(plaintext: string, key?: Buffer): string {
  const k = key || deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, k, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/** Decrypt an encrypted string. Falls back to plaintext if not encrypted (backward compat). */
export function decrypt(ciphertext: string, key?: Buffer): string {
  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) {
    return ciphertext;
  }
  const k = key || deriveKey();
  const parts = ciphertext.slice(ENCRYPTION_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function encryptJSON(obj: unknown, key?: Buffer): string {
  return encrypt(JSON.stringify(obj), key);
}

export function decryptJSON<T = unknown>(ciphertext: string, key?: Buffer): T {
  return JSON.parse(decrypt(ciphertext, key)) as T;
}

export function generatePassword(length: number = 24): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
