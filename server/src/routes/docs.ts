import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { addDocument, createFolder, docFile, getDoc, linkImport, listDocs, listFolders, MAX_DOC_BYTES, readWithAi, removeDoc, removeFolder, renameFolder, searchDocs, seesDocs, updateDoc, waitingCount } from '../docs.ts';
import { importStatement } from '../accounting/import.ts';
import { readPdfStatement } from '../accounting/pdfstatement.ts';
import { autoMatch } from '../accounting/books.ts';
import { HttpError } from '../errors.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF };

export function docsRoutes(r: Router): void {
  const who = (c: Ctx) => { const u = U(c); if (!seesDocs(u)) throw forbidden('Documents need the "manage_accounting" permission'); return { owner: ownerOrFail(c, 'use documents'), actor: { id: u.id, role: u.role } }; };

  r.get('/api/docs/folders', (c) => { const w = who(c); return ok({ items: listFolders(w.owner), waiting: waitingCount(w.owner), aiReady: !!c.cfg.ai.apiKey }); }, A);
  r.post('/api/docs/folders', (c) => { const w = who(c); return created(createFolder(w.owner, w.actor, c.json())); }, A);
  r.patch('/api/docs/folders/:id', (c) => { const w = who(c); return ok(renameFolder(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/docs/folders/:id', (c) => { const w = who(c); removeFolder(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);

  // the file is the request body; it is virus-checked before the handler runs
  r.post('/api/docs', async (c) => { const w = who(c); return created(await addDocument(c.cfg, w.owner, w.actor, c.query.get('filename') ?? 'document', c.raw)); }, { auth: STAFF, maxBody: MAX_DOC_BYTES + 1024, upload: 'document' });
  r.get('/api/docs', (c) => { const w = who(c); return ok({ items: listDocs(w.owner, { folderId: c.query.get('folderId') ?? undefined, linkKind: c.query.get('linkKind') ?? undefined, linkId: c.query.get('linkId') ?? undefined }) }); }, A);
  r.get('/api/docs/search', (c) => { const w = who(c); return ok({ items: searchDocs(w.owner, c.query.get('q') ?? '', 20) }); }, A);
  r.get('/api/docs/:id', (c) => { const w = who(c); return ok(getDoc(w.owner, c.params.id!)); }, A);
  r.get('/api/docs/:id/file', (c): Reply => {
    const w = who(c); const f = docFile(c.cfg, w.owner, c.params.id!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Content-Disposition': `attachment; filename="${f.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, A);
  r.patch('/api/docs/:id', (c) => { const w = who(c); return ok(updateDoc(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/docs/:id', (c) => { const w = who(c); removeDoc(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);
  r.post('/api/docs/:id/read', async (c) => { const w = who(c); return ok(await readWithAi(c.cfg, w.owner, w.actor, c.params.id!)); }, A);

  // a bank statement kept in Documents goes into the books from here, through the same import as Bank import
  r.post('/api/docs/:id/import-statement', async (c) => {
    const w = who(c);
    if (!hasPermission(U(c), 'manage_accounting')) throw forbidden('This needs the "manage_accounting" permission');
    const accountId = String((c.json() as { accountId?: unknown }).accountId ?? '');
    if (!accountId) throw new HttpError(400, 'VALIDATION_FAILED', 'Pick the bank account', { fields: [{ field: 'accountId', message: 'Required' }] });
    const f = docFile(c.cfg, w.owner, c.params.id!);
    const pre = f.mime === 'application/pdf' ? await readPdfStatement(f.data) : undefined;
    // a PDF whose totals disagree with its balance column is checked row by row first, in Bank import
    if (importStatement(w.owner, w.actor, accountId, f.name, f.data, true, pre).reviewRequired && (c.json() as { confirm?: unknown }).confirm !== true) throw new HttpError(409, 'REVIEW_REQUIRED', 'The totals in this PDF do not agree with its balance column. Check it row by row in Bank import before bringing it into the books.');
    const res = importStatement(w.owner, w.actor, accountId, f.name, f.data, false, pre);
    const auto = autoMatch(w.owner, w.actor);
    if (res.importId) linkImport(c.params.id!, res.importId, `Imported ${res.rowsNew} transactions`);
    return created({ ...res, autoMatched: auto.matched });
  }, A);
}
