import { Router, ok, created } from '../http.ts';
import type { Reply } from '../http.ts';
import { U } from './helpers.ts';
import { bulkIds, diskInfo, listLibrary, removeFile, removeMany, saveUpload, setTag, setTagMany } from '../library.ts';

const ADMIN: ('owner' | 'super_admin')[] = ['owner', 'super_admin'];

export function libraryRoutes(r: Router): void {
  // The file is the request body itself, streamed to disk, so there is no size limit beyond the server's free space.
  r.post('/api/library', async (c): Promise<Reply> => created(await saveUpload(c.cfg.dataDir, c.req, U(c).id, c.query.get('name') ?? 'file', c.query.get('tag') ?? 'gallery')), { auth: ADMIN, stream: true, rate: 'none' });
  r.get('/api/library', (c) => ok({ items: listLibrary(c.query.get('tag') ?? undefined), ...diskInfo(c.cfg.dataDir) }), { auth: ADMIN });
  r.patch('/api/library/:id', (c) => ok(setTag(c.params.id!, String((c.json() as { tag?: string }).tag ?? ''))), { auth: ADMIN });
  r.del('/api/library/:id', (c) => { removeFile(c.cfg.dataDir, c.params.id!); return ok({ removed: true }); }, { auth: ADMIN });
  // Several files at once. Every file gets its own result, so the page can say which ones did not go through.
  r.post('/api/library/bulk-remove', (c) => ok({ results: removeMany(c.cfg.dataDir, bulkIds(c.json())) }), { auth: ADMIN });
  r.post('/api/library/bulk-tag', (c) => ok({ results: setTagMany(bulkIds(c.json()), String((c.json() as { tag?: string }).tag ?? '')) }), { auth: ADMIN });
  // Public: what the website shows (for example the hero video and the gallery), newest first.
  r.get('/api/library/public', (c) => ok({ items: listLibrary(c.query.get('tag') ?? undefined) }), { rate: 'none' });
}
