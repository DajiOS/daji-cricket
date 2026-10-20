import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Broadcast, BroadcastChannel, BroadcastPlan, BroadcastRecipient, Contact, ContactFilter, RecipientStatus } from '@daji/shared';
import type { Config } from './config.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit, type Actor } from './audit.ts';
import { marketing } from './notifications.ts';
import { audience, parseContactFilter } from './contacts.ts';
import { userRow } from './auth.ts';
import { DAY } from './time.ts';
import { waNumber } from './whatsapp.ts';

registerSchema('broadcasts-1', `
CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  subject TEXT,
  body TEXT NOT NULL,
  filter TEXT NOT NULL,
  audience INTEGER NOT NULL,
  queued INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX ix_broadcasts_owner ON broadcasts(owner_id, created_at);
CREATE UNIQUE INDEX uq_broadcasts_request ON broadcasts(owner_id, request_id) WHERE request_id IS NOT NULL;

CREATE TABLE broadcast_recipients (
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  notification_id TEXT,
  skip_reason TEXT,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX ix_broadcast_recipients_notification ON broadcast_recipients(notification_id);
`);

/** At most this many broadcasts per owner in any 24 hours: a mistake or a stolen login cannot spam the whole customer list for long. */
export const DAILY_BROADCAST_LIMIT = 10;
const SAMPLE = 5;

export interface BroadcastTemplate { id: string; title: string; channels: BroadcastChannel[]; subject: string; body: string }
/** Starting points for the updates a ground usually needs to send. `{name}` becomes the person's first name. */
export const BROADCAST_TEMPLATES: BroadcastTemplate[] = [
  { id: 'closed', title: 'Ground closed on a day', channels: ['email', 'whatsapp', 'sms'], subject: 'Ground closed on <date>', body: 'Hi {name}, the ground will be closed on <date> for <reason>. Sorry for the inconvenience. You can book other days any time.' },
  { id: 'rain', title: 'Rain update', channels: ['email', 'whatsapp', 'sms'], subject: 'Rain update for today', body: 'Hi {name}, because of rain the ground is not playable today. If you have a booking, we will contact you about moving it or giving you credit.' },
  { id: 'timings', title: 'New timings', channels: ['email', 'whatsapp', 'sms'], subject: 'New ground timings', body: 'Hi {name}, from <date> the ground is open <opening time> to <closing time>.' },
  { id: 'price', title: 'Price change', channels: ['email', 'whatsapp'], subject: 'Update to our prices', body: 'Hi {name}, from <date> our prices change. Bookings you have already made are not affected.' },
  { id: 'facility', title: 'New facility', channels: ['email', 'whatsapp'], subject: 'Something new at the ground', body: 'Hi {name}, we have added <facility> at the ground. Come and try it on your next booking.' },
  { id: 'tournament', title: 'Tournament or academy', channels: ['email', 'whatsapp'], subject: 'Tournament and academy news', body: 'Hi {name}, <details>. Reply or call us to join.' },
];

// ---- unsubscribe links ----

function mac(cfg: Config, userId: string, channel: BroadcastChannel): string {
  return createHmac('sha256', cfg.jwtSecret).update(`unsubscribe|${userId}|${channel}`).digest('base64url').slice(0, 27);
}
export function unsubscribeToken(cfg: Config, userId: string, channel: BroadcastChannel): string {
  return `${userId}.${channel}.${mac(cfg, userId, channel)}`;
}
export function readUnsubscribeToken(cfg: Config, token: string): { userId: string; channel: BroadcastChannel } | null {
  const [userId, channel, m, ...rest] = token.split('.');
  if (!userId || !m || rest.length || (channel !== 'email' && channel !== 'sms' && channel !== 'whatsapp')) return null;
  const want = Buffer.from(mac(cfg, userId, channel));
  const got = Buffer.from(m);
  return want.length === got.length && timingSafeEqual(want, got) ? { userId, channel } : null;
}

// ---- composing ----

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || 'there';
const clean = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();

interface Input { channel: BroadcastChannel; subject: string | null; body: string; filter: ContactFilter; dryRun: boolean; confirmCount: number | undefined; requestId: string | undefined }

