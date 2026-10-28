import { Router, ok, created, type Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden, HttpError } from '../errors.ts';
import { Validator } from '../input.ts';
import { accessBooking } from '../bookings.ts';
import { changes, lastChecks, logChange, markReviewed, register, runCheck, setLimit } from '../compliance.ts';
import { addAlert, alerts, feedStatus, handleAlert, syncLawFeed } from '../lawUpdates.ts';
import { acceptTerms, acceptanceOf, acceptanceReport, currentTerms } from '../legal.ts';
import { getProfile, invoiceForBooking, listInvoices, saveProfile } from '../invoices.ts';
import { requireMainBusiness } from '../businesses.ts';

const OWNER = { auth: ['owner', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
// The register is the platform's (how the software keeps to the law), kept by the software owner and the main site's business.
const M = (c: Ctx) => requireMainBusiness(U(c));

export function complianceRoutes(r: Router): void {
  // ---- compliance register, law-change log and the daily check (owner and software owner)
  r.get('/api/compliance', (c) => { M(c); return ok({ items: register(), changes: changes(), checks: lastChecks(), alerts: alerts(), feed: feedStatus(c.cfg) }); }, OWNER);
  r.post('/api/compliance/check', (c) => { M(c); return ok(runCheck({ force: true })); }, OWNER);
  // ---- law and policy updates: from the feed (Settings › Connections) or added by hand
  r.post('/api/compliance/alerts', (c) => { M(c); return created(addAlert({ id: U(c).id, role: U(c).role }, c.json())); }, OWNER);
  r.post('/api/compliance/alerts/:id/handle', (c) => { M(c); return ok(handleAlert({ id: U(c).id, role: U(c).role }, c.params.id!, c.json())); }, OWNER);
  r.post('/api/compliance/feed/fetch', async (c) => { M(c);
    if (!c.cfg.lawFeed.urls.length) throw new HttpError(409, 'NOT_CONNECTED', 'No law updates feed is connected. Add LAW_FEED_URL in Settings › Connections, or add updates by hand.');
    return ok({ run: await syncLawFeed(c.cfg, undefined, { force: true }), feed: feedStatus(c.cfg) });
  }, { ...OWNER, rate: 'auth' });
  r.post('/api/compliance/changes', (c) => { M(c); return created(logChange({ id: U(c).id, role: U(c).role }, c.json())); }, OWNER);
  r.post('/api/compliance/:code/limit', (c) => { M(c); return ok(setLimit({ id: U(c).id, role: U(c).role }, c.params.code!, c.json())); }, OWNER);
  r.post('/api/compliance/:code/review', (c) => { M(c); return ok(markReviewed({ id: U(c).id, role: U(c).role }, c.params.code!, c.json())); }, OWNER);

  // ---- team terms: read, accept, and the owner's evidence report
  r.get('/api/legal/staff-terms', (c) => {
    const u = U(c), t = currentTerms(u);
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
  r.get('/api/legal/staff-terms/report', (c) => { const o = ownerOrFail(c, 'see who accepted the terms'); const t = currentTerms(o); return ok({ version: t.version, sha256: t.sha256, items: acceptanceReport(o) }); }, OWNER);

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
