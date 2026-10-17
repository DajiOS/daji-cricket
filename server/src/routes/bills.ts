import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { HttpError, forbidden } from '../errors.ts';
import { hasPermission, requireRevenue } from '../auth.ts';
import { MAX_ATTACHMENT_BYTES } from '../accounting/books.ts';
import { addBillFile, approvalsCount, approveBill, createBill, createVendor, deleteBill, deleteVendor, getBill, linkableTransactions, listBills, listVendors, payBill, readBillFile, rejectBill, removeBillFile, submitBill, updateBill, updateVendor } from '../accounting/bills.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF };
const FILE = { auth: STAFF, maxBody: MAX_ATTACHMENT_BYTES + 1024 };

export function billsRoutes(r: Router): void {
  const read = (c: Ctx) => { const u = U(c); if (!hasPermission(u, 'view_reports') && !hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "view_reports" permission'); requireRevenue(u); return ownerOrFail(c, 'use bills'); };
  const write = (c: Ctx) => { const u = U(c); if (!hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "manage_accounting" permission'); return { owner: ownerOrFail(c, 'use bills'), actor: { id: u.id, role: u.role } }; };
  const date = (c: Ctx, k: string): string | undefined => { const v = c.query.get(k); if (!v) return undefined; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'VALIDATION_FAILED', `${k} must be a date`); return v; };

  // ---- vendors
  r.get('/api/accounting/vendors', (c) => { const o = read(c); return ok({ items: listVendors(o, c.query.get('q') ?? undefined) }); }, A);
  r.post('/api/accounting/vendors', (c) => { const w = write(c); return created(createVendor(w.owner, w.actor, c.json())); }, A);
  r.patch('/api/accounting/vendors/:id', (c) => { const w = write(c); return ok(updateVendor(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/accounting/vendors/:id', (c) => { const w = write(c); deleteVendor(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);

  // ---- approvals badge and queue
  r.get('/api/accounting/approvals/count', (c) => { const o = read(c); return ok({ count: approvalsCount(o) }); }, A);

  // ---- bills
  r.get('/api/accounting/bills', (c) => {
    const o = read(c);
    return ok(listBills(o, {
      status: c.query.get('status') || undefined, q: c.query.get('q') ?? undefined, vendorId: c.query.get('vendorId') || undefined, categoryId: c.query.get('categoryId') || undefined,
      overdue: c.query.get('overdue') === '1', dueWeek: c.query.get('dueWeek') === '1', from: date(c, 'from'), to: date(c, 'to'),
    }));
  }, A);
  r.get('/api/accounting/bills/linkable', (c) => { const o = read(c); const n = Number(c.query.get('amountPaise')); return ok({ items: linkableTransactions(o, Number.isInteger(n) && n > 0 ? n : undefined) }); }, A);
  r.post('/api/accounting/bills', (c) => { const w = write(c); return created(createBill(w.owner, w.actor, c.json())); }, A);
  r.get('/api/accounting/bills/:id', (c) => { const o = read(c); return ok(getBill(o, c.params.id!)); }, A);
  r.patch('/api/accounting/bills/:id', (c) => { const w = write(c); return ok(updateBill(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/accounting/bills/:id', (c) => { const w = write(c); deleteBill(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, A);
  r.post('/api/accounting/bills/:id/submit', (c) => { const w = write(c); return ok(submitBill(w.owner, w.actor, c.params.id!)); }, A);
  r.post('/api/accounting/bills/:id/approve', (c) => { const w = write(c); return ok(approveBill(w.owner, w.actor, c.params.id!)); }, A);
  r.post('/api/accounting/bills/:id/reject', (c) => { const w = write(c); return ok(rejectBill(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.post('/api/accounting/bills/:id/pay', (c) => { const w = write(c); return ok(payBill(w.owner, w.actor, c.params.id!, c.json())); }, A);

  // ---- the scan or photo of the bill: the file is the request body
  r.post('/api/accounting/bills/:id/files', (c) => { const w = write(c); return created(addBillFile(c.cfg.dataDir, w.owner, w.actor, c.params.id!, c.query.get('filename') ?? 'bill', c.raw)); }, FILE);
  r.get('/api/accounting/bills/:id/files/:fid', (c): Reply => {
    const o = read(c); const f = readBillFile(c.cfg.dataDir, o, c.params.id!, c.params.fid!);
    return { status: 200, raw: f.data, contentType: f.meta.mime, headers: { 'Content-Disposition': `attachment; filename="${f.meta.filename.replace(/"/g, '')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, A);
  r.del('/api/accounting/bills/:id/files/:fid', (c) => { const w = write(c); removeBillFile(w.owner, w.actor, c.params.id!, c.params.fid!); return ok({ removed: true }); }, A);
}
