import { Router, ok, created } from '../http.ts';
import { U, page, ownerFilter, ownerOrFail, groundInScope } from './helpers.ts';
import { Validator } from '../input.ts';
import { HttpError, notFound } from '../errors.ts';
import { audit } from '../audit.ts';
import { checkPasswordStrength, createUser, hasPermission, listStaff, requirePermission, requireRevenue, scopeOwnerId, toUser, userRow } from '../auth.ts';
import { one, many, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { ROLE_PRESETS, STAFF_PERMISSIONS, type StaffPermission } from '@daji/shared';
import { accessBooking, approveBooking, blockOf, bookingPayments, clearReview, listBookings, markNoShow, viewBooking } from '../bookings.ts';
import { cancelBlock, settleBlock, settleForCustomer } from '../cancellation.ts';
import { tournamentForBlock } from '../tournaments.ts';
import { lookupCustomer, readName, createStaffBlock, createStaffBooking, parseBlock, parseWalkIn, recordBlockPayment } from '../hold.ts';
import { cancelBooking, previewCancel } from '../cancellation.ts';
import { createPromos, listPromos, setPromoActive } from '../promo.ts';
import { completeManualRefund, requestRefund, listPayments, listRefunds, paymentHistory, paymentOr404, recordOffline, verifyUpi } from '../payments.ts';
import { blockRange, createGround, listGrounds, toGround, unblockRange, updateGround } from '../grounds.ts';
import { addEnquiryNote, closeEnquiry, convertEnquiry, convertEnquiryToBlock, getEnquiry, listEnquiries, sendQuotation } from '../enquiries.ts';
import { customerList, overview, parseRange } from '../reports.ts';
import * as credits from '../credits.ts';
import { listAudit } from '../audit.ts';
import { istDate, istMidnight } from '../time.ts';
import { moveTask, listComments, addComment, listProjects, createProject, updateProject, addMilestone, updateMilestone } from '../taskboard.ts';
import { addTaskPhoto, cancelTask, checkStep, completeTask, createTask, getTaskOut, listTasks, readTaskPhoto, reopenTask, updateTask, MAX_TASK_PHOTO_BYTES } from '../tasks.ts';
import type { Reply } from '../http.ts';

const STAFF_ROLES: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];

function perms(v: Validator, key: string): StaffPermission[] | undefined {
  const arr = v.strArray(key, { max: 20, itemMax: 40 });
  if (!arr) return undefined;
  const bad = arr.filter((p) => !(STAFF_PERMISSIONS as readonly string[]).includes(p));
  if (bad.length) { v.fail(key, `Unknown permission: ${bad.join(', ')}`); return undefined; }
  return [...new Set(arr)] as StaffPermission[];
}

const needPay = (u: Parameters<typeof hasPermission>[0]): void => { if (u.role === 'staff' && !hasPermission(u, 'verify_payments') && !hasPermission(u, 'record_payments') && !hasPermission(u, 'view_revenue')) throw new HttpError(403, 'FORBIDDEN', 'This needs a payments permission'); };

