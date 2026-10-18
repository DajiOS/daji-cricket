import { Router, ok, created, HANDLED } from '../http.ts';
import type { Reply } from '../http.ts';
import { U, ownerOrFail, ownerFilter } from './helpers.ts';
import { createCamera, ingestFrame, listCameras, makeViewToken, openStream, removeCamera, requireCameraAdmin, requireCameraView, rotateCameraToken, snapshot, updateCamera } from '../cameras.ts';

const STAFF_SIDE: ('owner' | 'super_admin' | 'staff')[] = ['owner', 'super_admin', 'staff'];

export function cameraRoutes(r: Router): void {
  r.get('/api/cameras', (c) => { requireCameraView(U(c)); return ok(listCameras(U(c), ownerFilter(c))); }, { auth: STAFF_SIDE });
  r.post('/api/cameras', (c) => {
    requireCameraAdmin(U(c));
    return created(createCamera(U(c), ownerOrFail(c, 'add a camera'), (c.json() as { name?: unknown }).name));
  }, { auth: STAFF_SIDE });
  r.patch('/api/cameras/:id', (c) => { requireCameraAdmin(U(c)); return ok(updateCamera(U(c), c.params.id!, c.json() as { name?: unknown; active?: unknown })); }, { auth: STAFF_SIDE });
  r.post('/api/cameras/:id/token', (c) => { requireCameraAdmin(U(c)); return ok(rotateCameraToken(U(c), c.params.id!)); }, { auth: STAFF_SIDE });
  r.del('/api/cameras/:id', (c) => { requireCameraAdmin(U(c)); removeCamera(U(c), c.params.id!); return ok({ removed: true }); }, { auth: STAFF_SIDE });

  // A link token for the <img> tags that show the pictures.
  r.post('/api/cameras/view-token', (c) => ok(makeViewToken(c.cfg, U(c))), { auth: STAFF_SIDE });

  // Public routes: the bridge proves itself with the camera's own secret token, the browser with a short-lived view token.
  r.put('/api/cameras/:id/frame', async (c): Promise<Reply> => ok(await ingestFrame(c.params.id!, c.req)), { stream: true, rate: 'none' });
  r.get('/api/cameras/:id/stream', (c) => { openStream(c.cfg, c.params.id!, c.query.get('t'), c.req, c.res); return HANDLED as unknown as Reply; }, { rate: 'none' });
  r.get('/api/cameras/:id/snapshot', (c) => {
    const { buf } = snapshot(c.cfg, c.params.id!, c.query.get('t'));
    return { status: 200, raw: buf, contentType: 'image/jpeg', headers: { 'Cache-Control': 'no-store' } };
  }, { rate: 'none' });
}
