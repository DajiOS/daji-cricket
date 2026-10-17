import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, statfsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';

// The media library: photos and videos of any size (a few GB is fine) uploaded from the admin desk and shown on the website.
// A file is streamed straight to disk (never held in memory), its type comes from the file extension against a short allow-list (no SVG or
// HTML, which can carry scripts), and it is stored under a random id. Files are public once uploaded (they appear on the website),
// and are served with Range support so videos start quickly and can be skipped through.

registerSchema('library-1', `
CREATE TABLE media_lib (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  tag TEXT NOT NULL DEFAULT 'gallery',
  created_at INTEGER NOT NULL,
  created_by TEXT
);
`);

export const TAGS = ['hero', 'gallery', 'academy', 'other'] as const;
export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024 * 1024;
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};
interface Row { id: string; name: string; mime: string; ext: string; bytes: number; tag: string; created_at: number }
export interface LibItem { id: string; name: string; mime: string; kind: 'image' | 'video'; bytes: number; tag: string; url: string; thumb: string | null; web: string | null; createdAt: number }
let dataRoot = '';
export const setLibraryRoot = (dataDir: string): void => { dataRoot = dataDir; };
const thumbPath = (dataDir: string, id: string) => join(dataDir, 'library', `${id}.thumb.jpg`);
const webPath = (dataDir: string, id: string) => join(dataDir, 'library', `${id}.web.mp4`);
const toOut = (r: Row): LibItem => ({ id: r.id, name: r.name, mime: r.mime, kind: r.mime.startsWith('video/') ? 'video' : 'image', bytes: r.bytes, tag: r.tag, url: `/media/${r.id}.${r.ext}`, thumb: dataRoot && existsSync(thumbPath(dataRoot, r.id)) ? `/media/${r.id}.thumb.jpg` : null, web: dataRoot && existsSync(webPath(dataRoot, r.id)) ? `/media/${r.id}.web.mp4` : null, createdAt: r.created_at });
const dir = (dataDir: string) => join(dataDir, 'library');

// Small preview pictures (the first frame of a video, or a shrunken photo) so the website and the desk never have to load a huge original
// just to draw a tile. Made one at a time in the background with ffmpeg; when ffmpeg is not installed the original is used instead.
const queue: Array<() => Promise<void>> = [];
const slow: Array<() => Promise<void>> = [];
let working = false;
// quick preview pictures always go first; the slow video copies wait until none are left
async function drain(): Promise<void> {
  if (working) return; working = true;
  while (queue.length || slow.length) { try { await (queue.length ? queue : slow).shift()!(); } catch { /* a failed preview is not an error */ } }
  working = false;
}
function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try { const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore' }); p.on('error', () => resolve(false)); p.on('close', (c) => resolve(c === 0)); }
    catch { resolve(false); }
  });
}
export function makeThumb(dataDir: string, id: string, ext: string, isVideo: boolean): void {
  queue.push(async () => {
    const src = pathOf(dataDir, id, ext), out = thumbPath(dataDir, id);
    if (existsSync(out) || !existsSync(src)) return;
    const vf = ['-vf', 'scale=720:-2', '-frames:v', '1', '-q:v', '4', out];
    const ok = isVideo ? (await ffmpeg(['-ss', '1', '-i', src, ...vf])) || (await ffmpeg(['-i', src, ...vf])) : await ffmpeg(['-i', src, ...vf]);
    if (!ok) { try { unlinkSync(out); } catch { /* none made */ } }
  });
  if (isVideo) slow.push(async () => {
    const src = pathOf(dataDir, id, ext);
    if (!existsSync(src)) return;
    // a light copy for playing on the website: 720p, about 3 Mbit/s, starts playing before it has fully downloaded
    const web = webPath(dataDir, id);
    if (isVideo && !existsSync(web)) {
      const tmp = web + '.part.mp4';
      const done = await ffmpeg(['-i', src, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-threads', '2', tmp]);
      try { if (done) renameSync(tmp, web); else unlinkSync(tmp); } catch { /* nothing to clean */ }
    }
  });
  void drain();
}
/** Previews for files uploaded before this existed. */
export function backfillThumbs(dataDir: string): void {
  dataRoot = dataDir;
  for (const r of many<Row>('SELECT * FROM media_lib')) if (!existsSync(thumbPath(dataDir, r.id)) || (r.mime.startsWith('video/') && !existsSync(webPath(dataDir, r.id)))) makeThumb(dataDir, r.id, r.ext, r.mime.startsWith('video/'));
}

const pathOf = (dataDir: string, id: string, ext: string) => join(dir(dataDir), `${id}.${ext}`);

export async function saveUpload(dataDir: string, req: IncomingMessage, actorId: string, name: string, tag: string): Promise<LibItem> {
  const clean = name.replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 150) || 'file';
  const ext = (clean.split('.').pop() ?? '').toLowerCase();
  const mime = TYPES[ext];
  if (!mime) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Upload a JPG, PNG, WebP, GIF, AVIF, MP4, MOV or WebM file');
  if (!(TAGS as readonly string[]).includes(tag)) tag = 'gallery';
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > MAX_LIBRARY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'That file is over 8 GB');
  mkdirSync(dir(dataDir), { recursive: true });
  try { const f = statfsSync(dir(dataDir)); if (len && len + 512 * 1024 * 1024 > f.bavail * f.bsize) throw new HttpError(507, 'DISK_FULL', 'The server does not have enough free space for this file'); } catch (e) { if (e instanceof HttpError) throw e; }
  const id = newId('lib');
  const file = pathOf(dataDir, id, ext);
  let size = 0;
  req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_LIBRARY_BYTES) req.destroy(); });
  try { await pipeline(req, createWriteStream(file)); }
  catch { try { unlinkSync(file); } catch { /* nothing was written */ } throw new HttpError(400, 'UPLOAD_FAILED', 'The upload was interrupted. Try again.'); }
  if (size === 0) { try { unlinkSync(file); } catch { /* empty */ } throw new HttpError(400, 'EMPTY', 'The file is empty'); }
  dataRoot = dataDir;
  run('INSERT INTO media_lib (id, name, mime, ext, bytes, tag, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)', id, clean, mime, ext, size, tag, now(), actorId);
  makeThumb(dataDir, id, ext, mime.startsWith('video/'));
  return toOut(one<Row>('SELECT * FROM media_lib WHERE id = ?', id)!);
}

