import { Router, ok, created } from '../http.ts';
import type { Reply } from '../http.ts';
import { U, page, ownerOrFail } from './helpers.ts';
import { HttpError } from '../errors.ts';
import { audit } from '../audit.ts';
import { requirePermission } from '../auth.ts';
import { audience, FILTER_FIELDS, listContacts, parseContactFilter } from '../contacts.ts';
import { BROADCAST_TEMPLATES, broadcastDetail, listBroadcasts, manualPlan, markManualSent, previewBroadcast, sendBroadcast, staffOptOut, unsubscribe } from '../broadcasts.ts';
import { toCsv } from '../accounting/csv.ts';
import { many } from '../db.ts';
import { istDate } from '../time.ts';
import { waNumber } from '../whatsapp.ts';
import { formatPaise } from '@daji/shared';
import type { BroadcastChannel } from '@daji/shared';
import type { Ctx } from '../http.ts';

const STAFF_ROLES: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF_ROLES };

/** The filter from the query string: ?who=played&groundId=...&minTimes=3 */
function filterFromQuery(c: Ctx) {
  const raw: Record<string, unknown> = {};
  for (const k of FILTER_FIELDS) {
    const v = c.query.get(k);
    if (v === null || v === '') continue;
    raw[k] = k === 'minTimes' ? Number(v) : v;
  }
  return parseContactFilter(raw);
}

function channelFromQuery(c: Ctx): BroadcastChannel | undefined {
  const v = c.query.get('channel');
  if (v === null || v === '') return undefined;
  if (v !== 'email' && v !== 'sms' && v !== 'whatsapp') throw new HttpError(400, 'VALIDATION_FAILED', 'channel must be email, sms or whatsapp', { fields: [{ field: 'channel', message: 'Must be email, sms or whatsapp' }] });
  return v;
}

const PAGE = (title: string, inner: string): Reply => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", 'Cache-Control': 'no-store' },
  raw: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d0c;color:#f2ede1;font:16px/1.6 system-ui,sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-weight:600;font-size:1.4rem}p{color:#b9b3a4}button{margin-top:1rem;height:3rem;padding:0 2rem;border:0;border-radius:6px;background:#c9a96b;color:#17130a;font:600 .8rem system-ui;letter-spacing:.16em;text-transform:uppercase;cursor:pointer}</style></head><body><main>${inner}</main></body></html>`,
});

const CHANNEL_WORD: Record<BroadcastChannel, string> = { email: 'emails', sms: 'text messages', whatsapp: 'WhatsApp messages' };

