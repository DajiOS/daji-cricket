import type { Ctx, Reply } from '../http.ts';
import { Router, ok } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { one } from '../db.ts';
import { notFound } from '../errors.ts';
import { acceptRequest, disconnectSheet, downloadWorkbook, finishSignIn, linkSheetFile, listInbox, needOwner, needReview, pullFromFile, pullSheet, pushSheet, rejectRequest, saveSheetSettings, startSignIn, viewSheet } from '../sheets.ts';

/** Largest workbook or CSV accepted back from people using the sheet. */
export const MAX_SHEET_UPLOAD = 10 * 1024 * 1024;

// The shared spreadsheet (Settings › Connections). Under /api/desk so the software owner's ?ownerId= picks the business; every call is about one business only.
export function sheetsRoutes(r: Router): void {
  const S = { auth: ['owner' as const, 'staff' as const, 'super_admin' as const] };
  const owner = (c: Ctx): string => {
    const o = ownerOrFail(c, 'use the shared spreadsheet');
    if (!one("SELECT 1 FROM users WHERE id = ? AND role = 'owner'", o)) throw notFound('No such business');
    return o;
  };
  const actor = (c: Ctx) => ({ id: U(c).id, role: U(c).role });

  r.get('/api/desk/sheets', (c) => ok(viewSheet(c.cfg, U(c), owner(c))), S);
  r.put('/api/desk/sheets', (c) => ok(saveSheetSettings(c.cfg, U(c), owner(c), c.json())), S);
  r.post('/api/desk/sheets/signin', (c) => ok(startSignIn(c.cfg, U(c), owner(c))), S);
  r.post('/api/desk/sheets/file', async (c) => ok(await linkSheetFile(c.cfg, U(c), owner(c), c.json())), { ...S, rate: 'auth' });
  r.post('/api/desk/sheets/disconnect', (c) => ok(disconnectSheet(c.cfg, U(c), owner(c))), S);
  r.get('/api/desk/sheets/download', (c): Reply => {
    const f = downloadWorkbook(U(c), owner(c));
    return { status: 200, raw: f.data, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store' } };
  }, S);
  r.post('/api/desk/sheets/push', async (c) => { needOwner(U(c)); return ok(await pushSheet(c.cfg, actor(c), owner(c))); }, { ...S, rate: 'auth' });
  r.post('/api/desk/sheets/pull', async (c) => { needReview(U(c)); return ok(await pullSheet(c.cfg, actor(c), owner(c))); }, { ...S, rate: 'auth' });
  r.post('/api/desk/sheets/upload', (c) => ok(pullFromFile(U(c), owner(c), c.query.get('filename') ?? 'sheet.xlsx', c.raw)), { ...S, maxBody: MAX_SHEET_UPLOAD, upload: 'sheet_import' });
  r.get('/api/desk/sheets/inbox', (c) => ok(listInbox(U(c), owner(c), c.query.get('status') ?? undefined)), S);
  r.post('/api/desk/sheets/inbox/:id/accept', (c) => ok(acceptRequest(U(c), owner(c), c.params.id!)), S);
  r.post('/api/desk/sheets/inbox/:id/reject', (c) => ok(rejectRequest(U(c), owner(c), c.params.id!, c.json())), S);

  // Microsoft or Google sends the browser back here after the sign-in; the one-time state says which business it is for
  r.get('/api/sheets/oauth/callback', async (c): Promise<Reply> => ({ status: 302, headers: { Location: await finishSignIn(c.cfg, c.query), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), { rate: 'auth' });
}
