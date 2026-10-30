import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { MAX_DOC_BYTES, addDocument, docFile } from '../docs.ts';
import {
  addBoqItem, addDefect, addMeasurement, addSupplierBill, cancelOrder, cancelRaBill, certifyRaBill, closeOrder, correctMeasurement, createOrder, createRaBill,
  finance, getProject, linkProjectDoc, listOrders, listProjectDocs, mustSee, orderContext, plan, portfolio, projectDocAllowed, receiveGoods, reviseBoqItem,
  site, startConstruction, submitOrder, updateDefect, updateDetails,
} from '../construction.ts';

// Construction inside Daji Admin (construction.ts): the portfolio, and per project the Overview, Plan, Commercial (BOQ, orders,
// receipts, measurements, RA bills), Site, Plans & Documents and Finance. Orders are approved on the Approvals board, and
// supplier bills land in Revenue & Accounting's bills. Commands that create money records take an Idempotency-Key.
export function constructionRoutes(r: Router): void {
  const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const I = { ...A, idempotent: true as const };
  const o = (c: Ctx) => ownerOrFail(c, 'work on construction');
  const P = '/api/construction';

  r.get(P, (c) => ok(portfolio(U(c), o(c))), A);
  r.post(`${P}/projects`, (c) => created(startConstruction(U(c), o(c), c.json())), I);
  r.get(`${P}/projects/:id`, (c) => ok(getProject(U(c), o(c), c.params.id!)), A);
  r.patch(`${P}/projects/:id`, (c) => ok(updateDetails(U(c), o(c), c.params.id!, c.json())), A);

  // Plan: the bill of quantities and the milestones
  r.get(`${P}/projects/:id/plan`, (c) => ok(plan(U(c), o(c), c.params.id!)), A);
  r.post(`${P}/projects/:id/boq`, (c) => created(addBoqItem(U(c), o(c), c.params.id!, c.json())), A);
  r.patch(`${P}/boq/:itemId`, (c) => ok(reviseBoqItem(U(c), o(c), c.params.itemId!, c.json())), A);

  // Commercial: orders and everything recorded against them
  r.get(`${P}/projects/:id/orders`, (c) => ok(listOrders(U(c), o(c), c.params.id!, c.query.get('status') ?? undefined)), A);
  r.post(`${P}/projects/:id/orders`, (c) => created(createOrder(U(c), o(c), c.params.id!, c.json())), I);
  r.get(`${P}/orders/:id`, (c) => ok(orderContext(U(c), o(c), c.params.id!)), A);
  r.post(`${P}/orders/:id/submit`, (c) => ok(submitOrder(U(c), o(c), c.params.id!)), I);
  r.post(`${P}/orders/:id/cancel`, (c) => ok(cancelOrder(U(c), o(c), c.params.id!, c.json())), A);
  r.post(`${P}/orders/:id/close`, (c) => ok(closeOrder(U(c), o(c), c.params.id!, c.json())), A);
  r.post(`${P}/orders/:id/receipts`, (c) => created(receiveGoods(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/orders/:id/bills`, (c) => created(addSupplierBill(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/orders/:id/measurements`, (c) => created(addMeasurement(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/measurements/:id/correct`, (c) => created(correctMeasurement(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/orders/:id/ra-bills`, (c) => created(createRaBill(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/ra-bills/:id/certify`, (c) => ok(certifyRaBill(U(c), o(c), c.params.id!, c.json())), I);
  r.post(`${P}/ra-bills/:id/cancel`, (c) => ok(cancelRaBill(U(c), o(c), c.params.id!)), A);

  // Site: the project's jobs, defects and goods received
  r.get(`${P}/projects/:id/site`, (c) => ok(site(U(c), o(c), c.params.id!)), A);
  r.post(`${P}/projects/:id/defects`, (c) => created(addDefect(U(c), o(c), c.params.id!, c.json())), A);
  r.patch(`${P}/defects/:id`, (c) => ok(updateDefect(U(c), o(c), c.params.id!, c.json())), A);

  // Plans & Documents: documents of the business, put on the project
  r.get(`${P}/projects/:id/documents`, (c) => ok(listProjectDocs(U(c), o(c), c.params.id!)), A);
  r.post(`${P}/projects/:id/documents/link`, (c) => created(linkProjectDoc(U(c), o(c), c.params.id!, c.json())), A);
  // POST the file as the body, with ?filename= &kind=drawing|document &drawingNo= &revision= &title=. It goes through the
  // virus-checked intake into Documents, and is then put on the project.
  r.post(`${P}/projects/:id/documents`, async (c) => {
    const u = U(c), owner = o(c);
    getProject(u, owner, c.params.id!);
    if (!hasPermission(u, 'manage_tasks')) throw forbidden('This needs the "manage_tasks" permission');
    const q = (k: string) => c.query.get(k) ?? undefined;
    const doc = await addDocument(c.cfg, owner, { id: u.id, role: u.role }, q('filename') ?? 'drawing', c.raw);
    return created(linkProjectDoc(u, owner, c.params.id!, { docId: doc.id, kind: q('kind'), title: q('title'), drawingNo: q('drawingNo'), revision: q('revision') }));
  }, { ...A, maxBody: MAX_DOC_BYTES + 1024, upload: 'document' });
  r.get(`${P}/documents/:docId/file`, (c): Reply => {
    const u = U(c), owner = o(c);
    projectDocAllowed(u, owner, c.params.docId!);
    const f = docFile(c.cfg, owner, c.params.docId!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Content-Disposition': `attachment; filename="${f.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, A);

  // Finance: the project's money, from the records that hold it
  r.get(`${P}/projects/:id/finance`, (c) => { mustSee(U(c)); return ok(finance(U(c), o(c), c.params.id!)); }, A);
}