export function contactRoutes(r: Router): void {
  r.get('/api/staff/contacts', (c) => {
    const u = U(c);
    requirePermission(u, 'view_customers');
    const owner = ownerOrFail(c, 'list contacts');
    const { limit, offset } = page(c, 50);
    return ok(listContacts(owner, filterFromQuery(c), limit, offset, channelFromQuery(c)));
  }, A);

  r.get('/api/staff/contacts/export', (c) => {
    const u = U(c);
    requirePermission(u, 'view_customers');
    const owner = ownerOrFail(c, 'export contacts');
    const f = filterFromQuery(c);
    const people = audience(owner, f);
    const names = new Map(many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ?', owner).map((g) => [g.id, g.name]));
    const yn = (b: boolean) => (b ? 'Yes' : 'No');
    const rows: (string | number)[][] = [['Name', 'Phone (with country code 91)', 'Email', 'Times played', 'Sessions (slots)', 'First played', 'Last played', 'Total paid', 'Grounds', 'OK to email', 'OK to WhatsApp', 'OK to text']];
    for (const p of people) {
      rows.push([p.name, p.phone ? waNumber(p.phone) : '', p.email ?? '', p.timesPlayed, p.slotsPlayed, istDate(p.firstPlayedAt), istDate(p.lastPlayedAt), formatPaise(p.paidPaise, true),
        p.groundIds.map((g) => names.get(g) ?? g).join('; '), yn(p.reachable.email), yn(p.reachable.whatsapp), yn(p.reachable.sms)]);
    }
    audit({ id: u.id, role: u.role }, 'contacts.export', 'contacts', null, { rows: people.length, filter: f }, owner);
    return { status: 200, raw: toCsv(rows), contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="daji-contacts.csv"' } };
  }, A);

  r.get('/api/staff/broadcast-templates', (c) => { requirePermission(U(c), 'send_broadcasts'); return ok({ items: BROADCAST_TEMPLATES }); }, A);

  r.post('/api/staff/broadcasts/preview', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    return ok(previewBroadcast(c.cfg, ownerOrFail(c, 'preview a broadcast'), c.json()));
  }, A);

  r.post('/api/staff/broadcasts', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const res = sendBroadcast(c.cfg, { id: u.id, role: u.role }, ownerOrFail(c, 'send a broadcast'), c.json());
    if (!res.broadcast) return ok({ preview: res.plan });
    return res.replayed ? ok({ broadcast: res.broadcast, plan: res.plan, replayed: true }) : created({ broadcast: res.broadcast, plan: res.plan });
  }, A);

  r.get('/api/staff/broadcasts', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const { limit, offset } = page(c);
    return ok(listBroadcasts(ownerOrFail(c, 'list broadcasts'), limit, offset));
  }, A);

  r.get('/api/staff/broadcasts/:id', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const { limit, offset } = page(c, 100);
    return ok(broadcastDetail(ownerOrFail(c, 'open a broadcast'), c.params.id!, limit, offset));
  }, A);

  r.get('/api/staff/broadcasts/:id/manual', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const owner = ownerOrFail(c, 'send a broadcast by hand');
    const plan = manualPlan(owner, c.params.id!);
    audit({ id: u.id, role: u.role }, 'broadcast.manual_view', 'broadcast', c.params.id!, { people: plan.items.length }, owner);
    return ok(plan);
  }, A);

  r.post('/api/staff/broadcasts/:id/manual-sent', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const body = c.json() as { userIds?: unknown };
    const ids = Array.isArray(body?.userIds) ? body.userIds.filter((x): x is string => typeof x === 'string') : [];
    return ok(markManualSent({ id: u.id, role: u.role }, ownerOrFail(c, 'mark a broadcast as sent'), c.params.id!, ids));
  }, A);

  // Someone replied STOP to a WhatsApp or text message: nothing reads replies yet, so staff switch that channel off here.
  r.post('/api/staff/contacts/:id/opt-out', (c) => {
    const u = U(c);
    requirePermission(u, 'send_broadcasts');
    const body = c.json() as { channel?: unknown };
    return ok(staffOptOut({ id: u.id, role: u.role }, ownerOrFail(c, 'opt a contact out'), c.params.id!, body?.channel));
  }, A);

  // ---- the link at the bottom of every broadcast email ----
  // GET only shows a button, so mail scanners that open links cannot unsubscribe people by accident. POST does it.
  r.get('/api/unsubscribe', (c) => {
    const t = c.query.get('t') ?? '';
    const ch = t.split('.')[1] as BroadcastChannel | undefined;
    if (!ch || !(ch in CHANNEL_WORD)) return { ...PAGE('Link not valid', '<h1>This link is not valid</h1><p>It may have been cut off. Open it again from the email, or change your choices in your account.</p>'), status: 400 };
    return PAGE('Stop these messages', `<h1>Stop ${CHANNEL_WORD[ch]}?</h1><p>You will no longer get ground updates by ${ch === 'sms' ? 'text message' : ch}. Booking confirmations and reminders still come to you.</p><form method="post" action="/api/unsubscribe?t=${encodeURIComponent(t)}"><button type="submit">Stop ${CHANNEL_WORD[ch]}</button></form>`);
  }, { rate: 'auth' });

  r.post('/api/unsubscribe', (c) => {
    const res = unsubscribe(c.cfg, c.query.get('t') ?? '');
    if (!res.ok) return { ...PAGE('Link not valid', '<h1>This link is not valid</h1><p>It may have been cut off. Open it again from the email, or change your choices in your account.</p>'), status: 400 };
    return PAGE('Done', `<h1>Done</h1><p>You will not get any more ${CHANNEL_WORD[res.channel]} with ground updates. You can turn them back on any time in your account.</p>`);
  }, { rate: 'auth' });
}
