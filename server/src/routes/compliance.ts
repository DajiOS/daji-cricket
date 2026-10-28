import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden, HttpError } from '../errors.ts';
import { Validator } from '../input.ts';
import { accessBooking } from '../bookings.ts';
import { changes, lastChecks, logChange, markReviewed, register, runCheck, setLimit } from '../compliance.ts';
import { addAlert, alerts, feedStatus, handleAlert, syncLawFeed } from '../lawUpdates.ts';
import { acceptTerms, acceptanceOf, acceptanceReport, currentTerms } from '../legal.ts';
import { getProfile, invoiceForBooking, listInvoices, saveProfile } from '../invoices.ts';

const OWNER = { auth: ['owner', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function complianceRoutes(r: Router): void {
  // ---- compliance register, law-change log and the daily check (owner and software owner)
  r.get('/api/compliance', (c) => ok({ items: register(), changes: changes(), checks: lastChecks(), alerts: alerts(), feed: feedStatus(c.cfg) }), OWNER);
  r.post('/api/compliance/check', () => ok(runCheck({ force: true })), OWNER);
  // ---- law and policy updates: from the feed (Settings › Connections) or added by hand
  r.post('/api/compliance/alerts', (c) => created(addAlert({ id: U(c).id, role: U(c).role }, c.json())), OWNER);
  r.post('/api/compliance/alerts/:id/handle', (c) => ok(handleAlert({ id: U(c).id, role: U(c).role }, c.params.id!, c.json())), OWNER);
  r.post('/api/compliance/feed/fetch', async (c) => {
    if (!c.cfg.lawFeed.urls.length) throw new HttpError(409, 'NOT_CONNECTED', 'No law updates feed is connected. Add LAW_FEED_URL in Settings › Connections, or add updates by hand.');
    return ok({ run: await syncLawFeed(c.cfg, undefined, { force: true }), feed: feedStatus(c.cfg) });
  }, { ...OWNER, rate: 'auth' });
  r.post('/api/compliance/changes', (c) => created(logChange({ id: U(c).id, role: U(c).role }, c.json())), OWNER);
  r.post('/api/compliance/:code/limit', (c) => ok(setLimit({ id: U(c).id, role: U(c).role }, c.params.code!, c.json())), OWNER);
  r.post('/api/compliance/:code/review', (c) => ok(markReviewed({ id: U(c).id, role: U(c).role }, c.params.code!, c.json())), OWNER);

  // ---- team terms: read, accept, and the owner's evidence report
  r.get('/api/legal/staff-terms', (c) => {
    const t = currentTerms(), u = U(c);
    return ok({ ...t, required: u.role === 'staff', accepted: acceptanceOf(u.id) });
  }, { auth: 'user' });
  r.post('/api/legal/staff-terms/accept', (c) => {
    const u = U(c);
    if (u.role !== 'staff') throw forbidden('Only team members accept these terms');
    const v = new Validator(c.json());
    const version = v.int('version', { required: true, min: 1 }), sha256 = v.str('sha256', { required: true, max: 64 });
    v.done();
    return ok({ accepted: acceptTerms(u, { version: version!, sha256: sha256! }, c.ip, c.req.headers['user-agent']) });
  }, { auth: 'user' });
  r.get('/api/legal/staff-terms/report', (c) => ok({ version: currentTerms().version, sha256: currentTerms().sha256, items: acceptanceReport(ownerOrFail(c, 'see who accepted the terms')) }), OWNER);

  // ---- GST profile and invoices
  r.get('/api/accounting/gst-profile', (c) => ok(getProfile(ownerOrFail(c, 'see the GST profile'))), OWNER);
  r.put('/api/accounting/gst-profile', (c) => ok(saveProfile(ownerOrFail(c, 'save the GST profile'), { id: U(c).id, role: U(c).role }, c.json())), OWNER);
  r.get('/api/accounting/invoices', (c) => ok({ items: listInvoices(ownerOrFail(c, 'list invoices'), c.query.get('fy') ?? undefined) }), OWNER);
  // An invoice for a booking: the customer who made it, or the team member who can manage bookings
  r.get('/api/bookings/:id/invoice', (c) => {
    const u = U(c), b = accessBooking(u, c.params.id!, 'manage_bookings');
    return ok(invoiceForBooking(b.owner_id, { id: u.id, role: u.role }, b.id));
  }, { auth: 'user' });
}
