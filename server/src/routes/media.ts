import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, ownerFilter } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { addPhoto, listPhotos, readPhoto, removePhoto, MAX_PHOTO_BYTES } from '../media.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const FILE = { auth: STAFF, maxBody: MAX_PHOTO_BYTES + 1024 };

export function mediaRoutes(r: Router): void {
  const who = (c: Ctx) => {
    const u = U(c);
    if (u.role === 'staff' && !hasPermission(u, 'manage_grounds') && !hasPermission(u, 'manage_academy')) throw forbidden('Uploading photos needs the "manage_grounds" or "manage_academy" permission');
    return { owner: ownerFilter(c), actor: { id: u.id, role: u.role } };
  };
  r.post('/api/media', (c) => { const w = who(c); return created(addPhoto(c.cfg.dataDir, w.owner, w.actor, c.query.get('kind') ?? 'gallery', c.query.get('filename') ?? 'photo', c.raw)); }, FILE);
  r.get('/api/media', (c) => { const w = who(c); return ok({ items: listPhotos(w.owner, c.query.get('kind') ?? undefined) }); }, { auth: STAFF });
  r.del('/api/media/:id', (c) => { const w = who(c); removePhoto(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, { auth: STAFF });
  // Public: photos are shown on the website. Forbidden to run as a page, and the type was fixed at upload.
  r.get('/api/media/:id', (c): Reply => {
    const f = readPhoto(c.cfg.dataDir, c.params.id!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' } };
  }, { rate: 'none' });
}
