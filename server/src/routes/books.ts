import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { HttpError, forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { accountChecks, addAttachment, attachmentCounts, autoMatch, createRecurring, deleteRecurring, listAttachments, listRecurring, matchPayment, MAX_ATTACHMENT_BYTES, readAttachment, reconciliationQueue, removeAttachment, runRecurring, unmatchPayment, updateRecurring } from '../accounting/books.ts';
import { applyRules, createRule, deleteRule, importStatement, listImports, listRules, undoImport, updateRule, type ParsedStatement } from '../accounting/import.ts';
import { readPdfStatement } from '../accounting/pdfstatement.ts';
import { createHash } from 'node:crypto';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF };
const BIG = { auth: STAFF, maxBody: 16 * 1024 * 1024 };
const FILE = { auth: STAFF, maxBody: MAX_ATTACHMENT_BYTES + 1024 };

const pdfCache = new Map<string, ParsedStatement>();
export function booksRoutes(r: Router): void {
  const read = (c: Ctx) => { const u = U(c); if (!hasPermission(u, 'view_reports') && !hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "view_reports" permission'); return ownerOrFail(c, 'use the books'); };
  const write = (c: Ctx) => { const u = U(c); if (!hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "manage_accounting" permission'); return { owner: ownerOrFail(c, 'use the books'), actor: { id: u.id, role: u.role } }; };
  const q = (c: Ctx, k: string): string => { const v = c.query.get(k); if (!v) throw new HttpError(400, 'VALIDATION_FAILED', `${k} is required`, { fields: [{ field: k, message: 'Required' }] }); return v; };

  // ---- attachments: the file is the request body (not JSON), its type is read from its first bytes
  r.post('/api/accounting/attachments', (c) => { const w = write(c); return created(addAttachment(c.cfg.dataDir, w.owner, w.actor, q(c, 'entity'), q(c, 'id'), c.query.get('filename') ?? 'document', c.raw)); }, FILE);
  r.get('/api/accounting/attachments', (c) => { const o = read(c); return ok({ items: listAttachments(o, q(c, 'entity'), q(c, 'id')) }); }, A);
  r.post('/api/accounting/attachment-counts', (c) => { const o = read(c); const b = c.json() as { entity?: string; ids?: string[] }; return ok(attachmentCounts(o, b.entity === 'journal' ? 'journal' : 'transaction', Array.isArray(b.ids) ? b.ids.slice(0, 200).map(String) : [])); }, A);
  r.get('/api/accounting/attachments/:id/file', (c): Reply => {
    const o = read(c); const f = readAttachment(c.cfg.dataDir, o, c.params.id!);
    return { status: 200, raw: f.data, contentType: f.meta.mime, headers: { 'Content-Disposition': `attachment; filename="${f.meta.filename.replace(/"/g, '')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, A);
  r.del('/api/accounting/attachments/:id', (c) => { const w = write(c); removeAttachment(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);

  // ---- bank statements: the file is the request body. ?dryRun=1 previews without saving
  r.post('/api/accounting/imports', async (c) => {
    const w = write(c);
    const dry = c.query.get('dryRun') === '1';
    const buf = c.raw;
    let pre: ParsedStatement | undefined;
    if (buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      // the preview already read the PDF; the import that follows reuses that result instead of reading it again
      const pw = String(c.req.headers['x-statement-password'] ?? '');
      const key = createHash('sha256').update(buf).update(pw).digest('hex');
      pre = pdfCache.get(key);
      if (!pre) { pre = await readPdfStatement(buf, pw || undefined); pdfCache.set(key, pre); if (pdfCache.size > 8) pdfCache.delete(pdfCache.keys().next().value!); }
    }
    const res = importStatement(w.owner, w.actor, q(c, 'accountId'), c.query.get('filename') ?? 'statement', buf, dry, pre);
    if (!dry && res.reviewRequired && c.query.get('confirm') !== '1') throw new HttpError(409, 'REVIEW_REQUIRED', 'The totals in this PDF do not agree with its balance column. Check the rows, then confirm to import.');
    // after every real import, tie UPI/bank deposits to booking payments by their 12-digit UTR
    const auto = dry ? null : autoMatch(w.owner, w.actor);
    return created({ ...res, autoMatched: auto?.matched ?? 0 });
  }, BIG);
  r.get('/api/accounting/imports', (c) => { const o = read(c); return ok({ items: listImports(o) }); }, A);
  r.post('/api/accounting/imports/:id/undo', (c) => { const w = write(c); return ok(undoImport(w.owner, w.actor, c.params.id!)); }, A);

  // ---- categorising rules
  r.get('/api/accounting/rules', (c) => { const o = read(c); return ok({ items: listRules(o) }); }, A);
  r.post('/api/accounting/rules', (c) => { const w = write(c); return created(createRule(w.owner, w.actor, c.json())); }, A);
  r.patch('/api/accounting/rules/:id', (c) => { const w = write(c); return ok(updateRule(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/accounting/rules/:id', (c) => { const w = write(c); deleteRule(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);
  r.post('/api/accounting/rules/apply', (c) => { const w = write(c); return ok(applyRules(w.owner, w.actor, c.query.get('accountId') ?? undefined)); }, A);

  // ---- reconciliation of bank deposits against booking payments
  r.get('/api/accounting/reconcile', (c) => { const o = read(c); return ok({ ...reconciliationQueue(o, c.query.get('accountId') ?? undefined), accounts: accountChecks(o) }); }, A);
  r.post('/api/accounting/reconcile/auto', (c) => { const w = write(c); return ok(autoMatch(w.owner, w.actor)); }, A);
  r.post('/api/accounting/transactions/:id/match', (c) => { const w = write(c); matchPayment(w.owner, w.actor, c.params.id!, (c.json() as { paymentId?: unknown }).paymentId); return ok({ matched: true }); }, A);
  r.post('/api/accounting/transactions/:id/unmatch', (c) => { const w = write(c); unmatchPayment(w.owner, w.actor, c.params.id!); return ok({ matched: false }); }, A);

  // ---- recurring entries
  r.get('/api/accounting/recurring', (c) => { const o = read(c); return ok({ items: listRecurring(o) }); }, A);
  r.post('/api/accounting/recurring', (c) => { const w = write(c); return created(createRecurring(w.owner, w.actor, c.json())); }, A);
  r.patch('/api/accounting/recurring/:id', (c) => { const w = write(c); return ok(updateRecurring(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/accounting/recurring/:id', (c) => { const w = write(c); deleteRecurring(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);
  r.post('/api/accounting/recurring/run', (c) => { const w = write(c); return ok(runRecurring(w.owner, w.actor)); }, A);
}
