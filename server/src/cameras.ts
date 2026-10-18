import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { hasPermission, scopeOwnerId, type UserRow } from './auth.ts';
import type { Config } from './config.ts';

// Live camera view. The cameras (Dahua or any RTSP camera, usually through the ground's NVR/XVR) are never opened to the internet.
// A small "bridge" program on a PC at the ground pulls pictures from the recorder and PUTs them here over HTTPS with a secret
// per-camera token. The server keeps only the newest picture of each camera in memory (nothing is recorded; the NVR keeps the
// recordings) and fans it out to whoever is watching as a motion-JPEG stream.

registerSchema('cameras-1', `
CREATE TABLE cameras (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cameras_owner ON cameras(owner_id);
`);

export interface CameraRow { id: string; owner_id: string; name: string; token_hash: string; active: number; created_at: number }

const MAX_FRAME = 600 * 1024;
const MAX_CAMERAS_PER_OWNER = 32;
const MAX_VIEWERS_PER_CAMERA = 12;
const MAX_STREAM_MS = 30 * 60 * 1000;
const ONLINE_MS = 15_000;
const VIEW_TOKEN_SECONDS = 120;

interface Live { frame: Buffer | null; at: number; viewers: Set<ServerResponse>; bus: EventEmitter }
const live = new Map<string, Live>();
const liveOf = (id: string): Live => {
  let l = live.get(id);
  if (!l) { l = { frame: null, at: 0, viewers: new Set(), bus: new EventEmitter() }; l.bus.setMaxListeners(0); live.set(id, l); }
  return l;
};

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newCameraToken = () => 'cam_' + randomBytes(24).toString('base64url');

export function camerasAllowed(u: UserRow): boolean {
  return u.role === 'owner' || u.role === 'super_admin' || (u.role === 'staff' && hasPermission(u, 'view_cameras'));
}
export function requireCameraView(u: UserRow): void {
  if (!camerasAllowed(u)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to the cameras');
}
export function requireCameraAdmin(u: UserRow): void {
  if (u.role !== 'owner' && u.role !== 'super_admin') throw new HttpError(403, 'FORBIDDEN', 'Only the owner can add or change cameras');
}

function getCamera(id: string): CameraRow {
  const r = one<CameraRow>('SELECT * FROM cameras WHERE id = ?', id);
  if (!r) throw notFound('Camera not found');
  return r;
}
/** A camera the user may see; anything outside their owner answers 404. */
export function cameraInScope(u: UserRow, id: string): CameraRow {
  const r = getCamera(id);
  if (u.role !== 'super_admin' && scopeOwnerId(u) !== r.owner_id) throw notFound('Camera not found');
  return r;
}

function view(r: CameraRow) {
  const l = live.get(r.id);
  return { id: r.id, ownerId: r.owner_id, name: r.name, active: !!r.active, online: !!l && !!l.frame && now() - l.at < ONLINE_MS, lastFrameAt: l?.at || null, watchers: l?.viewers.size ?? 0, createdAt: r.created_at };
}

export function listCameras(u: UserRow, ownerId: string | null) {
  const own = u.role === 'super_admin' ? ownerId : scopeOwnerId(u);
  const rows = own ? many<CameraRow>('SELECT * FROM cameras WHERE owner_id = ? ORDER BY name', own) : many<CameraRow>('SELECT * FROM cameras ORDER BY owner_id, name');
  return { items: rows.map(view) };
}

function cleanName(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 60);
  if (!s) throw new HttpError(400, 'VALIDATION', 'Give the camera a name, for example "Pitch 1 - north end"');
  return s;
}

export function createCamera(u: UserRow, ownerId: string, name: unknown) {
  const n = cleanName(name);
  const count = one<{ n: number }>('SELECT COUNT(*) n FROM cameras WHERE owner_id = ?', ownerId)?.n ?? 0;
  if (count >= MAX_CAMERAS_PER_OWNER) throw new HttpError(400, 'LIMIT', `At most ${MAX_CAMERAS_PER_OWNER} cameras`);
  const id = newId('cam');
  const token = newCameraToken();
  run('INSERT INTO cameras(id, owner_id, name, token_hash, created_at) VALUES(?,?,?,?,?)', id, ownerId, n, hashToken(token), now());
  audit(u as Actor, 'camera.create', 'camera', id, { name: n }, ownerId);
  return { ...view(getCamera(id)), ingestToken: token };
}

export function updateCamera(u: UserRow, id: string, patch: { name?: unknown; active?: unknown }) {
  const r = cameraInScope(u, id);
  const name = patch.name === undefined ? r.name : cleanName(patch.name);
  const active = patch.active === undefined ? r.active : patch.active ? 1 : 0;
  run('UPDATE cameras SET name = ?, active = ? WHERE id = ?', name, active, id);
  if (!active) dropViewers(id);
  audit(u as Actor, 'camera.update', 'camera', id, { name, active: !!active }, r.owner_id);
  return view(getCamera(id));
}