export function staffRoutes(r: Router): void {
  const A = { auth: STAFF_ROLES };

  // ---- bookings
  r.get('/api/staff/bookings', (c) => {
    const u = U(c);
    if (u.role === 'staff') requirePermission(u, 'manage_bookings');
    const { limit, offset } = page(c);
    return ok(listBookings({
      ownerId: ownerFilter(c), groundId: c.query.get('groundId') ?? undefined, status: c.query.get('status') ?? undefined, from: c.query.get('from') ?? undefined,
      to: c.query.get('to') ?? undefined, q: c.query.get('q') ?? undefined, needsReview: c.query.get('needsReview') === '1', collapse: c.query.get('group') === '1', approval: c.query.get('approval') === 'pending' ? 'pending' : undefined, resolution: c.query.get('resolution') === 'awaiting' ? 'awaiting' : undefined, limit, offset,
    }));
  }, A);

  r.get('/api/staff/bookings/:id', (c) => {
    const b = accessBooking(U(c), c.params.id!, 'manage_bookings');
    const payments = bookingPayments(b.id);
    return ok({ booking: viewBooking(b.id), block: b.series_id ? blockOf(b.series_id) : null, payments, refunds: listRefunds(b.owner_id).filter((x) => x.bookingId === b.id || (b.series_id && seriesBookingIds(b.series_id).includes(x.bookingId))), audit: listAudit({ entity: 'booking', entityId: b.id, limit: 100 }).items });
  }, A);

  r.post('/api/staff/bookings', (c) => created({ booking: createStaffBooking(U(c), parseWalkIn(c.json())) }), { ...A, idempotent: true });

  // One booking per day for a run of days at one agreed total (camps, tournaments, shoots)
  r.post('/api/staff/bookings/block', (c) => {
    const u = U(c), body = c.json() as any;
    const tn = body?.tournament;
    if (tn) requirePermission(u, 'manage_matches'); // a tournament is made alongside the booking
    return tx(() => {
    const out = createStaffBlock(u, parseBlock(body));
    if (!tn || typeof tn !== 'object') return created(out);
    const owner = scopeOwnerId(u) ?? ownerOrFail(c, 'run tournaments');
    const cu = out.bookings[0]!;
    const bc = body.customer ?? {};
    const full = String(bc.name ?? '').trim(), sp = full.indexOf(' ');
    const org = { first: bc.firstName ? String(bc.firstName) : sp < 0 ? full : full.slice(0, sp), last: bc.firstName ? String(bc.lastName ?? '') : sp < 0 ? '' : full.slice(sp + 1), phone: body.customer?.phone ?? null, email: body.customer?.email ?? null };
    const tournament = tournamentForBlock({ id: u.id, role: u.role }, owner, out.series.id, tn, org, cu.customerId ?? null);
    return created({ ...out, tournament });
    });
  }, { ...A, idempotent: true });

  // One payment for a whole multi-day booking: it fills the earliest days first
  r.post('/api/staff/bookings/block/:seriesId/payments', (c) => {
    const v = new Validator(c.json());
    const method = v.oneOf('method', ['cash', 'card', 'upi', 'bank_transfer'] as const, true);
    const amountPaise = v.int('amountPaise', { required: true, min: 1 });
    const reference = v.str('reference', { max: 60 });
    const note = v.str('note', { max: 200 });
    v.done();
    return created({ block: recordBlockPayment(U(c), c.params.seriesId!, { method: method!, amountPaise: amountPaise!, reference, note }) });
  }, { ...A, idempotent: true });

  // Cancel every day of a multi-day booking at once; `settle` also returns the money (or credits it) now
  r.post('/api/staff/bookings/block/:seriesId/cancel', (c) => {
    const v = new Validator(c.json());
    const reason = v.str('reason', { max: 300 });
    const settle = v.oneOf('settle', ['refund', 'half', 'credit'] as const);
    const offers = v.strArray('offers', { max: 3, itemMax: 10 });
    v.done();
    return ok({ ...cancelBlock(U(c), c.params.seriesId!, { reason, settle, offers }), block: blockOf(c.params.seriesId!) });
  }, { ...A, idempotent: true });
  r.post('/api/staff/bookings/block/:seriesId/settle', (c) => {
    const v = new Validator(c.json());
    const choice = v.oneOf('choice', ['refund', 'half', 'credit'] as const, true);
    v.done();
    return ok({ ...settleBlock(U(c), c.params.seriesId!, choice!), block: blockOf(c.params.seriesId!) });
  }, { ...A, idempotent: true });
  // Settle one cancelled booking for the customer (they agreed in person or by phone)
  r.post('/api/staff/bookings/:id/settle', (c) => {
    const v = new Validator(c.json());
    const choice = v.oneOf('choice', ['refund', 'half', 'credit'] as const, true);
    v.done();
    return ok(settleForCustomer(U(c), c.params.id!, choice!));
  }, { ...A, idempotent: true });

  r.post('/api/staff/bookings/:id/payments', (c) => {
    const v = new Validator(c.json());
    const method = v.oneOf('method', ['cash', 'card', 'upi', 'bank_transfer'] as const, true);
    const amountPaise = v.int('amountPaise', { required: true, min: 1 });
    const reference = v.str('reference', { max: 60 });
    const note = v.str('note', { max: 200 });
    v.done();
    const out = recordOffline(U(c), c.params.id!, { method: method!, amountPaise: amountPaise!, reference, note });
    return created({ ...out, booking: viewBooking(c.params.id!) });
  }, { ...A, idempotent: true });

  r.post('/api/staff/bookings/:id/no-show', (c) => {
    const b = accessBooking(U(c), c.params.id!, 'manage_bookings');
    markNoShow({ id: U(c).id, role: U(c).role }, b.id);
    return ok({ booking: viewBooking(b.id) });
  }, { ...A, idempotent: true });

  r.post('/api/staff/bookings/:id/approve', (c) => {
    const b = accessBooking(U(c), c.params.id!, 'manage_bookings');
    approveBooking({ id: U(c).id, role: U(c).role }, b.id);
    return ok({ booking: viewBooking(b.id) });
  }, A);

  r.post('/api/staff/bookings/:id/review-done', (c) => {
    const b = accessBooking(U(c), c.params.id!, 'manage_bookings');
    clearReview({ id: U(c).id, role: U(c).role }, b.id);
    return ok({ booking: viewBooking(b.id) });
  }, A);

  r.get('/api/staff/bookings/:id/cancel-preview', (c) => {
    const b = accessBooking(U(c), c.params.id!, 'manage_bookings');
    const waive = c.query.get('waive') === '1';
    if (waive && b.paid_paise > 0) throw new HttpError(409, 'WAIVE_NOT_APPLICABLE', 'This booking has been paid, so cancelling it offers the customer a full refund or credit instead');
    return ok(previewCancel(b, { waive }));
  }, A);

  // Promo codes: owners make their own, the super admin makes ones that work at every ground.
  const P = { auth: ['owner' as const, 'super_admin' as const] };
  r.get('/api/staff/promos', (c) => ok({ items: listPromos(U(c)) }), P);
  r.post('/api/staff/promos', (c) => created({ items: createPromos(U(c), c.json()) }), P);
  r.post('/api/staff/promos/:id/active', (c) => { const v = new Validator(c.json()); const active = v.bool('active', true); v.done(); return ok(setPromoActive(U(c), c.params.id!, !!active)); }, P);

  // ---- tasks: jobs for the team, closed with camera photos taken within the last 5 minutes
  r.get('/api/tasks', (c) => ok(listTasks(U(c), ownerFilter(c), c.query.get('status') ?? undefined, c.query.get('projectId') ?? undefined)), A);
  r.post('/api/tasks', (c) => created(createTask(U(c), ownerOrFail(c, 'add a task'), c.json())), A);
  // the board: moving cards, comments, projects and milestones
  r.post('/api/tasks/:id/move', (c) => ok(moveTask(U(c), c.params.id!, c.json())), A);
  r.get('/api/tasks/:id/comments', (c) => ok(listComments(U(c), c.params.id!)), A);
  r.post('/api/tasks/:id/comments', (c) => created(addComment(U(c), c.params.id!, c.json())), A);
  r.get('/api/projects', (c) => ok(listProjects(U(c), ownerFilter(c))), A);
  r.post('/api/projects', (c) => created(createProject(U(c), ownerOrFail(c, 'add a project'), c.json())), A);
  r.patch('/api/projects/:id', (c) => ok(updateProject(U(c), c.params.id!, c.json())), A);
  r.post('/api/projects/:id/milestones', (c) => created(addMilestone(U(c), c.params.id!, c.json())), A);
  r.patch('/api/milestones/:id', (c) => ok(updateMilestone(U(c), c.params.id!, c.json())), A);
  r.get('/api/tasks/:id', (c) => ok(getTaskOut(U(c), c.params.id!)), A);
  r.patch('/api/tasks/:id', (c) => ok(updateTask(U(c), c.params.id!, c.json())), A);
  r.post('/api/tasks/:id/photos', (c) => created(addTaskPhoto(c.cfg.dataDir, U(c), c.params.id!, c.raw, c.query.get('note') ?? undefined, c.req.headers['x-app-shot-at'] ? Number(c.req.headers['x-app-shot-at']) : undefined)), { auth: STAFF_ROLES, maxBody: MAX_TASK_PHOTO_BYTES + 1024 });
  r.post('/api/tasks/:id/checklist', (c) => ok(checkStep(U(c), c.params.id!, c.json())), A);
  r.post('/api/tasks/:id/complete', (c) => { const v = new Validator(c.json()); const note = v.str('note', { max: 300 }); v.done(); return ok(completeTask(U(c), c.params.id!, note)); }, A);
  r.post('/api/tasks/:id/reopen', (c) => ok(reopenTask(U(c), c.params.id!)), A);
  r.post('/api/tasks/:id/cancel', (c) => ok(cancelTask(U(c), c.params.id!)), A);
  r.get('/api/tasks/photos/:id', (c): Reply => {
    const f = readTaskPhoto(c.cfg.dataDir, U(c), c.params.id!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, A);

  r.post('/api/staff/bookings/:id/cancel', (c) => {
    const v = new Validator(c.json());
    const reason = v.str('reason', { max: 300 });
    const waive = v.bool('waive');
    const prefer = v.oneOf('prefer', ['refund', 'credit'] as const);
    const offers = v.strArray('offers', { max: 3, itemMax: 10 });
    v.done();
    return ok(cancelBooking(U(c), c.params.id!, { reason, waive, prefer, offers }));
  }, { ...A, idempotent: true });

  // ---- payments and refunds
  r.get('/api/staff/payments', (c) => {
    const u = U(c);
    if (u.role === 'staff' && !hasPermission(u, 'verify_payments') && !hasPermission(u, 'record_payments') && !hasPermission(u, 'view_reports')) throw new HttpError(403, 'FORBIDDEN', 'This needs a payments permission');
    const { limit, offset } = page(c);
    const from = c.query.get('from'), to = c.query.get('to');
    return ok(listPayments({ ownerId: ownerFilter(c), status: c.query.get('status') ?? undefined, method: c.query.get('method') ?? undefined, from: from ? istMidnight(from) : undefined, to: to ? istMidnight(to) + 86_400_000 : undefined, limit, offset }));
  }, A);

  r.get('/api/staff/payments/:id/history', (c) => {
    const p = paymentOr404(c.params.id!);
    needPay(U(c));
    accessBooking(U(c), p.booking_id);
    return ok({ items: paymentHistory(p.id) });
  }, A);

  r.post('/api/staff/payments/:id/verify', (c) => {
    const v = new Validator(c.json());
    const approve = v.bool('approve', true);
    const reason = v.str('reason', { max: 300 });
    const receivedPaise = v.int('receivedPaise', { min: 1 });
    v.done();
    const out = verifyUpi(U(c), c.params.id!, { approve: approve!, reason, receivedPaise });
    return ok({ ...out, booking: viewBooking(out.payment.bookingId) });
  }, { ...A, idempotent: true });

  r.post('/api/staff/payments/:id/refund', (c) => {
    const v = new Validator(c.json());
    const amountPaise = v.int('amountPaise', { required: true, min: 100 });
    const reason = v.str('reason', { required: true, min: 3, max: 150 });
    v.done();
    return created(requestRefund(U(c), c.params.id!, { amountPaise: amountPaise!, reason: reason! }));
  }, { ...A, idempotent: true });
  r.get('/api/staff/refunds', (c) => { needPay(U(c)); return ok({ items: listRefunds(ownerFilter(c), c.query.get('status') ?? undefined) }); }, A);
  r.post('/api/staff/refunds/:id/complete', (c) => {
    const v = new Validator(c.json());
    const reference = v.str('reference', { required: true, max: 80 });
    v.done();
    return ok(completeManualRefund(U(c), c.params.id!, reference!));
  }, { ...A, idempotent: true });

  // ---- grounds
  r.get('/api/staff/grounds', (c) => { const u = U(c); if (u.role === 'staff' && !hasPermission(u, 'manage_grounds') && !hasPermission(u, 'manage_bookings')) throw new HttpError(403, 'FORBIDDEN', 'This needs a grounds or bookings permission'); return ok({ items: listGrounds({ ownerId: ownerFilter(c), includeInactive: true }) }); }, A);

  r.post('/api/staff/grounds', (c) => {
    const u = U(c);
    requirePermission(u, 'manage_grounds');
    let ownerId = scopeOwnerId(u);
    if (u.role === 'super_admin') {
      const id = (c.json() as any)?.ownerId;
      const o = typeof id === 'string' ? userRow(id) : undefined;
      if (!o || o.role !== 'owner') throw new HttpError(400, 'VALIDATION_FAILED', 'Choose the owner this ground belongs to', { fields: [{ field: 'ownerId', message: 'Must be the id of an owner' }] });
      ownerId = o.id;
    }
    const g = createGround(ownerId!, c.json());
    audit({ id: u.id, role: u.role }, 'ground.create', 'ground', g.id, { name: g.name }, g.owner_id);
    return created(toGround(g));
  }, A);

  r.patch('/api/staff/grounds/:id', (c) => {
    const u = U(c);
    requirePermission(u, 'manage_grounds');
    const g0 = groundInScope(u, c.params.id!);
    const g = updateGround(g0.id, c.json());
    audit({ id: u.id, role: u.role }, 'ground.update', 'ground', g.id, { before: { price: g0.price_paise, active: g0.active }, after: { price: g.price_paise, active: g.active } }, g.owner_id);
    return ok(toGround(g));
  }, A);

  r.post('/api/staff/grounds/:id/blocks', (c) => {
    const u = U(c);
    requirePermission(u, 'manage_grounds');
    const g = groundInScope(u, c.params.id!);
    const v = new Validator(c.json());
    const date = v.date('date', true), startTime = v.time('startTime', true), endTime = v.time('endTime', true), note = v.str('note', { max: 120 });
    v.done();
    const n = blockRange(g, date!, startTime!, endTime!, note ?? null);
    audit({ id: u.id, role: u.role }, 'ground.block', 'ground', g.id, { date, startTime, endTime, slots: n }, g.owner_id);
    return created({ blocked: n });
  }, A);

  r.post('/api/staff/grounds/:id/blocks/remove', (c) => {
    const u = U(c);
    requirePermission(u, 'manage_grounds');
    const g = groundInScope(u, c.params.id!);
    const v = new Validator(c.json());
    const date = v.date('date', true), startTime = v.time('startTime', true), endTime = v.time('endTime', true);
    v.done();
    const n = unblockRange(g, date!, startTime!, endTime!);
    audit({ id: u.id, role: u.role }, 'ground.unblock', 'ground', g.id, { date, startTime, endTime, slots: n }, g.owner_id);
    return ok({ unblocked: n });
  }, A);

  // ---- enquiries
  r.get('/api/staff/enquiries', (c) => {
    const { limit, offset } = page(c);
    return ok(listEnquiries(U(c), { status: c.query.get('status') ?? undefined, q: c.query.get('q') ?? undefined, limit, offset }));
  }, A);
  r.get('/api/staff/enquiries/:id', (c) => ok(getEnquiry(U(c), c.params.id!)), A);
  r.post('/api/staff/enquiries/:id/notes', (c) => ok(addEnquiryNote(U(c), c.params.id!, c.json())), A);
  r.post('/api/staff/enquiries/:id/quotations', (c) => created(sendQuotation(U(c), c.params.id!, c.json())), A);
  r.post('/api/staff/enquiries/:id/close', (c) => ok(closeEnquiry(U(c), c.params.id!, c.json())), A);
  r.post('/api/staff/enquiries/:id/convert', (c) => created(convertEnquiry(U(c), c.params.id!, c.json())), A);
  r.post('/api/staff/enquiries/:id/convert-block', (c) => created(convertEnquiryToBlock(U(c), c.params.id!, c.json())), A);

  // ---- customers
  r.get('/api/staff/customers', (c) => {
    const u = U(c);
    requirePermission(u, 'view_customers');
    const owner = ownerFilter(c);
    if (!owner) throw new HttpError(400, 'OWNER_REQUIRED', 'Pass ?ownerId= to look at one owner\'s customers');
    const { limit, offset } = page(c);
    return ok(customerList(owner, c.query.get('q') ?? undefined, limit, offset));
  }, A);

  // Is this phone or email already a customer? Used by New booking to prefill and to avoid a second account.
  r.get('/api/staff/customers/lookup', (c) => {
    const u = U(c);
    const owner = u.role === 'super_admin' ? (c.query.get('ownerId') || null) : scopeOwnerId(u);
    return ok(lookupCustomer(owner, { phone: c.query.get('phone'), email: c.query.get('email') }));
  }, A);

  r.get('/api/staff/customers/:id', (c) => {
    const u = U(c);
    requirePermission(u, 'view_customers');
    const owner = ownerFilter(c);
    if (!owner) throw new HttpError(400, 'OWNER_REQUIRED', 'Pass ?ownerId= to look at one owner\'s customers');
    const cust = userRow(c.params.id!);
    const bookings = cust ? listBookings({ ownerId: owner, customerId: cust.id, limit: 100, offset: 0 }) : null;
    if (!cust || cust.role !== 'customer' || !bookings || bookings.total === 0) throw notFound('Customer not found');
    const payments = many<any>('SELECT * FROM payments WHERE customer_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 100', cust.id, owner);
    const enquiries = listEnquiries(u.role === 'super_admin' ? u : u, { limit: 100, offset: 0 }).items.filter((e) => e.customerId === cust.id || e.phone === cust.phone);
    const { id, name, phone, email, consent } = toUser(cust);
    return ok({ customer: { id, name, phone, email, consent }, bookings: bookings.items, payments: payments.map((p) => ({ id: p.id, bookingId: p.booking_id, method: p.method, status: p.status, amountPaise: p.amount_paise, createdAt: p.created_at })), enquiries, creditBalancePaise: credits.balance(cust.id, owner) });
  }, A);

  r.post('/api/staff/customers/:id/credit', (c) => {
    const u = U(c);
    // Credit spends like cash, so a team member needs the payments permission as well, and only up to a limit. The owner has no limit.
    if (u.role === 'staff') { requirePermission(u, 'manage_bookings'); requirePermission(u, 'record_payments'); }
    const owner = ownerFilter(c);
    if (!owner) throw new HttpError(400, 'OWNER_REQUIRED', 'Pass ?ownerId= to adjust one owner\'s credit');
    const cust = userRow(c.params.id!);
    if (!cust || cust.role !== 'customer' || !one('SELECT 1 FROM bookings WHERE customer_id = ? AND owner_id = ?', cust.id, owner)) throw notFound('Customer not found');
    const v = new Validator(c.json());
    const amountPaise = v.int('amountPaise', { required: true });
    const note = v.str('note', { required: true, min: 3, max: 200 });
    v.done();
    if (u.role === 'staff' && amountPaise! > 5_000_000) throw new HttpError(403, 'CREDIT_LIMIT', 'A team member can adjust up to ₹50,000 of credit at a time. Ask the owner for more.');
    credits.adjust(cust.id, owner, amountPaise!, note!, { id: u.id, role: u.role });
    return ok({ balancePaise: credits.balance(cust.id, owner) });
  }, { ...A, idempotent: true });

  // ---- reports
  r.get('/api/staff/reports/overview', (c) => {
    const u = U(c);
    requirePermission(u, 'view_reports');
    requireRevenue(u);
    const range = parseRange(c.query.get('from'), c.query.get('to'), c.query.get('month'));
    return ok(overview(ownerFilter(c), range));
  }, A);

  // The last few months in one request, for the dashboard trend (it used to make one call per month).
  r.get('/api/staff/reports/overview-series', (c) => {
    const u = U(c);
    requirePermission(u, 'view_reports');
    requireRevenue(u);
    const n = Math.min(12, Math.max(1, Number(c.query.get('months')) || 6));
    const t = new Date(Date.now() + 330 * 60000);
    let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    const out: { period: string; overview: ReturnType<typeof overview> }[] = [];
    const owner = ownerFilter(c);
    for (let i = 0; i < n; i++) {
      const period = `${y}-${String(m).padStart(2, '0')}`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      out.unshift({ period, overview: overview(owner, parseRange(`${period}-01`, `${period}-${String(last).padStart(2, '0')}`, null)) });
      if (--m === 0) { m = 12; y--; }
    }
    return ok({ items: out });
  }, A);

  // Money already booked for the months ahead: what the confirmed sessions are worth, what has been paid and what is still to collect.
  r.get('/api/staff/reports/upcoming', (c) => {
    const u = U(c);
    requirePermission(u, 'view_reports');
    requireRevenue(u);
    const n = Math.min(12, Math.max(1, Number(c.query.get('months')) || 6));
    const owner = ownerFilter(c);
    const today = istDate(Date.now());
    const rows = many<{ period: string; n: number; total: number; paid: number }>(
      `SELECT substr(date, 1, 7) AS period, COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS total, COALESCE(SUM(paid_paise), 0) AS paid
       FROM bookings WHERE status = 'confirmed' AND date >= ? ${owner ? 'AND owner_id = ?' : ''} GROUP BY period ORDER BY period LIMIT ?`,
      ...[today, ...(owner ? [owner] : []), n]);
    const items = rows.map((r) => ({ period: r.period, bookings: r.n, totalPaise: r.total, paidPaise: r.paid, balancePaise: Math.max(r.total - r.paid, 0) }));
    return ok({ items, totalPaise: items.reduce((a, x) => a + x.totalPaise, 0), paidPaise: items.reduce((a, x) => a + x.paidPaise, 0), balancePaise: items.reduce((a, x) => a + x.balancePaise, 0), bookings: items.reduce((a, x) => a + x.bookings, 0) });
  }, A);

  r.get('/api/staff/today', (c) => {
    const u = U(c);
    if (u.role === 'staff') requirePermission(u, 'manage_bookings');
    const today = istDate(now());
    const owner = ownerFilter(c);
    const { limit, offset } = { limit: 200, offset: 0 };
    const list = listBookings({ ownerId: owner, from: today, to: today, limit, offset });
    const awaiting = owner ? one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE owner_id = ? AND status = 'submitted'", owner)!.n : one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE status = 'submitted'")!.n;
    const review = owner ? one<{ n: number }>('SELECT COUNT(*) n FROM bookings WHERE owner_id = ? AND needs_review = 1', owner)!.n : one<{ n: number }>('SELECT COUNT(*) n FROM bookings WHERE needs_review = 1')!.n;
    return ok({ date: today, bookings: list.items.filter((b) => b.status !== 'cancelled' && b.status !== 'expired'), awaitingVerification: awaiting, needsReview: review });
  }, A);

  const seriesBookingIds = (sid: string): string[] => many<{ id: string }>('SELECT id FROM bookings WHERE series_id = ?', sid).map((x) => x.id);

  // ---- team (owner manages their staff)
  r.get('/api/staff/team', (c) => {
    const u = U(c);
    const ownerId = u.role === 'owner' ? u.id : ownerOrFail(c, 'see the team');
    return ok({ items: listStaff(ownerId).map(toUser), allPermissions: STAFF_PERMISSIONS, presets: ROLE_PRESETS });
  }, { auth: ['owner', 'super_admin'] });

  r.post('/api/staff/team', (c) => {
    const u = U(c);
    const v = new Validator(c.json());
    const nm = readName(v, true); const name = nm.name;
    const email = v.email('email', true);
    const phone = v.phone('phone');
    const password = v.str('password', { required: true, trim: false });
    const preset = v.str('preset', { max: 30 });
    if (preset && !(preset in ROLE_PRESETS)) v.fail('preset', `Unknown preset. Use one of: ${Object.keys(ROLE_PRESETS).join(', ')}`);
    const explicit = perms(v, 'permissions');
    const permissions = explicit ?? (preset && preset in ROLE_PRESETS ? [...ROLE_PRESETS[preset]!.permissions] : []);
    if (password) { const pw = checkPasswordStrength(password); if (pw) v.fail('password', pw); }
    v.done();
    const ownerId = u.role === 'owner' ? u.id : ownerOrFail(c, 'add a team member');
    const s = createUser({ role: 'staff', name: name!, ...(nm.firstName ? { firstName: nm.firstName, lastName: nm.lastName } : {}), email: email!, phone: phone ?? null, password: password!, ownerId, permissions });
    audit({ id: u.id, role: u.role }, 'staff.create', 'user', s.id, { permissions }, ownerId);
    return created(toUser(s));
  }, { auth: ['owner', 'super_admin'] });

  r.patch('/api/staff/team/:id', (c) => {
    const u = U(c);
    const s = userRow(c.params.id!);
    if (!s || s.role !== 'staff' || (u.role === 'owner' && s.owner_id !== u.id)) throw notFound('Staff member not found');
    const v = new Validator(c.json());
    const name = v.str('name', { min: 2, max: 80 });
    const phone = v.phone('phone');
    const active = v.bool('active');
    const permissions = perms(v, 'permissions');
    v.done();
    run('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), active = COALESCE(?, active), permissions = COALESCE(?, permissions), token_version = token_version + ?, updated_at = ? WHERE id = ?',
      name ?? null, phone ?? null, active === undefined ? null : active ? 1 : 0, permissions ? JSON.stringify(permissions) : null, permissions || active === false ? 1 : 0, now(), s.id);
    audit({ id: u.id, role: u.role }, 'staff.update', 'user', s.id, { permissions, active }, s.owner_id);
    return ok(toUser(userRow(s.id)!));
  }, { auth: ['owner', 'super_admin'] });
}
