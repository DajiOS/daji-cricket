import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Encryption at rest for the few values that must never sit readable in the database or a stolen backup.
//
// Fields: AES-256-GCM with a key derived from FIELD_KEY. A sealed value looks like "enc1:<iv>.<tag>.<data>" (base64url).
// A value without that prefix is treated as plain text, so turning FIELD_KEY on later does not break old rows:
// they are sealed the next time they are written. If FIELD_KEY is lost, sealed values cannot be recovered.
//
// Files (backups): the same cipher with a passphrase, scrypt-derived, in the layout  "DJB1" | salt(16) | iv(12) | data | tag(16).

let fieldKey: Buffer | null = null;
const FIELD_SALT = Buffer.from('daji-field-key-v1');

export function setVaultKey(secret: string): void { fieldKey = secret ? scryptSync(secret, FIELD_SALT, 32) : null; }
export const vaultOn = (): boolean => fieldKey !== null;

const b64 = (b: Buffer): string => b.toString('base64url');

export function seal(plain: string): string {
  if (!fieldKey) return plain;
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', fieldKey, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc1:${b64(iv)}.${b64(c.getAuthTag())}.${b64(data)}`;
}

export function unseal(stored: string): string {
  if (!stored.startsWith('enc1:')) return stored;
  if (!fieldKey) throw new Error('This value is encrypted but FIELD_KEY is not set');
  const [iv, tag, data] = stored.slice(5).split('.').map((x) => Buffer.from(x ?? '', 'base64url'));
  if (!iv || !tag || !data) throw new Error('Encrypted value is damaged');
  const d = createDecipheriv('aes-256-gcm', fieldKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

const MAGIC = Buffer.from('DJB1');

export function encryptBytes(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, data, c.getAuthTag()]);
}

export function decryptBytes(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < 48 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('Not an encrypted Daji backup file');
  const salt = blob.subarray(4, 20), iv = blob.subarray(20, 32), tag = blob.subarray(blob.length - 16), data = blob.subarray(32, blob.length - 16);
  const d = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(data), d.final()]); } catch { throw new Error('Wrong passphrase, or the file is damaged'); }
}

export function encryptFile(path: string, passphrase: string): void { writeFileSync(path + '.enc', encryptBytes(readFileSync(path), passphrase)); }
