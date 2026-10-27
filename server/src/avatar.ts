import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { one, run } from './db.ts';
import { now } from './clock.ts';
import { HttpError, notFound } from './errors.ts';
import { audit } from './audit.ts';
import { sniffImage } from './media.ts';
import { storeUpload } from './intake.ts';
import type { UserRow } from './auth.ts';

/** A person's own profile picture. Stored under a random id (the address is unguessable), the type is read from the file itself, and a new picture replaces the old one. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const file = (dir: string, id: string, ext: string): string => join(dir, 'avatars', `${id}.${ext}`);

export function setAvatar(dataDir: string, u: UserRow, data: Buffer): string {
  if (!data.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (data.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `A profile picture can be up to ${MAX_AVATAR_BYTES / 1024 / 1024} MB`);
  const t = sniffImage(data);
  if (!t) throw new HttpError(415, 'NOT_A_PHOTO', 'Only PNG, JPEG, WebP or GIF pictures can be used');
  const id = randomBytes(12).toString('hex');
  // scanned, quarantined, then released together with the record; the picture it replaces is kept as an earlier version
  storeUpload({
    dataDir, buf: data, finalPath: file(dataDir, id, t.ext), purpose: 'avatar', actor: { id: u.id, role: u.role }, ownerId: u.id,
    versioned: u.avatar_id && u.avatar_ext ? file(dataDir, u.avatar_id, u.avatar_ext) : false,
    writeMetadata: () => {
      run('UPDATE users SET avatar_id = ?, avatar_ext = ?, avatar_mime = ?, updated_at = ? WHERE id = ?', id, t.ext, t.mime, now(), u.id);
      audit({ id: u.id, role: u.role }, 'profile.avatar_set', 'user', u.id, { bytes: data.length });
    },
  });
  return `/api/avatar/${id}`;
}

export function clearAvatar(dataDir: string, u: UserRow): void {
  dropFile(dataDir, u);
  run('UPDATE users SET avatar_id = NULL, avatar_ext = NULL, avatar_mime = NULL, updated_at = ? WHERE id = ?', now(), u.id);
  audit({ id: u.id, role: u.role }, 'profile.avatar_clear', 'user', u.id, {});
}

function dropFile(dataDir: string, u: UserRow): void {
  if (u.avatar_id && u.avatar_ext) { try { unlinkSync(file(dataDir, u.avatar_id, u.avatar_ext)); } catch { /* already gone */ } }
}

export function readAvatar(dataDir: string, id: string): { data: Buffer; mime: string } {
  const r = one<{ avatar_ext: string; avatar_mime: string }>('SELECT avatar_ext, avatar_mime FROM users WHERE avatar_id = ?', id);
  if (!r) throw notFound('Picture not found');
  try { return { data: readFileSync(file(dataDir, id, r.avatar_ext)), mime: r.avatar_mime }; } catch { throw notFound('Picture not found'); }
}
