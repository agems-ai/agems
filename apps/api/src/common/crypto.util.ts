import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { requireEnv } from '../config/env.util';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'agems-credential-salt'; // static salt, key derivation uses JWT_SECRET

function getKey(): Buffer {
  const secret = requireEnv('JWT_SECRET');
  return scryptSync(secret, SALT, 32);
}

/**
 * Encrypt a JSON object for storage at rest.
 * Returns a string in format: iv:encrypted:tag (all hex-encoded)
 */
export function encryptJson(data: unknown): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(data);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
}

/**
 * Decrypt a string produced by encryptJson back to a JSON object.
 * If the input is not encrypted (plain JSON), returns it parsed as-is for backward compatibility.
 */
export function decryptJson(encrypted: string): unknown {
  // Backward compatibility: if it looks like plain JSON, just parse it
  if (!encrypted || encrypted.startsWith('{') || encrypted.startsWith('[') || encrypted.startsWith('"')) {
    try {
      return JSON.parse(encrypted);
    } catch {
      return encrypted;
    }
  }

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    // Not encrypted format, try JSON parse
    try {
      return JSON.parse(encrypted);
    } catch {
      return encrypted;
    }
  }

  const key = getKey();
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const tag = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

/**
 * Check if a value is already encrypted (not plain JSON)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) return false;
  const parts = value.split(':');
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2;
}
