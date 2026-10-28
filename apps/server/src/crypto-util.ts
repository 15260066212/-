import crypto from 'node:crypto';

/**
 * AES-256-GCM encryption utility for protecting stored credentials.
 * Encrypted data is prefixed with "enc:" for backward compatibility detection.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'geo-assistant-v1';
const ENCRYPTION_PREFIX = 'enc:';

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    cachedKey = crypto.scryptSync(envKey, SALT, 32);
  } else {
    console.warn(
      '[Crypto] CREDENTIAL_ENCRYPTION_KEY not set, using development default. ' +
      'Set this environment variable for production use.',
    );
    cachedKey = crypto.scryptSync('dev-only-encryption-key', SALT, 32);
  }
  return cachedKey;
}

/** Encrypt a plaintext string using AES-256-GCM. Returns "enc:iv:ciphertext:tag" in base64. */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/** Decrypt an encrypted string. Falls back to plaintext if not encrypted (backward compat). */
export function decrypt(data: string): string {
  // If encrypted with new format (enc: prefix), decrypt
  if (data.startsWith(ENCRYPTION_PREFIX)) {
    const key = getEncryptionKey();
    const parts = data.slice(ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  // Check for old encrypted format (iv:ciphertext:tag without enc: prefix)
  // JSON data starts with '{' or '['; encrypted data does not
  if (!data.startsWith('{') && !data.startsWith('[')) {
    const parts = data.split(':');
    if (parts.length === 3) {
      try {
        const key = getEncryptionKey();
        const iv = Buffer.from(parts[0], 'base64');
        const encrypted = Buffer.from(parts[1], 'base64');
        const tag = Buffer.from(parts[2], 'base64');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
      } catch {
        // Not actually encrypted data, fall through to return as-is
      }
    }
  }

  // Plain text backward compatibility
  return data;
}

/** Encrypt a JSON-serializable object. Returns encrypted string. */
export function encryptJSON(obj: unknown): string {
  return encrypt(JSON.stringify(obj));
}

/** Decrypt an encrypted JSON string and parse it back to an object. */
export function decryptJSON<T>(encrypted: string): T {
  try {
    return JSON.parse(decrypt(encrypted)) as T;
  } catch {
    // Return empty object if decryption/parsing fails (e.g. legacy data)
    return {} as T;
  }
}