function parseInput(src: unknown): Input {
  const v = new Validator(src);
  const channel = v.oneOf('channel', ['email', 'sms', 'whatsapp'] as const, true);
  const subjectRaw = v.str('subject', { max: 120 });
  const bodyRaw = v.str('body', { required: true, trim: false, max: 5000 });
  const dryRun = v.bool('dryRun') ?? false;
  const confirmCount = v.int('confirmCount', { min: 0 });
  const requestId = v.str('requestId', { max: 64 });
  const rawFilter = v.src.filter;
  let filter: ContactFilter = {};
  if (rawFilter !== undefined && rawFilter !== null) {
    if (typeof rawFilter !== 'object' || Array.isArray(rawFilter)) v.fail('filter', 'Must be an object');
    else {
      try { filter = parseContactFilter(rawFilter); }
      catch (e) {
        if (e instanceof HttpError) for (const f of ((e.details as { fields?: { field: string; message: string }[] })?.fields ?? [])) v.fail(`filter.${f.field}`, f.message);
        else throw e;
      }
    }
  }
  const body = bodyRaw === undefined ? '' : clean(bodyRaw);
  const subject = subjectRaw === undefined ? null : clean(subjectRaw).replace(/\n/g, ' ');
  if (channel === 'email') {
    if (!subject || subject.length < 3) v.fail('subject', 'An email needs a subject of at least 3 characters');
    if (body.length < 10) v.fail('body', 'Write at least 10 characters');
  } else if (channel === 'whatsapp') {
    if (body.length < 10 || body.length > 900) v.fail('body', 'A WhatsApp message is 10 to 900 characters');
  } else if (channel === 'sms') {
    if (body.length < 10 || body.length > 300) v.fail('body', 'A text message is 10 to 300 characters');
  }
  v.done();
  return { channel: channel!, subject: channel === 'email' ? subject : null, body, filter, dryRun, confirmCount, requestId };
}

function footer(cfg: Config, ownerId: string, c: Contact, channel: BroadcastChannel): string {
  const o = userRow(ownerId);
  const who = o?.business_name || o?.name || 'Daji Cricket Ground';
  if (channel === 'email') {
    return `\n\n--\nYou are getting this from ${who} because you have played at our ground and agreed to updates.\nStop these emails: ${cfg.apiUrl}/api/unsubscribe?t=${unsubscribeToken(cfg, c.id, 'email')}`;
  }
  return `\n\n${who}. Reply STOP to stop these messages.`;
}

function compose(cfg: Config, ownerId: string, c: Contact, input: Input): { subject: string | null; body: string } {
  const text = input.body.replace(/\{name\}/gi, firstName(c.name));
  return { subject: input.subject ? input.subject.replace(/\{name\}/gi, firstName(c.name)) : null, body: text + footer(cfg, ownerId, c, input.channel) };
}

type Skip = 'disabled' | 'noAddress' | 'noConsent';
const REASON: Record<Skip, string> = { disabled: 'account disabled', noAddress: 'no address on file', noConsent: 'has not agreed to these messages' };

function verdict(c: Contact, channel: BroadcastChannel): Skip | null {
  if (c.reachable[channel]) return null;
  // Work out why, in order: the account, the address, the consent.
  const addr = channel === 'email' ? c.email : c.phone;
  const consent = c.consent[channel];
  if (addr && consent) return 'disabled'; // reachable would have been true unless the account is switched off
  if (!addr) return 'noAddress';
  return 'noConsent';
}

function plan(cfg: Config, ownerId: string, input: Input): { plan: BroadcastPlan; people: Contact[]; skips: Map<string, Skip> } {
  const people = audience(ownerId, input.filter);
  const skips = new Map<string, Skip>();
  const go: Contact[] = [];
  const skipped = { noConsent: 0, noAddress: 0, disabled: 0 };
  for (const c of people) {
    const why = verdict(c, input.channel);
    if (why) { skips.set(c.id, why); skipped[why]++; } else go.push(c);
  }
  const first = go[0] ?? people[0];
  const demo = first ?? ({ id: 'preview', name: 'Alex Sharma' } as Contact);
  return {
    plan: {
      channel: input.channel, audience: people.length, willSend: go.length, skipped,
      sample: go.slice(0, SAMPLE).map((c) => ({ id: c.id, name: c.name })),
      preview: compose(cfg, ownerId, demo, input),
    },
    people, skips,
  };
}

