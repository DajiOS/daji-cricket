import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { storeUpload } from './intake.ts';
import { audit, type Actor } from './audit.ts';

// Photos for the website gallery, grounds and the academy. An upload is a normal request body (the file itself); its type is read from its
// first bytes, never from the file name, and only PNG, JPEG, WebP and GIF are kept (not SVG, which can carry scripts). Files are stored
// under their own random id, so a name cannot reach another folder, and are served with "nosniff" and a policy that forbids scripts.
// A photo is public once uploaded (it is shown on the website); the list of who uploaded what is private to the owner.

registerSchema('media-1', `
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('gallery','ground','academy')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER
);
CREATE INDEX ix_media_owner ON media(owner_id, kind);
`);

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MEDIA_KINDS = ['gallery', 'ground', 'academy'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
/** Photos kept per owner (and for the platform): stops a runaway upload from filling the disk. */
export const MAX_PHOTOS_PER_OWNER = 300;

export interface MediaOut { id: string; kind: MediaKind; filename: string; mime: string; bytes: number; url: string; createdAt: number }
interface Row { id: string; owner_id: string | null; kind: MediaKind; filename: string; mime: string; ext: string; bytes: number; created_at: number }
const toOut = (r: Row): MediaOut => ({ id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, bytes: r.bytes, url: `/api/media/${r.id}`, createdAt: r.created_at });

export function sniffImage(b: Buffer): { mime: string; ext: string } | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a')) return { mime: 'image/gif', ext: 'gif' };
  return null;
}

export function addPhoto(dataDir: string, ownerId: string | null, actor: Actor, kind: string, filename: string, data: Buffer): MediaOut {
  if (!(MEDIA_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'VALIDATION_FAILED', 'kind must be gallery, ground or academy');
  if (!data.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `Photos can be up to ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
  const t = sniffImage(data);
  if (!t) throw new HttpError(415, 'NOT_A_PHOTO', 'Only PNG, JPEG, WebP or GIF photos can be uploaded');
  const count = one<{ c: number }>('SELECT COUNT(*) c FROM media WHERE owner_id IS ? AND deleted_at IS NULL', ownerId)!.c;
  if (count >= MAX_PHOTOS_PER_OWNER) throw new HttpError(409, 'LIBRARY_FULL', `Up to ${MAX_PHOTOS_PER_OWNER} photos can be kept. Remove some first.`);
  const sha = createHash('sha256').update(data).digest('hex');
  const dup = one<Row>('SELECT * FROM media WHERE owner_id IS ? AND kind = ? AND sha256 = ? AND deleted_at IS NULL', ownerId, kind, sha);
  if (dup) return toOut(dup); // the same photo twice is the same photo
  const id = newId('med');
  const clean = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'photo';
  storeUpload({
    dataDir, buf: data, finalPath: join(dataDir, 'media', `${id}.${t.ext}`), purpose: 'media', actor, ownerId,
    writeMetadata: () => {
      run('INSERT INTO media(id, owner_id, kind, filename, mime, ext, bytes, sha256, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)', id, ownerId, kind, clean, t.mime, t.ext, data.length, sha, now(), actor.id);
      audit(actor, 'media.add', 'media', id, { kind, bytes: data.length }, ownerId ?? undefined);
    },
  });
  return toOut(one<Row>('SELECT * FROM media WHERE id = ?', id)!);
}

export function listPhotos(ownerId: string | null, kind?: string): MediaOut[] {
  return many<Row>(`SELECT * FROM media WHERE owner_id IS ? AND deleted_at IS NULL ${kind ? 'AND kind = ?' : ''} ORDER BY created_at DESC`, ...(kind ? [ownerId, kind] : [ownerId])).map(toOut);
}

export function removePhoto(ownerId: string | null, actor: Actor, id: string): void {
  const r = one<Row>('SELECT * FROM media WHERE id = ? AND owner_id IS ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('Photo not found');
  run('UPDATE media SET deleted_at = ? WHERE id = ?', now(), id); // the bytes stay on disk for backups and the audit trail; the address stops working
  audit(actor, 'media.remove', 'media', id, {}, ownerId ?? undefined);
}

export function readPhoto(dataDir: string, id: string): { data: Buffer; mime: string } {
  const r = one<Row>('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL', id);
  if (!r) throw notFound('Photo not found');
  return { data: readFileSync(join(dataDir, 'media', `${r.id}.${r.ext}`)), mime: r.mime };
}