export function rotateCameraToken(u: UserRow, id: string) {
  const r = cameraInScope(u, id);
  const token = newCameraToken();
  run('UPDATE cameras SET token_hash = ? WHERE id = ?', hashToken(token), id);
  audit(u as Actor, 'camera.rotate_token', 'camera', id, null, r.owner_id);
  return { ...view(getCamera(id)), ingestToken: token };
}

export function removeCamera(u: UserRow, id: string): void {
  const r = cameraInScope(u, id);
  dropViewers(id);
  live.delete(id);
  run('DELETE FROM cameras WHERE id = ?', id);
  audit(u as Actor, 'camera.delete', 'camera', id, { name: r.name }, r.owner_id);
}

function dropViewers(id: string): void {
  const l = live.get(id);
  if (!l) return;
  for (const res of l.viewers) { try { res.end(); } catch { /* already closed */ } }
  l.viewers.clear();
  l.frame = null;
}

// ---- picture in (from the bridge) ----

function bearer(h: string | undefined): string {
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function readCapped(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n <= max) chunks.push(c as Buffer);
    // Too big: keep reading (and throwing the rest away) so the sender finishes and gets a clean 413, not a dropped connection.
    else if (n > 8 * max) { req.destroy(); throw new HttpError(413, 'TOO_LARGE', 'Picture is too large'); }
  }
  if (n > max) throw new HttpError(413, 'TOO_LARGE', 'Picture is too large');
  return Buffer.concat(chunks);
}

/** Take one picture from the bridge. Returns what the bridge needs to pace itself: how many people are watching right now. */
export async function ingestFrame(id: string, req: IncomingMessage): Promise<{ watchers: number }> {
  const token = bearer(req.headers.authorization);
  const r = one<CameraRow>('SELECT * FROM cameras WHERE id = ?', id);
  const want = Buffer.from(r?.token_hash ?? hashToken('none'), 'hex');
  const got = Buffer.from(hashToken(token), 'hex');
  if (!r || !token || want.length !== got.length || !timingSafeEqual(want, got) || !r.active) throw new HttpError(401, 'UNAUTHENTICATED', 'Camera token not accepted');
  const buf = await readCapped(req, MAX_FRAME);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'BAD_PICTURE', 'Send a JPEG picture');
  const l = liveOf(id);
  l.frame = buf;
  l.at = now();
  l.bus.emit('frame', buf);
  return { watchers: l.viewers.size };
}

// ---- picture out (to the desk) ----

/** A short-lived link token, because an <img> tag cannot send a sign-in header. It names the owner and is checked again against the camera. */
export function makeViewToken(cfg: Config, u: UserRow): { token: string; expiresIn: number } {
  requireCameraView(u);
  const body = Buffer.from(JSON.stringify({ u: u.id, o: u.role === 'super_admin' ? '*' : scopeOwnerId(u), exp: Math.floor(Date.now() / 1000) + VIEW_TOKEN_SECONDS })).toString('base64url');
  const sig = createHmac('sha256', cfg.jwtSecret).update('camview.' + body).digest('base64url');
  return { token: `${body}.${sig}`, expiresIn: VIEW_TOKEN_SECONDS };
}

function checkViewToken(cfg: Config, id: string, token: string | null): CameraRow {
  const bad = new HttpError(401, 'UNAUTHENTICATED', 'This camera link has expired. Reload the page.');
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) throw bad;
  const want = createHmac('sha256', cfg.jwtSecret).update('camview.' + body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw bad;
  let p: { u: string; o: string; exp: number };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw bad; }
  if (!p || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) throw bad;
  const r = getCamera(id);
  if (p.o !== '*' && p.o !== r.owner_id) throw notFound('Camera not found');
  if (!r.active) throw notFound('Camera not found');
  return r;
}

export function snapshot(cfg: Config, id: string, token: string | null): { buf: Buffer } {
  checkViewToken(cfg, id, token);
  const l = live.get(id);
  if (!l?.frame || now() - l.at > 60_000) throw new HttpError(404, 'NO_PICTURE', 'No picture from this camera right now');
  return { buf: l.frame };
}

export function openStream(cfg: Config, id: string, token: string | null, req: IncomingMessage, res: ServerResponse): void {
  checkViewToken(cfg, id, token);
  const l = liveOf(id);
  if (l.viewers.size >= MAX_VIEWERS_PER_CAMERA) throw new HttpError(429, 'TOO_MANY_VIEWERS', 'Too many people are watching this camera');
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=dajiframe',
    'Cache-Control': 'no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity', // tells Caddy not to compress (and so buffer) the stream
  });
  const send = (buf: Buffer) => {
    if (res.destroyed || res.writableNeedDrain) return; // a slow viewer skips pictures instead of building up memory
    res.write(`--dajiframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
    res.write(buf);
    res.write('\r\n');
  };
  l.viewers.add(res);
  l.bus.on('frame', send);
  if (l.frame && now() - l.at < 60_000) send(l.frame);
  const stop = () => { clearTimeout(timer); l.bus.off('frame', send); l.viewers.delete(res); };
  const timer = setTimeout(() => { try { res.end(); } catch { /* closed */ } }, MAX_STREAM_MS);
  timer.unref?.();
  req.on('close', stop);
  res.on('close', stop);
}