export function previewBroadcast(cfg: Config, ownerId: string, src: unknown): BroadcastPlan {
  return plan(cfg, ownerId, parseInput(src)).plan;
}

export type SendResult = { plan: BroadcastPlan; broadcast: null } | { plan: BroadcastPlan; broadcast: Broadcast; replayed: boolean };

export function sendBroadcast(cfg: Config, actor: Actor, ownerId: string, src: unknown): SendResult {
  const input = parseInput(src);

  if (input.requestId) {
    const prior = one<BroadcastRow>('SELECT * FROM broadcasts WHERE owner_id = ? AND request_id = ?', ownerId, input.requestId);
    if (prior) return { plan: previewFrom(prior), broadcast: toBroadcast(prior), replayed: true };
  }

  const p = plan(cfg, ownerId, input);
  if (input.dryRun) return { plan: p.plan, broadcast: null };

  if (input.confirmCount === undefined) throw new HttpError(400, 'CONFIRM_REQUIRED', 'Preview first, then send with confirmCount set to the number of people it will reach.', { willSend: p.plan.willSend });
  if (input.confirmCount !== p.plan.willSend) {
    throw new HttpError(409, 'AUDIENCE_CHANGED', `You confirmed ${input.confirmCount} people but this would now reach ${p.plan.willSend}. Preview again.`, { willSend: p.plan.willSend });
  }
  if (p.plan.willSend === 0) {
    const s = p.plan.skipped;
    throw new HttpError(400, 'NOBODY_TO_SEND', `Nobody in this group can be messaged on ${input.channel}: ${s.noConsent} have not agreed, ${s.noAddress} have no address, ${s.disabled} have a disabled account.`, { skipped: s });
  }
  const recent = one<{ n: number }>('SELECT COUNT(*) n FROM broadcasts WHERE owner_id = ? AND created_at > ?', ownerId, now() - DAY)!.n;
  if (recent >= DAILY_BROADCAST_LIMIT) throw new HttpError(429, 'BROADCAST_LIMIT', `Only ${DAILY_BROADCAST_LIMIT} broadcasts can be sent in 24 hours. Try again later.`);

  const id = newId('bc');
  const row = tx(() => {
    run('INSERT INTO broadcasts(id, owner_id, channel, subject, body, filter, audience, queued, skipped, request_id, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, ownerId, input.channel, input.subject, input.body, JSON.stringify(input.filter), p.plan.audience, 0, 0, input.requestId ?? null, now(), actor.id);
    let queued = 0, skipped = 0;
    for (const c of p.people) {
      const why = p.skips.get(c.id);
      let notificationId: string | null = null;
      let reason: string | null = why ? REASON[why] : null;
      if (!why) {
        const m = compose(cfg, ownerId, c, input);
        const r = marketing(c.id, input.channel, 'broadcast', m.subject ?? `Update from ${userRow(ownerId)?.business_name ?? 'the ground'}`, m.body);
        if (r.sent && r.id) notificationId = r.id; else reason = r.reason ?? 'not sent';
      }
      if (notificationId) queued++; else skipped++;
      run('INSERT INTO broadcast_recipients(broadcast_id, user_id, notification_id, skip_reason) VALUES(?,?,?,?)', id, c.id, notificationId, reason);
    }
    run('UPDATE broadcasts SET queued = ?, skipped = ? WHERE id = ?', queued, skipped, id);
    return one<BroadcastRow>('SELECT * FROM broadcasts WHERE id = ?', id)!;
  });
  audit(actor, 'broadcast.send', 'broadcast', id, { channel: input.channel, audience: row.audience, queued: row.queued, skipped: row.skipped, filter: input.filter }, ownerId);
  return { plan: p.plan, broadcast: toBroadcast(row), replayed: false };
}

// ---- history ----

interface BroadcastRow { id: string; owner_id: string; channel: BroadcastChannel; subject: string | null; body: string; filter: string; audience: number; queued: number; skipped: number; created_at: number; created_by: string | null }

function counts(id: string): { sent: number; failed: number } {
  const r = one<{ sent: number | null; failed: number | null }>(
    `SELECT SUM(CASE WHEN n.status = 'sent' THEN 1 ELSE 0 END) sent, SUM(CASE WHEN n.status = 'failed' THEN 1 ELSE 0 END) failed
     FROM broadcast_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.broadcast_id = ?`, id)!;
  return { sent: r.sent ?? 0, failed: r.failed ?? 0 };
}

function toBroadcast(r: BroadcastRow): Broadcast {
  const c = counts(r.id);
  return { id: r.id, ownerId: r.owner_id, channel: r.channel, subject: r.subject, body: r.body, filter: JSON.parse(r.filter) as ContactFilter, audience: r.audience, queued: r.queued, skipped: r.skipped, sent: c.sent, failed: c.failed, createdAt: r.created_at, createdBy: r.created_by };
}

function previewFrom(r: BroadcastRow): BroadcastPlan {
  return { channel: r.channel, audience: r.audience, willSend: r.queued, skipped: { noConsent: 0, noAddress: 0, disabled: 0 }, sample: [], preview: { subject: r.subject, body: r.body } };
}

export function listBroadcasts(ownerId: string, limit: number, offset: number): { items: Broadcast[]; total: number; limit: number; offset: number } {
  const rows = many<BroadcastRow>('SELECT * FROM broadcasts WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', ownerId, limit, offset);
  const total = one<{ n: number }>('SELECT COUNT(*) n FROM broadcasts WHERE owner_id = ?', ownerId)!.n;
  return { items: rows.map(toBroadcast), total, limit, offset };
}

export function broadcastDetail(ownerId: string, id: string, limit: number, offset: number): { broadcast: Broadcast; recipients: BroadcastRecipient[]; total: number } {
  const row = one<BroadcastRow>('SELECT * FROM broadcasts WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!row) throw notFound('Broadcast not found');
  const rows = many<{ user_id: string; name: string; status: string | null; reason: string | null; skip_reason: string | null }>(
    `SELECT r.user_id, u.name, n.status, n.skip_reason AS reason, r.skip_reason
     FROM broadcast_recipients r JOIN users u ON u.id = r.user_id LEFT JOIN notifications n ON n.id = r.notification_id
     WHERE r.broadcast_id = ? ORDER BY u.name, r.user_id LIMIT ? OFFSET ?`, id, limit, offset);
  const total = one<{ n: number }>('SELECT COUNT(*) n FROM broadcast_recipients WHERE broadcast_id = ?', id)!.n;
  return {
    broadcast: toBroadcast(row), total,
    recipients: rows.map((r) => ({ userId: r.user_id, name: r.name, status: (r.status ?? 'skipped') as RecipientStatus, reason: r.skip_reason ?? r.reason })),
  };
}

// ---- unsubscribing ----

/** Turns off one channel for the person the token was made for. Safe to call again. */
export function unsubscribe(cfg: Config, token: string): { ok: true; channel: BroadcastChannel; name: string } | { ok: false } {
  const t = readUnsubscribeToken(cfg, token);
  if (!t) return { ok: false };
  const u = userRow(t.userId);
  if (!u) return { ok: false };
  const col = t.channel === 'email' ? 'consent_email' : t.channel === 'sms' ? 'consent_sms' : 'consent_whatsapp';
  if ((u as unknown as Record<string, number>)[col]) {
    run(`UPDATE users SET ${col} = 0, consent_updated_at = ? WHERE id = ?`, now(), u.id);
    audit({ id: u.id, role: 'customer' }, 'consent.unsubscribe', 'user', u.id, { channel: t.channel });
  }
  return { ok: true, channel: t.channel, name: u.name };
}

// ---- sending by hand ----
// Until an email/WhatsApp/SMS provider is connected, a broadcast can still go out: the owner sends the stored messages
// from their own mail app or phone. These helpers build the links and record what was sent.

export interface ManualItem { userId: string; name: string; to: string; subject: string | null; text: string; link: string | null; sent: boolean }
export interface ManualPlan { broadcastId: string; channel: BroadcastChannel; items: ManualItem[]; emailGroups: { count: number; to: string[]; link: string }[] }

const EMAIL_GROUP = 40;

export function manualPlan(ownerId: string, broadcastId: string): ManualPlan {
  const b = one<BroadcastRow>('SELECT * FROM broadcasts WHERE id = ? AND owner_id = ?', broadcastId, ownerId);
  if (!b) throw notFound('Broadcast not found');
  const rows = many<{ user_id: string; name: string; email: string | null; phone: string | null; subject: string | null; body: string; status: string }>(
    `SELECT r.user_id, u.name, u.email, u.phone, n.subject, n.body, n.status
     FROM broadcast_recipients r JOIN users u ON u.id = r.user_id JOIN notifications n ON n.id = r.notification_id
     WHERE r.broadcast_id = ? AND n.status IN ('queued','sent') ORDER BY u.name, r.user_id`, broadcastId);
  const items: ManualItem[] = rows.map((r) => {
    const to = b.channel === 'email' ? (r.email ?? '') : (r.phone ? waNumber(r.phone) : '');
    const link = b.channel === 'whatsapp' ? `https://wa.me/${to}?text=${encodeURIComponent(r.body)}`
      : b.channel === 'sms' ? `sms:+${to}?body=${encodeURIComponent(r.body)}` : null;
    return { userId: r.user_id, name: r.name, to, subject: r.subject, text: r.body, link, sent: r.status === 'sent' };
  });
  const emailGroups: ManualPlan['emailGroups'] = [];
  if (b.channel === 'email') {
    // One message body for everybody except the personal unsubscribe link, so email goes out in BCC groups (the list is never shown to the others).
    const todo = items.filter((i) => !i.sent && i.to);
    for (let k = 0; k < todo.length; k += EMAIL_GROUP) {
      const g = todo.slice(k, k + EMAIL_GROUP);
      const first = g[0]!;
      emailGroups.push({ count: g.length, to: g.map((i) => i.to), link: `mailto:?bcc=${encodeURIComponent(g.map((i) => i.to).join(','))}&subject=${encodeURIComponent(first.subject ?? '')}&body=${encodeURIComponent(first.text)}` });
    }
  }
  return { broadcastId, channel: b.channel, items, emailGroups };
}

/** Records that the owner sent these messages by hand. Only queued messages of this broadcast change; the rest are ignored. */
export function markManualSent(actor: Actor, ownerId: string, broadcastId: string, userIds: string[]): { marked: number } {
  const b = one<BroadcastRow>('SELECT id FROM broadcasts WHERE id = ? AND owner_id = ?', broadcastId, ownerId);
  if (!b) throw notFound('Broadcast not found');
  if (!userIds.length || userIds.length > MAX_MARK) throw new HttpError(400, 'VALIDATION_FAILED', `Send 1 to ${MAX_MARK} people at a time`, { fields: [{ field: 'userIds', message: `1 to ${MAX_MARK} ids` }] });
  let marked = 0;
  tx(() => {
    for (const uid of new Set(userIds)) {
      const r = run(`UPDATE notifications SET status = 'sent', sent_at = ?, skip_reason = 'sent by hand' WHERE status = 'queued' AND id = (SELECT notification_id FROM broadcast_recipients WHERE broadcast_id = ? AND user_id = ?)`, now(), broadcastId, uid);
      marked += r.changes;
    }
  });
  audit(actor, 'broadcast.manual_sent', 'broadcast', broadcastId, { marked }, ownerId);
  return { marked };
}
const MAX_MARK = 500;

/** Staff switch a channel off for someone who replied STOP (or asked in person). Only for people who have booked with this owner. */
export function staffOptOut(actor: Actor, ownerId: string, userId: string, channel: unknown): { ok: true; name: string } {
  if (channel !== 'email' && channel !== 'sms' && channel !== 'whatsapp') throw new HttpError(400, 'VALIDATION_FAILED', 'channel must be email, sms or whatsapp', { fields: [{ field: 'channel', message: 'Must be email, sms or whatsapp' }] });
  const u = one<{ id: string; name: string }>("SELECT u.id, u.name FROM users u WHERE u.id = ? AND u.role = 'customer' AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = u.id AND b.owner_id = ?)", userId, ownerId);
  if (!u) throw notFound('Contact not found');
  const col = channel === 'email' ? 'consent_email' : channel === 'sms' ? 'consent_sms' : 'consent_whatsapp';
  run(`UPDATE users SET ${col} = 0, consent_updated_at = ? WHERE id = ?`, now(), u.id);
  audit(actor, 'consent.staff_opt_out', 'user', u.id, { channel }, ownerId);
  return { ok: true, name: u.name };
}