export const listLibrary = (tag?: string): LibItem[] =>
  many<Row>(tag ? 'SELECT * FROM media_lib WHERE tag = ? ORDER BY created_at DESC' : 'SELECT * FROM media_lib ORDER BY created_at DESC', ...(tag ? [tag] : [])).map(toOut);

export function setTag(id: string, tag: string): LibItem {
  if (!(TAGS as readonly string[]).includes(tag)) throw new HttpError(400, 'BAD_TAG', 'Unknown label');
  if (!one('SELECT id FROM media_lib WHERE id = ?', id)) throw notFound('File');
  run('UPDATE media_lib SET tag = ? WHERE id = ?', tag, id);
  return toOut(one<Row>('SELECT * FROM media_lib WHERE id = ?', id)!);
}

export function removeFile(dataDir: string, id: string): void {
  const r = one<Row>('SELECT * FROM media_lib WHERE id = ?', id);
  if (!r) throw notFound('File');
  run('DELETE FROM media_lib WHERE id = ?', id);
  try { unlinkSync(pathOf(dataDir, r.id, r.ext)); } catch { /* already gone */ }
  try { unlinkSync(thumbPath(dataDir, r.id)); } catch { /* none */ }
  try { unlinkSync(webPath(dataDir, r.id)); } catch { /* none */ }
}

export function diskInfo(dataDir: string): { freeBytes: number | null; libraryBytes: number } {
  let freeBytes: number | null = null;
  try { mkdirSync(dir(dataDir), { recursive: true }); const f = statfsSync(dir(dataDir)); freeBytes = f.bavail * f.bsize; } catch { /* not supported */ }
  const sum = one<{ s: number | null }>('SELECT SUM(bytes) AS s FROM media_lib');
  return { freeBytes, libraryBytes: sum?.s ?? 0 };
}

/** GET /media/<id>.<ext> with Range support. Returns false when the path is not a library file. */
export function serveLibraryFile(dataDir: string, req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const m = /^\/media\/(lib_[A-Za-z0-9_-]+)\.([a-z0-9.]+)$/.exec(pathname);
  if (!m) return false;
  const r = one<Row>('SELECT * FROM media_lib WHERE id = ?', m[1]!);
  const isThumb = m[2] === 'thumb.jpg', isWeb = m[2] === 'web.mp4';
  const file = r && isThumb ? thumbPath(dataDir, r.id) : r && isWeb ? webPath(dataDir, r.id) : r && r.ext === m[2] ? pathOf(dataDir, r.id, r.ext) : '';
  if (!r || !existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return true; }
  const total = statSync(file).size;
  const base: Record<string, string> = {
    'Content-Type': isThumb ? 'image/jpeg' : isWeb ? 'video/mp4' : r.mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=86400',
  };
  let start = 0, end = total - 1, status = 200;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (rg && (rg[1] || rg[2])) {
    if (rg[1]) { start = Number(rg[1]); if (rg[2]) end = Math.min(Number(rg[2]), total - 1); }
    else { start = Math.max(0, total - Number(rg[2])); }
    if (start > end || start >= total) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${total}` }); res.end(); return true; }
    status = 206;
  }
  const headers = { ...base, 'Content-Length': String(end - start + 1), ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}) };
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  const s = createReadStream(file, { start, end });
  s.on('error', () => res.destroy());
  res.on('close', () => s.destroy());
  s.pipe(res);
  return true;
}
