// AES-256-GCM encrypt/decrypt for stored third-party credentials (IL SOS PIN, etc.).
// Key comes from CREDENTIALS_ENCRYPTION_KEY (32 raw bytes, hex-encoded -> 64 hex chars).
// Storage format: base64(iv) "." base64(authTag) "." base64(ciphertext)
//
// Generate a key once:  openssl rand -hex 32
// Store as Vercel env var (Production + Preview + Development). Never commit.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY env var is not set');
  }
  if (hex.length !== 64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptCredential(plaintext: string): string {
  if (!plaintext) throw new Error('encryptCredential: plaintext required');
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptCredential(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) throw new Error('decryptCredential: malformed ciphertext');
  const [ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}
