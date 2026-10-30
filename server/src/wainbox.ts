import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { gateUpload, storeUpload } from './intake.ts';
import { getSettings } from './settings.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { canSeeArea, worksIn } from './areas.ts';
import { holdsBusiness } from './portfolio.ts';
import { mainSiteBusinessId } from './businesses.ts';
import { raiseRequest, visibleTask } from './tasks.ts';
import { addRefFile, MAX_REF_BYTES } from './taskwork.ts';
import { waNumber } from './whatsapp.ts';
import { seal, unseal } from './vault.ts';
import type { Config } from './config.ts';

// Inbound WhatsApp (redesign addendum, step 7). WhatsApp is the front door for the team in India: a supervisor or a
// subcontractor sends a photo, a receipt, a voice note, a document or a few words to the business number, and it lands
// here, kept exactly as it came, until someone who may see it puts it against a job, a project or a cash spend.
//
// What the provider (Meta's WhatsApp Cloud API) supports, and so what this is built around:
// - one-to-one chats with the business number only. The Cloud API does not read WhatsApp groups, so a team that works in a
//   group today has to send to the business number instead. Nothing here pretends to read a group.
// - every message arrives at a webhook signed with the app secret (X-Hub-Signature-256). Anything unsigned is refused.
// - photos, videos, voice notes and documents arrive as a media id; the file is fetched afterwards with the token, checked
//   for viruses like every other upload (intake.ts) and only then kept.
// - delivery status (sent, delivered, read, failed) arrives at the same webhook for the messages this number sends.
// - a free-text reply is allowed only within 24 hours of the person's last message to us; after that WhatsApp needs an
//   approved template, which this does not send.
//
// It is switched off until the owner turns it on (whatsappInboundEnabled), and does nothing until the connection is set up
// (Settings › Connections, "WhatsApp messages coming in"). Off, a delivery is acknowledged and dropped: nothing is kept,
// only the number of messages it carried, so the owner knows what was missed (WhatsApp does not send them again).
//
// Nothing is filed by a guess. A message is filed by itself only when it is a reply to one we sent about a record (the
// person pressed Reply on it); everything else waits in the review inbox with, at most, a suggestion. Message text and
// the original payload are sealed at rest (vault.ts). Messages are never deleted: one that is not wanted is dismissed with
// a reason and stays on file. A message put against a record is seen by the people who may see that record, no one else.

registerSchema('wainbox-1', `
CREATE TABLE wa_messages (
  id TEXT PRIMARY KEY,
  wamid TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  phone TEXT NOT NULL,
  person_id TEXT REFERENCES users(id),
  profile_name TEXT,
  kind TEXT NOT NULL,
  body TEXT,
  media_id TEXT,
  media_mime TEXT,
  media_name TEXT,
  media_sha256 TEXT,
  media_state TEXT NOT NULL DEFAULT 'none' CHECK (media_state IN ('none','waiting','stored','failed','rejected')),
  media_tries INTEGER NOT NULL DEFAULT 0,
  media_error TEXT,
  context_wamid TEXT,
  raw TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('review','filed','dismissed','sending','sent','delivered','read','failed')),
  suggestion TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  review_note TEXT,
  client_key TEXT,
  created_by TEXT
);
CREATE UNIQUE INDEX ux_wa_messages_wamid ON wa_messages(wamid);
CREATE UNIQUE INDEX ux_wa_messages_key ON wa_messages(owner_id, created_by, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX ix_wa_messages_owner ON wa_messages(owner_id, state, received_at);
CREATE INDEX ix_wa_messages_phone ON wa_messages(owner_id, phone, received_at);
CREATE INDEX ix_wa_messages_media ON wa_messages(media_state);

CREATE TABLE wa_links (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES wa_messages(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('task','project','cash')),
  record_id TEXT NOT NULL,
  why TEXT,
  linked_by TEXT,
  linked_at INTEGER NOT NULL,
  unlinked_at INTEGER,
  unlinked_by TEXT,
  unlinked_reason TEXT
);
CREATE UNIQUE INDEX ux_wa_links_live ON wa_links(message_id, kind, record_id) WHERE unlinked_at IS NULL;
CREATE INDEX ix_wa_links_record ON wa_links(owner_id, kind, record_id);

CREATE TABLE wa_statuses (
  id TEXT PRIMARY KEY, wamid TEXT NOT NULL, status TEXT NOT NULL, phone TEXT, error TEXT, at INTEGER NOT NULL, received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_wa_statuses ON wa_statuses(wamid, status);
CREATE INDEX ix_wa_statuses_at ON wa_statuses(status, at);

CREATE TABLE wa_webhook_log (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('bad_signature','not_set_up','switched_off','bad_body','accepted','other_number')),
  messages INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, statuses INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER trg_ao_wa_webhook_log_update BEFORE UPDATE ON wa_webhook_log BEGIN SELECT RAISE(ABORT, 'wa_webhook_log is append-only: update refused'); END;
CREATE TRIGGER trg_ao_wa_webhook_log_delete BEFORE DELETE ON wa_webhook_log BEGIN SELECT RAISE(ABORT, 'wa_webhook_log is append-only: delete refused'); END;
CREATE TRIGGER trg_ao_wa_statuses_delete BEFORE DELETE ON wa_statuses BEGIN SELECT RAISE(ABORT, 'wa_statuses is append-only: delete refused'); END;
CREATE TRIGGER trg_ao_wa_messages_delete BEFORE DELETE ON wa_messages BEGIN SELECT RAISE(ABORT, 'wa_messages are never deleted: dismiss instead'); END;
CREATE TRIGGER trg_ao_wa_links_delete BEFORE DELETE ON wa_links BEGIN SELECT RAISE(ABORT, 'wa_links are never deleted: unlink instead'); END;
`);

// One request per WhatsApp message in a business, whoever makes it: the database refuses a second, not only the page.
registerSchema('wainbox-2', `
CREATE UNIQUE INDEX ux_tasks_whatsapp_request ON tasks(owner_id, intake_key) WHERE intake_key LIKE 'wa:%';
`);

/** WhatsApp's own cap for documents is 100 MB; a team update larger than this is refused rather than kept. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_TRIES = 5;
/** The window WhatsApp allows free-text replies in, from the person's last message. */
export const REPLY_WINDOW_MS = 24 * 3600_000;
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const KINDS = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'button', 'reaction', 'unsupported'] as const;
type Kind = (typeof KINDS)[number];
type LinkKind = 'task' | 'project' | 'cash';
type State = 'review' | 'filed' | 'dismissed' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

interface MsgRow {
  id: string; wamid: string; owner_id: string; direction: 'in' | 'out'; phone: string; person_id: string | null; profile_name: string | null; kind: Kind;
  body: string | null; media_id: string | null; media_mime: string | null; media_name: string | null; media_sha256: string | null;
  media_state: 'none' | 'waiting' | 'stored' | 'failed' | 'rejected'; media_tries: number; media_error: string | null; context_wamid: string | null;
  raw: string; sent_at: number; received_at: number; state: State; suggestion: string | null; reviewed_by: string | null; reviewed_at: number | null;
  review_note: string | null; client_key: string | null; created_by: string | null;
}
interface LinkRow { id: string; message_id: string; owner_id: string; kind: LinkKind; record_id: string; why: string | null; linked_by: string | null; linked_at: number; unlinked_at: number | null; unlinked_by: string | null; unlinked_reason: string | null }

// ---- set-up and switch

/** Every setting the incoming side needs: the sending connection (token, number) plus the webhook's app secret and verify token. */
export const inboundConnected = (cfg: Config): boolean => !!(cfg.whatsapp.token && cfg.whatsapp.phoneId && cfg.whatsapp.appSecret && cfg.whatsapp.verifyToken);
export const inboundOn = (): boolean => getSettings().whatsappInboundEnabled === true;

/** The business a message from a number that is not on any team goes to: the main customer business, else the first owner. */
export function inboxBusiness(): string | null {
  const main = mainSiteBusinessId();
  if (main && one("SELECT 1 x FROM users WHERE id = ? AND role = 'owner' AND active = 1", main)) return main;
  return one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' AND active = 1 ORDER BY created_at, rowid LIMIT 1")?.id ?? null;
}

const safeEq = (a: string, b: string): boolean => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Meta's subscribe check: GET with hub.mode=subscribe, hub.verify_token and hub.challenge. Returns the challenge, or null to refuse. */
export function verifySubscription(cfg: Config, q: URLSearchParams): string | null {
  const token = cfg.whatsapp.verifyToken;
  if (!token || q.get('hub.mode') !== 'subscribe') return null;
  const given = q.get('hub.verify_token') ?? '';
  const challenge = q.get('hub.challenge') ?? '';
  if (!safeEq(given, token) || !/^[\w-]{1,128}$/.test(challenge)) return null;
  return challenge;
}

export const webhookSignature = (secret: string, raw: Buffer): string => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

function logHook(outcome: 'bad_signature' | 'not_set_up' | 'switched_off' | 'bad_body' | 'accepted' | 'other_number', n = { messages: 0, duplicates: 0, statuses: 0 }): void {
  try { run('INSERT INTO wa_webhook_log(id, at, outcome, messages, duplicates, statuses) VALUES (?,?,?,?,?,?)', newId('wah'), now(), outcome, n.messages, n.duplicates, n.statuses); } catch { /* the log is never the reason a delivery fails */ }
}

// ---- the webhook

export interface HookResult { status: number; outcome: string; messages: number; duplicates: number; statuses: number }

/**
 * One delivery from Meta. The signature is over the raw bytes and is checked first, before the body is read. A bad
 * signature is 401 and nothing is kept. Switched off: 200 (so Meta does not keep retrying) and nothing is kept. A message
 * already received (same WhatsApp message id) is not kept twice, so Meta's retries are harmless.
 */
export function handleInbound(cfg: Config, raw: Buffer, signature: string | undefined): HookResult {
  const none = { messages: 0, duplicates: 0, statuses: 0 };
  if (!cfg.whatsapp.appSecret) { logHook('not_set_up'); return { status: 503, outcome: 'not_set_up', ...none }; }
  if (!signature || !safeEq(signature, webhookSignature(cfg.whatsapp.appSecret, raw))) { logHook('bad_signature'); return { status: 401, outcome: 'bad_signature', ...none }; }
  if (!inboundOn()) { logHook('switched_off', { ...none, messages: countMessages(raw) }); return { status: 200, outcome: 'switched_off', ...none }; }
  let body: any;
  try { body = JSON.parse(raw.toString('utf8')); } catch { logHook('bad_body'); return { status: 400, outcome: 'bad_body', ...none }; }
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) { logHook('bad_body'); return { status: 400, outcome: 'bad_body', ...none }; }
  const n = { messages: 0, duplicates: 0, statuses: 0 };
  let other = false;
  for (const entry of body.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value;
      if (change?.field !== 'messages' || !v) continue;
      // another number on the same Meta app is not ours to keep
      if (cfg.whatsapp.phoneId && String(v.metadata?.phone_number_id ?? '') !== cfg.whatsapp.phoneId) { other = true; continue; }
      const names = new Map<string, string>();
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) if (c?.wa_id) names.set(String(c.wa_id), String(c.profile?.name ?? '').slice(0, 80));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (keepMessage(m, names)) n.messages++; else n.duplicates++;
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) if (keepStatus(s)) n.statuses++;
    }
  }
  logHook(other && !n.messages && !n.statuses ? 'other_number' : 'accepted', n);
  return { status: 200, outcome: 'accepted', ...n };
}

/** How many messages a delivery carried, read only to count them: while switched off nothing in it is kept, but the owner is told how many arrived. */
function countMessages(raw: Buffer): number {
  try {
    const body = JSON.parse(raw.toString('utf8'));
    let n = 0;
    for (const e of Array.isArray(body?.entry) ? body.entry : []) for (const c of Array.isArray(e?.changes) ? e.changes : []) if (Array.isArray(c?.value?.messages)) n += c.value.messages.length;
    return Math.min(n, 1000);
  } catch { return 0; }
}

const digits = (s: unknown): string => String(s ?? '').replace(/\D/g, '').slice(0, 20);

/** The team member or owner whose saved number this is. Two people with the same number: nobody (a person decides). */
function personFor(phone: string): UserRow | null {
  if (phone.length < 10) return null;
  const tail = phone.slice(-10);
  const hits = many<UserRow>("SELECT * FROM users WHERE phone LIKE ? AND role IN ('owner','staff') AND active = 1", `%${tail}`).filter((u) => u.phone && waNumber(u.phone) === phone);
  return hits.length === 1 ? hits[0]! : null;
}

function kindOf(m: any): Kind {
  const t = String(m?.type ?? '');
  return (KINDS as readonly string[]).includes(t) ? (t as Kind) : 'unsupported';
}

/** The words of a message, whatever its kind: text, a caption, a button or list answer, a place, a shared contact or a reaction. */
function wordsOf(m: any, kind: Kind): string | null {
  const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 4000) : null);
  switch (kind) {
    case 'text': return s(m.text?.body);
    case 'image': case 'video': case 'document': case 'audio': case 'sticker': return s(m[kind]?.caption);
    case 'button': return s(m.button?.text);
    case 'interactive': return s(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title);
    case 'location': { const l = m.location ?? {}; return s([l.name, l.address, l.latitude !== undefined ? `${l.latitude}, ${l.longitude}` : null].filter(Boolean).join(' · ')); }
    case 'contacts': return s((Array.isArray(m.contacts) ? m.contacts : []).map((c: any) => [c?.name?.formatted_name, ...(Array.isArray(c?.phones) ? c.phones.map((p: any) => p?.phone) : [])].filter(Boolean).join(' ')).join('; '));
    case 'reaction': return s(m.reaction?.emoji);
    default: return null;
  }
}

function keepMessage(m: any, names: Map<string, string>): boolean {
  const wamid = String(m?.id ?? '').slice(0, 200);
  const phone = digits(m?.from);
  if (!wamid || !phone) return false;
  if (one('SELECT 1 x FROM wa_messages WHERE wamid = ?', wamid)) return false;
  const kind = kindOf(m);
  const person = personFor(phone);
  const ownerId = person ? (person.role === 'owner' ? person.id : person.owner_id) : inboxBusiness();
  if (!ownerId) return false;
  const media = MEDIA_KINDS.has(kind) ? m[kind] ?? {} : null;
  const words = wordsOf(m, kind);
  const context = typeof m.context?.id === 'string' ? m.context.id.slice(0, 200) : null;
  const sentAt = Number(m.timestamp) > 0 ? Number(m.timestamp) * 1000 : now();
  const id = newId('wam');
  const { state, suggestion, autoLinks } = route(ownerId, person, kind, words, context);
  tx(() => {
    run(`INSERT INTO wa_messages(id, wamid, owner_id, direction, phone, person_id, profile_name, kind, body, media_id, media_mime, media_name, media_sha256, media_state, context_wamid, raw, sent_at, received_at, state, suggestion)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wamid) DO NOTHING`,
      id, wamid, ownerId, 'in', phone, person?.id ?? null, names.get(phone) || null, kind, words === null ? null : seal(words),
      media?.id ? String(media.id).slice(0, 200) : null, media?.mime_type ? String(media.mime_type).slice(0, 100) : null,
      media?.filename ? String(media.filename).slice(0, 200) : null, media?.sha256 ? String(media.sha256).slice(0, 100) : null,
      media?.id ? 'waiting' : 'none', context, seal(JSON.stringify(m)), sentAt, now(), state, suggestion ? JSON.stringify(suggestion) : null);
    for (const l of autoLinks) run('INSERT INTO wa_links(id, message_id, owner_id, kind, record_id, why, linked_by, linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', newId('wal'), id, ownerId, l.kind, l.recordId, l.why, null, now());
  });
  // the entry says who and what kind, never the words
  audit(SYSTEM, 'whatsapp.received', 'whatsapp', id, { kind, fromTeam: !!person, state, media: !!media?.id }, ownerId);
  return true;
}

interface Suggestion { kind: LinkKind | 'none'; recordId: string | null; why: string }
/**
 * Where a new message goes. Filed by itself only when it replies to a message we sent that is on a record. Otherwise it
 * waits for review, with a suggestion a person confirms or ignores.
 */
function route(ownerId: string, person: UserRow | null, kind: Kind, words: string | null, context: string | null): { state: State; suggestion: Suggestion | null; autoLinks: { kind: LinkKind; recordId: string; why: string }[] } {
  if (context) {
    const parent = one<{ id: string; owner_id: string }>("SELECT id, owner_id FROM wa_messages WHERE wamid = ? AND direction = 'out'", context);
    if (parent && parent.owner_id === ownerId) {
      const links = many<LinkRow>('SELECT * FROM wa_links WHERE message_id = ? AND unlinked_at IS NULL', parent.id);
      if (links.length) return { state: 'filed', suggestion: null, autoLinks: links.map((l) => ({ kind: l.kind, recordId: l.record_id, why: 'A reply to the message sent about this' })) };
    }
  }
  if (!person) return { state: 'review', suggestion: { kind: 'none', recordId: null, why: 'This number is not on the team.' }, autoLinks: [] };
  const t = (words ?? '').toLowerCase();
  if ((kind === 'image' || kind === 'document') && /(₹|\brs\.?\s?\d|\brupees?\b|\breceipt\b|\bbill\b|\binvoice\b|\bpaid\b|\bkharch|\bbil\b)/.test(t)) {
    return { state: 'review', suggestion: { kind: 'cash', recordId: null, why: 'It looks like a receipt or a bill: put it against a cash spend.' }, autoLinks: [] };
  }
  if (person.role === 'staff') {
    const open = many<{ id: string; title: string }>("SELECT id, title FROM tasks WHERE owner_id = ? AND assigned_to = ? AND status = 'open' AND (intake_state IS NULL OR intake_state <> 'new') ORDER BY due_date IS NULL, due_date LIMIT 2", ownerId, person.id);
    if (open.length === 1) return { state: 'review', suggestion: { kind: 'task', recordId: open[0]!.id, why: 'Their only open job.' }, autoLinks: [] };
  }
  return { state: 'review', suggestion: null, autoLinks: [] };
}

const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };
/** The state a sent message has reached from the statuses kept for it: failed wins whenever it comes, otherwise the furthest. */
function settleState(rowId: string, wamid: string, from: State): void {
  const got = many<{ status: string; error: string | null }>('SELECT status, error FROM wa_statuses WHERE wamid = ?', wamid);
  const failed = got.find((g) => g.status === 'failed');
  if (failed) { if (from !== 'failed') run("UPDATE wa_messages SET state = 'failed', media_error = COALESCE(?, media_error) WHERE id = ?", failed.error, rowId); return; }
  if (from === 'failed') return;
  let best: State = from;
  for (const g of got) if ((STATUS_RANK[g.status] ?? -1) > (STATUS_RANK[best] ?? -1)) best = g.status as State;
  if (best !== from) run('UPDATE wa_messages SET state = ? WHERE id = ?', best, rowId);
}
function keepStatus(s: any): boolean {
  const wamid = String(s?.id ?? '').slice(0, 200);
  const status = String(s?.status ?? '');
  if (!wamid || !['sent', 'delivered', 'read', 'failed'].includes(status)) return false;
  const at = Number(s.timestamp) > 0 ? Number(s.timestamp) * 1000 : now();
  const err = Array.isArray(s.errors) && s.errors[0] ? `${s.errors[0].code ?? ''} ${s.errors[0].title ?? s.errors[0].message ?? ''}`.trim().slice(0, 200) : null;
  const r = run('INSERT INTO wa_statuses(id, wamid, status, phone, error, at, received_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(wamid, status) DO NOTHING', newId('was'), wamid, status, digits(s.recipient_id) || null, err, at, now());
  // a status only moves forward; failed wins whenever it comes
  const m = one<{ id: string; state: State }>("SELECT id, state FROM wa_messages WHERE wamid = ? AND direction = 'out'", wamid);
  if (m) settleState(m.id, wamid, m.state);
  return Number(r.changes) > 0;
}

// ---- media: fetched after the webhook, checked, then kept

export type MediaFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const mediaPath = (dataDir: string, m: { owner_id: string; id: string }) => join(dataDir, 'whatsapp', m.owner_id, m.id);
/** Where a kept file is. It moves with its message; a file left under another business by an earlier move is still found. */
function keptFile(dataDir: string, m: { owner_id: string; id: string }): string | null {
  const p = mediaPath(dataDir, m);
  if (existsSync(p)) return p;
  const root = join(dataDir, 'whatsapp');
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) { const q = join(root, d, m.id); if (d !== m.owner_id && existsSync(q)) return q; }
  return null;
}

/**
 * Fetches the files of messages that are waiting: asks WhatsApp where the file is, downloads it with the token, checks its
 * size and checksum, runs the virus check and keeps it. A file that fails the virus check is refused for good; a fetch that
 * fails is tried again later, up to five times, then shown as failed with a Try again button.
 */
export async function fetchWaitingMedia(cfg: Config, f: MediaFetch = fetch as unknown as MediaFetch, limit = 20): Promise<{ stored: number; failed: number; rejected: number; waiting: number; attached: number }> {
  const out = { stored: 0, failed: 0, rejected: 0, waiting: 0, attached: 0 };
  if (!cfg.whatsapp.token) return out;
  const rows = many<MsgRow>("SELECT * FROM wa_messages WHERE media_state = 'waiting' AND media_id IS NOT NULL ORDER BY received_at LIMIT ?", limit);
  for (const m of rows) {
    const tried = m.media_tries + 1;
    const fail = (why: string, final = false) => {
      const gaveUp = final || tried >= MAX_MEDIA_TRIES;
      run('UPDATE wa_messages SET media_tries = ?, media_error = ?, media_state = ? WHERE id = ?', tried, why.slice(0, 200), gaveUp ? 'failed' : 'waiting', m.id);
      if (gaveUp) out.failed++; else out.waiting++;
    };
    try {
      const auth = { authorization: `Bearer ${cfg.whatsapp.token}` };
      const meta = await f(`${cfg.whatsapp.apiUrl}/${encodeURIComponent(m.media_id!)}`, { method: 'GET', headers: auth, signal: AbortSignal.timeout(10_000) });
      if (!meta.ok) { fail(`WhatsApp did not give the file (${meta.status})`, meta.status === 404); continue; }
      const info = JSON.parse(await meta.text()) as { url?: string; mime_type?: string; sha256?: string; file_size?: number };
      if (!info.url || !/^https:\/\//.test(info.url)) { fail('WhatsApp gave no address for the file'); continue; }
      if (Number(info.file_size) > MAX_MEDIA_BYTES) { fail(`The file is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB`, true); continue; }
      const res = await f(info.url, { method: 'GET', headers: auth, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) { fail(`The file could not be downloaded (${res.status})`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) { fail('The file was empty'); continue; }
      if (buf.length > MAX_MEDIA_BYTES) { fail(`The file is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB`, true); continue; }
      const digest = createHash('sha256').update(buf).digest('hex');
      const want = (info.sha256 ?? m.media_sha256 ?? '').toLowerCase();
      // WhatsApp gives the checksum in hex or base64 depending on where it is read; either must match
      if (want && want !== digest && want !== createHash('sha256').update(buf).digest('base64').toLowerCase()) { fail('The file did not match its checksum'); continue; }
      try { await gateUpload(buf, 'whatsapp_media', SYSTEM, m.owner_id); } catch (e) {
        if (e instanceof HttpError && e.status === 422) { run("UPDATE wa_messages SET media_tries = ?, media_state = 'rejected', media_error = ? WHERE id = ?", tried, 'The file did not pass the virus check, so it was not kept.', m.id); out.rejected++; continue; }
        fail(e instanceof HttpError ? e.message : 'The virus check could not run'); continue;
      }
      const mime = (info.mime_type || m.media_mime || 'application/octet-stream').split(';')[0]!.trim().slice(0, 100);
      // read again after the downloads: the message may have been passed to another business meanwhile, and the file goes where it is now
      const now_ = one<{ owner_id: string; media_state: string }>('SELECT owner_id, media_state FROM wa_messages WHERE id = ?', m.id);
      if (!now_ || now_.media_state !== 'waiting') continue;
      storeUpload({ dataDir: cfg.dataDir, buf, finalPath: mediaPath(cfg.dataDir, { owner_id: now_.owner_id, id: m.id }), purpose: 'whatsapp_media', actor: SYSTEM, ownerId: now_.owner_id,
        writeMetadata: () => run("UPDATE wa_messages SET media_state = 'stored', media_mime = ?, media_tries = ?, media_error = NULL WHERE id = ?", mime, tried, m.id) });
      out.stored++;
      out.attached += await attachToJobs(cfg.dataDir, m.id);
    } catch (e) { fail(`Could not reach WhatsApp: ${(e as Error).message}`); }
  }
  return out;
}

// ---- who may see what

const isBoss = (u: UserRow, ownerId: string): boolean => u.role === 'super_admin' || (u.role === 'owner' && u.id === ownerId);
/** The inbox is for the owner and for team members with "manage_tasks" in this business. */
function mayUseInbox(u: UserRow, ownerId: string): void {
  if (isBoss(u, ownerId)) return;
  if (u.role !== 'staff' || !worksIn(u.id, ownerId) || !hasPermission(u, 'manage_tasks')) throw forbidden('The WhatsApp inbox needs the "manage_tasks" permission');
}

/** Whether this person may see the record a link points to. A record they may not see hides the link, and a message filed only there. */
function maySeeRecord(u: UserRow, ownerId: string, kind: LinkKind, recordId: string): boolean {
  try {
    if (kind === 'task') { const t = visibleTask(u, recordId); return t.owner_id === ownerId; }
    if (kind === 'project') {
      const p = one<{ owner_id: string; area_id: string | null }>('SELECT owner_id, area_id FROM projects WHERE id = ?', recordId);
      return !!p && p.owner_id === ownerId && canSeeArea(u, ownerId, p.area_id);
    }
    const c = one<{ owner_id: string; holder_id: string; area_id: string | null }>("SELECT owner_id, holder_id, area_id FROM cash_entries WHERE id = ? AND kind = 'expense'", recordId);
    return !!c && c.owner_id === ownerId && (isBoss(u, ownerId) || c.holder_id === u.id) && canSeeArea(u, ownerId, c.area_id);
  } catch { return false; }
}

function recordTitle(kind: LinkKind, id: string): string | null {
  if (kind === 'task') return one<{ title: string }>('SELECT title FROM tasks WHERE id = ?', id)?.title ?? null;
  if (kind === 'project') return one<{ name: string }>('SELECT name FROM projects WHERE id = ?', id)?.name ?? null;
  const c = one<{ description: string; amount_paise: number }>('SELECT description, amount_paise FROM cash_entries WHERE id = ?', id);
  return c ? `${c.description} (₹${(c.amount_paise / 100).toLocaleString('en-IN')})` : null;
}

const liveLinks = (messageId: string) => many<LinkRow>('SELECT * FROM wa_links WHERE message_id = ? AND unlinked_at IS NULL ORDER BY linked_at', messageId);
/** A message is visible when it is not filed, or when at least one record it is filed against is visible. */
function visible(u: UserRow, m: MsgRow, links = liveLinks(m.id)): boolean {
  if (isBoss(u, m.owner_id)) return true;
  if (m.state === 'filed' && links.length) return links.some((l) => maySeeRecord(u, m.owner_id, l.kind, l.record_id));
  return true;
}

const nameOf = (id: string | null): string | null => (id ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);
/** A number not on the team shows its last four digits only, so a list on a shared screen does not give out phone numbers. */
const maskPhone = (p: string): string => (p.length > 4 ? `•••• ${p.slice(-4)}` : p);
const readText = (s: string | null): string | null => { if (s === null) return null; try { return unseal(s); } catch { return '(this message cannot be read: the server key changed)'; } };

export interface MessageOut {
  id: string; direction: 'in' | 'out'; from: string; personId: string | null; personName: string | null; profileName: string | null; onTeam: boolean;
  kind: Kind; text: string | null; hasMedia: boolean; mediaState: MsgRow['media_state']; mediaMime: string | null; mediaName: string | null; mediaError: string | null;
  sentAt: number; receivedAt: number; state: State; suggestion: (Suggestion & { title: string | null }) | null;
  /** file, on a job link: whether the picture or PDF with the message is on the job yet. coming: it goes on by itself when it arrives. */
  links: { id: string; kind: LinkKind; recordId: string; title: string | null; why: string | null; byName: string | null; at: number; file: 'on_job' | 'coming' | 'not_on_job' | null }[];
  reviewedByName: string | null; reviewNote: string | null; canReply: boolean; replyClosesAt: number | null;
}

function lastInboundAt(ownerId: string, phone: string): number | null {
  return one<{ t: number | null }>("SELECT MAX(sent_at) t FROM wa_messages WHERE owner_id = ? AND phone = ? AND direction = 'in'", ownerId, phone)?.t ?? null;
}

function out(u: UserRow, m: MsgRow, links = liveLinks(m.id)): MessageOut {
  const seen = links.filter((l) => maySeeRecord(u, m.owner_id, l.kind, l.record_id));
  let sug: Suggestion | null = null;
  try { sug = m.suggestion ? JSON.parse(m.suggestion) : null; } catch { /* none */ }
  if (sug?.recordId && sug.kind !== 'none' && !maySeeRecord(u, m.owner_id, sug.kind, sug.recordId)) sug = { kind: sug.kind, recordId: null, why: sug.why };
  const last = m.direction === 'in' ? lastInboundAt(m.owner_id, m.phone) : null;
  const closes = last ? last + REPLY_WINDOW_MS : null;
  return {
    id: m.id, direction: m.direction, from: m.person_id ? m.phone : maskPhone(m.phone), personId: m.person_id, personName: nameOf(m.person_id), profileName: m.profile_name, onTeam: !!m.person_id,
    kind: m.kind, text: readText(m.body), hasMedia: !!m.media_id, mediaState: m.media_state, mediaMime: m.media_mime, mediaName: m.media_name, mediaError: m.media_error,
    sentAt: m.sent_at, receivedAt: m.received_at, state: m.state,
    suggestion: sug ? { ...sug, title: sug.recordId && sug.kind !== 'none' ? recordTitle(sug.kind, sug.recordId) : null } : null,
    links: seen.map((l) => ({ id: l.id, kind: l.kind, recordId: l.record_id, title: recordTitle(l.kind, l.record_id), why: l.why, byName: nameOf(l.linked_by), at: l.linked_at, file: fileOnJob(m, l) })),
    reviewedByName: nameOf(m.reviewed_by), reviewNote: m.review_note, canReply: m.direction === 'in' && closes !== null && closes > now(), replyClosesAt: m.direction === 'in' ? closes : null,
  };
}

/** Whether a job link's picture or PDF has reached the job. Null when there is no such file, or someone took it off the job. */
function fileOnJob(m: MsgRow, l: LinkRow): 'on_job' | 'coming' | 'not_on_job' | null {
  if (l.kind !== 'task' || !m.media_id || !m.media_mime || !REF_MIMES.has(m.media_mime)) return null;
  const ref = one<{ hidden_at: number | null }>('SELECT hidden_at FROM task_refs WHERE task_id = ? AND note = ? ORDER BY hidden_at IS NULL DESC LIMIT 1', l.record_id, `WhatsApp ${m.id}`);
  if (ref) return ref.hidden_at === null ? 'on_job' : null;
  return m.media_state === 'waiting' ? 'coming' : 'not_on_job';
}

function rowOr404(u: UserRow, ownerId: string, id: string): MsgRow {
  mayUseInbox(u, ownerId);
  const m = one<MsgRow>('SELECT * FROM wa_messages WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!m || !visible(u, m)) throw notFound('Message not found');
  return m;
}

// ---- reading

export interface InboxStatus {
  enabled: boolean; connected: boolean | null; inboxHere: boolean;
  counts: { review: number; filed: number; dismissed: number; mediaFailed: number; mediaWaiting: number; sendsFailed: number; filesNotOnJob: number };
  lastDelivery: { at: number; outcome: string } | null;
  /** Owner of the main business only: messages that arrived while switched off. They were not kept, and WhatsApp does not send them again. */
  droppedWhileOff: { messages: number; lastAt: number } | null;
}
export function inboxStatus(cfg: Config | undefined, u: UserRow, ownerId: string): InboxStatus {
  mayUseInbox(u, ownerId);
  const c = one<{ review: number; filed: number; dismissed: number; mf: number; mw: number; sf: number }>(
    `SELECT COALESCE(SUM(state = 'review'), 0) review, COALESCE(SUM(state = 'filed'), 0) filed, COALESCE(SUM(state = 'dismissed'), 0) dismissed,
            COALESCE(SUM(direction = 'in' AND media_state IN ('failed','rejected')), 0) mf, COALESCE(SUM(direction = 'in' AND media_state = 'waiting'), 0) mw,
            COALESCE(SUM(direction = 'out' AND state = 'failed'), 0) sf FROM wa_messages WHERE owner_id = ?`, ownerId)!;
  const last = isBoss(u, ownerId) ? one<{ at: number; outcome: string }>('SELECT at, outcome FROM wa_webhook_log ORDER BY at DESC, id DESC LIMIT 1') ?? null : null;
  const notOnJob = one<{ n: number }>(`SELECT COUNT(*) n FROM wa_links l JOIN wa_messages m ON m.id = l.message_id
    WHERE l.owner_id = ? AND l.kind = 'task' AND l.unlinked_at IS NULL AND m.media_id IS NOT NULL AND m.media_mime IN (${[...REF_MIMES].map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM task_refs r WHERE r.task_id = l.record_id AND r.note = 'WhatsApp ' || m.id)`, ownerId, ...REF_MIMES)!.n;
  const dropped = isBoss(u, ownerId) && inboxBusiness() === ownerId ? one<{ n: number; at: number | null }>("SELECT COALESCE(SUM(messages), 0) n, MAX(at) at FROM wa_webhook_log WHERE outcome = 'switched_off'")! : null;
  return { enabled: inboundOn(), connected: cfg ? inboundConnected(cfg) : null, inboxHere: inboxBusiness() === ownerId,
    counts: { review: c.review, filed: c.filed, dismissed: c.dismissed, mediaFailed: c.mf, mediaWaiting: c.mw, sendsFailed: c.sf, filesNotOnJob: notOnJob }, lastDelivery: last,
    droppedWhileOff: dropped && dropped.n > 0 ? { messages: dropped.n, lastAt: dropped.at! } : null };
}

export function listMessages(u: UserRow, ownerId: string, q: { state?: string | null; personId?: string | null; limit?: number }): { items: MessageOut[] } {
  mayUseInbox(u, ownerId);
  const state = q.state ?? 'review';
  const where: string[] = ['owner_id = ?']; const params: (string | number)[] = [ownerId];
  if (state === 'failed') where.push("((direction = 'in' AND media_state IN ('failed','rejected')) OR (direction = 'out' AND state = 'failed'))");
  else if (state !== 'all') { if (!['review', 'filed', 'dismissed'].includes(state)) throw new HttpError(400, 'VALIDATION_FAILED', 'state must be review, filed, dismissed, failed or all'); where.push('state = ?'); params.push(state); }
  if (q.personId) { where.push('person_id = ?'); params.push(q.personId); }
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const rows = many<MsgRow>(`SELECT * FROM wa_messages WHERE ${where.join(' AND ')} ORDER BY received_at DESC, rowid DESC LIMIT ?`, ...params, limit);
  return { items: rows.map((m) => ({ m, links: liveLinks(m.id) })).filter((x) => visible(u, x.m, x.links)).map((x) => out(u, x.m, x.links)) };
}

/** One message and the conversation with that number around it (the 50 latest messages the asker may see). */
export function getMessage(u: UserRow, ownerId: string, id: string): { message: MessageOut; conversation: MessageOut[] } {
  const m = rowOr404(u, ownerId, id);
  const conv = many<MsgRow>('SELECT * FROM wa_messages WHERE owner_id = ? AND phone = ? ORDER BY sent_at DESC, rowid DESC LIMIT 50', ownerId, m.phone).filter((x) => visible(u, x)).reverse();
  return { message: out(u, m), conversation: conv.map((x) => out(u, x)) };
}

export function mediaFile(dataDir: string, u: UserRow, ownerId: string, id: string): { buf: Buffer; mime: string; name: string | null } {
  const m = rowOr404(u, ownerId, id);
  const p = keptFile(dataDir, m);
  if (m.media_state !== 'stored' || !p) throw notFound('This file has not been kept');
  return { buf: readFileSync(p), mime: m.media_mime ?? 'application/octet-stream', name: m.media_name };
}

/** The messages put against one record, for that record's own page. Refused like the record itself for anyone who may not see it. */
export function linkedTo(u: UserRow, ownerId: string, kind: string, recordId: string): { items: MessageOut[] } {
  if (kind !== 'task' && kind !== 'project' && kind !== 'cash') throw new HttpError(400, 'VALIDATION_FAILED', 'kind must be task, project or cash');
  if (!maySeeRecord(u, ownerId, kind, recordId)) throw notFound('Not found');
  const rows = many<MsgRow>(`SELECT m.* FROM wa_messages m JOIN wa_links l ON l.message_id = m.id AND l.unlinked_at IS NULL
                             WHERE l.owner_id = ? AND l.kind = ? AND l.record_id = ? ORDER BY m.sent_at, m.rowid`, ownerId, kind, recordId);
  return { items: rows.map((m) => out(u, m)) };
}

// ---- review actions

const actorOf = (u: UserRow): Actor => ({ id: u.id, role: u.role });

function checkRecord(u: UserRow, ownerId: string, kind: LinkKind, recordId: string): void {
  if (!maySeeRecord(u, ownerId, kind, recordId)) throw notFound(kind === 'task' ? 'Job not found' : kind === 'project' ? 'Project not found' : 'Cash spend not found');
}

const REF_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
/**
 * A picture or PDF that came with the message goes on the job as a reference (taskwork.ts), never as proof: proof stays
 * fresh camera shots only. It is checked for viruses again on the way in. Returns why not, when it could not be added.
 */
async function addAsReference(dataDir: string, u: UserRow, m: MsgRow, taskId: string): Promise<string | null> {
  if (!m.media_id) return null;
  if (m.media_state === 'waiting') return 'The file is still coming from WhatsApp. It goes on the job by itself when it arrives.';
  if (m.media_state !== 'stored') return 'The file could not be fetched from WhatsApp, so it is not on the job. Press Try again on the message.';
  if (!m.media_mime || !REF_MIMES.has(m.media_mime)) return 'Only pictures and PDFs go on a job as references; this file stays with the message.';
  const p = keptFile(dataDir, m);
  if (!p) return 'The file is missing on the server.';
  const buf = readFileSync(p);
  if (buf.length > MAX_REF_BYTES) return `References can be up to ${MAX_REF_BYTES / 1024 / 1024} MB; this file stays with the message.`;
  if (one('SELECT 1 x FROM task_refs WHERE task_id = ? AND note = ? AND hidden_at IS NULL', taskId, `WhatsApp ${m.id}`)) return null;
  try {
    await gateUpload(buf, 'task_reference', actorOf(u), m.owner_id);
    addRefFile(dataDir, u, taskId, buf, m.media_name ?? `whatsapp-${m.kind}`, `WhatsApp ${m.id}`);
    return null;
  } catch (e) { return e instanceof HttpError ? e.message : 'The file could not be added to the job.'; }
}

/**
 * A file that arrives after its message was filed on a job, or made into a request, goes on those jobs now. It is added as
 * the person who filed it, or the owner when that person may no longer work on the job. Returns how many jobs it reached.
 */
async function attachToJobs(dataDir: string, messageId: string): Promise<number> {
  const m = one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', messageId);
  if (!m || m.media_state !== 'stored') return 0;
  let n = 0;
  for (const l of liveLinks(m.id).filter((x) => x.kind === 'task')) {
    if (one('SELECT 1 x FROM task_refs WHERE task_id = ? AND note = ?', l.record_id, `WhatsApp ${m.id}`)) continue; // on already, or taken off by a person
    const people = [l.linked_by, m.owner_id].filter((x): x is string => !!x).map((id) => one<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', id)).filter((x): x is UserRow => !!x);
    let why: string | null = 'No one who may work on the job';
    for (const u of people) {
      try { visibleTask(u, l.record_id); } catch { continue; }
      why = await addAsReference(dataDir, u, m, l.record_id);
      if (why === null) break;
    }
    if (why === null) { n++; audit(SYSTEM, 'whatsapp.file_on_job', 'whatsapp', m.id, { taskId: l.record_id }, m.owner_id); }
    else console.error(JSON.stringify({ level: 'warn', where: 'whatsapp-attach', message: m.id, task: l.record_id, error: why }));
  }
  return n;
}

/**
 * Puts a message against a job, a project or a cash spend the person may see. Doing it twice is not an error and adds
 * nothing. On a job, a picture or PDF with it is added to the job's references.
 */
export async function linkMessage(dataDir: string, u: UserRow, ownerId: string, id: string, body: unknown): Promise<MessageOut & { note: string | null }> {
  const m = rowOr404(u, ownerId, id);
  const v = new Validator(body);
  const kind = v.oneOf('kind', ['task', 'project', 'cash'] as const, true);
  const recordId = v.str('recordId', { required: true, max: 64 });
  v.done();
  if (m.direction !== 'in') throw conflict('NOT_INBOUND', 'Only a message that came in is put against a record');
  checkRecord(u, ownerId, kind!, recordId!);
  tx(() => {
    run('INSERT INTO wa_links(id, message_id, owner_id, kind, record_id, why, linked_by, linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', newId('wal'), m.id, ownerId, kind!, recordId!, null, u.id, now());
    run("UPDATE wa_messages SET state = 'filed', reviewed_by = ?, reviewed_at = ? WHERE id = ?", u.id, now(), m.id);
  });
  audit(actorOf(u), 'whatsapp.link', 'whatsapp', m.id, { kind, recordId }, ownerId);
  const note = kind === 'task' ? await addAsReference(dataDir, u, m, recordId!) : null;
  return { ...out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!), note };
}

/** Takes a message off a record, with a reason. The link stays on file as taken off; with no record left the message goes back to review. */
export function unlinkMessage(u: UserRow, ownerId: string, id: string, body: unknown): MessageOut {
  const m = rowOr404(u, ownerId, id);
  const v = new Validator(body);
  const linkId = v.str('linkId', { required: true, max: 64 });
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  const l = one<LinkRow>('SELECT * FROM wa_links WHERE id = ? AND message_id = ? AND unlinked_at IS NULL', linkId!, m.id);
  if (!l || !maySeeRecord(u, ownerId, l.kind, l.record_id)) throw notFound('Link not found');
  tx(() => {
    run('UPDATE wa_links SET unlinked_at = ?, unlinked_by = ?, unlinked_reason = ? WHERE id = ?', now(), u.id, reason!, l.id);
    if (!liveLinks(m.id).length && m.state === 'filed') run("UPDATE wa_messages SET state = 'review' WHERE id = ?", m.id);
  });
  audit(actorOf(u), 'whatsapp.unlink', 'whatsapp', m.id, { kind: l.kind, recordId: l.record_id, reason }, ownerId);
  return out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!);
}

/**
 * Turns a message into a request in the jobs inbox (tasks.ts raiseRequest), not straight onto the board: a manager takes it
 * in or turns it down there. The request keeps the message's words and says it came by WhatsApp, and a picture or PDF
 * with it goes on as a reference. The WhatsApp message id is the request's key, so pressing twice makes one request.
 */
export async function requestFromMessage(dataDir: string, u: UserRow, ownerId: string, id: string, body: unknown): Promise<{ task: { id: string; title: string }; message: MessageOut; note: string | null }> {
  const m = rowOr404(u, ownerId, id);
  if (m.direction !== 'in') throw conflict('NOT_INBOUND', 'Only a message that came in becomes a request');
  const src = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  // one request per message, whoever presses: a second manager gets the request already made. Everything from here to the
  // insert below runs without a pause, so two presses at the same moment cannot both get past this check.
  const key = `wa:${m.wamid}`.slice(0, 80);
  const already = () => one<{ id: string; title: string }>('SELECT id, title FROM tasks WHERE owner_id = ? AND intake_key = ? ORDER BY created_at LIMIT 1', ownerId, key);
  const made = already();
  if (made) {
    if (!maySeeRecord(u, ownerId, 'task', made.id)) throw conflict('REQUEST_MADE', 'A request was already made from this message');
    run('INSERT INTO wa_links(id, message_id, owner_id, kind, record_id, why, linked_by, linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', newId('wal'), m.id, ownerId, 'task', made.id, 'A request made from this message', u.id, now());
    if (m.state === 'review') run("UPDATE wa_messages SET state = 'filed', reviewed_by = ?, reviewed_at = ? WHERE id = ?", u.id, now(), m.id);
    const note = await addAsReference(dataDir, u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!, made.id);
    return { task: made, message: out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!), note };
  }
  const who = nameOf(m.person_id) ?? m.profile_name ?? maskPhone(m.phone);
  const words = readText(m.body);
  const details = typeof src.details === 'string' && src.details.trim() ? src.details : `From WhatsApp, ${who}${words ? `: ${words}` : m.media_id ? ` (${m.kind})` : ''}`.slice(0, 1000);
  let t: { id: string; title: string };
  try { t = raiseRequest(u, ownerId, { title: src.title, details, projectId: src.projectId ?? null, priority: src.priority, clientKey: key }); }
  catch (e) { if (already()) return requestFromMessage(dataDir, u, ownerId, id, body); throw e; }
  tx(() => {
    run('INSERT INTO wa_links(id, message_id, owner_id, kind, record_id, why, linked_by, linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', newId('wal'), m.id, ownerId, 'task', t.id, 'A request made from this message', u.id, now());
    run("UPDATE wa_messages SET state = 'filed', reviewed_by = ?, reviewed_at = ? WHERE id = ?", u.id, now(), m.id);
  });
  audit(actorOf(u), 'whatsapp.request', 'whatsapp', m.id, { taskId: t.id }, ownerId);
  const note = await addAsReference(dataDir, u, m, t.id);
  return { task: { id: t.id, title: t.title }, message: out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!), note };
}

/** Sets a message aside with a reason (spam, a personal message, nothing to do). It is kept, and can be put back for review. */
export function dismissMessage(u: UserRow, ownerId: string, id: string, body: unknown): MessageOut {
  const m = rowOr404(u, ownerId, id);
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  if (m.direction !== 'in') throw conflict('NOT_INBOUND', 'Only a message that came in is dismissed');
  if (m.state === 'filed') throw conflict('FILED', 'Take it off its records first');
  run("UPDATE wa_messages SET state = 'dismissed', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?", u.id, now(), reason!, m.id);
  audit(actorOf(u), 'whatsapp.dismiss', 'whatsapp', m.id, { reason }, ownerId);
  return out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!);
}

export function restoreMessage(u: UserRow, ownerId: string, id: string): MessageOut {
  const m = rowOr404(u, ownerId, id);
  if (m.state !== 'dismissed') throw conflict('NOT_DISMISSED', 'Only a dismissed message goes back for review');
  run("UPDATE wa_messages SET state = 'review', reviewed_by = ?, reviewed_at = ? WHERE id = ?", u.id, now(), m.id);
  audit(actorOf(u), 'whatsapp.restore', 'whatsapp', m.id, null, ownerId);
  return out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!);
}

export function retryMedia(u: UserRow, ownerId: string, id: string): MessageOut {
  const m = rowOr404(u, ownerId, id);
  if (m.media_state !== 'failed') throw conflict('NOT_FAILED', m.media_state === 'rejected' ? 'A file that failed the virus check is not fetched again' : 'This file is not waiting to be fetched again');
  run("UPDATE wa_messages SET media_state = 'waiting', media_tries = 0, media_error = NULL WHERE id = ?", m.id);
  audit(actorOf(u), 'whatsapp.media_retry', 'whatsapp', m.id, null, ownerId);
  return out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', m.id)!);
}

/**
 * Passes a message to another business the sender works in (or, for a number not on any team, another business the
 * owner holds). Only an owner who holds both businesses may do it. The message keeps its history; links do not travel.
 */
export function moveMessage(dataDir: string, u: UserRow, realUser: UserRow, ownerId: string, id: string, body: unknown): { moved: true; to: string } {
  const m = rowOr404(u, ownerId, id);
  const v = new Validator(body);
  const to = v.str('businessId', { required: true, max: 64 });
  v.done();
  if (to === ownerId) throw conflict('SAME_BUSINESS', 'It is already in this business');
  const holder = realUser.role === 'super_admin' || (holdsBusiness(realUser, ownerId) && holdsBusiness(realUser, to!));
  if (!holder) throw forbidden('Only an owner who holds both businesses passes a message between them');
  if (m.person_id && !(worksIn(m.person_id, to!) || m.person_id === to)) throw conflict('NOT_THEIR_BUSINESS', 'The sender does not work in that business');
  if (liveLinks(m.id).length) throw conflict('FILED', 'Take it off its records first');
  // the kept file moves with it, so the new business can open it; a file still coming is kept where the message is when it arrives
  const from = keptFile(dataDir, m);
  const dest = mediaPath(dataDir, { owner_id: to!, id: m.id });
  if (from && from !== dest) { mkdirSync(join(dataDir, 'whatsapp', to!), { recursive: true }); renameSync(from, dest); }
  try { run("UPDATE wa_messages SET owner_id = ?, state = 'review', suggestion = NULL WHERE id = ?", to!, m.id); } catch (e) { if (from && from !== dest) renameSync(dest, from); throw e; }
  audit(actorOf(u), 'whatsapp.move', 'whatsapp', m.id, { from: ownerId, to }, ownerId);
  audit(actorOf(u), 'whatsapp.move', 'whatsapp', m.id, { from: ownerId, to }, to!);
  return { moved: true, to: to! };
}

// ---- replying

export type SendFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
/** Tests put a stand-in for WhatsApp here; empty, replies go to the real service. */
export const waHooks: { send?: SendFetch } = {};

/**
 * A free-text reply to a message, from the business number. Allowed only while WhatsApp's 24-hour window from the person's
 * last message is open, and only with the feature on and the connection set up. The reply is filed on the same records as
 * the message it answers, so their answer to it files itself. A retry with the same clientKey sends nothing new.
 */
export async function replyTo(cfg: Config, u: UserRow, ownerId: string, id: string, body: unknown, f: SendFetch = waHooks.send ?? (fetch as unknown as SendFetch)): Promise<MessageOut> {
  const m = rowOr404(u, ownerId, id);
  const v = new Validator(body);
  const text = v.str('text', { required: true, min: 1, max: 1000 });
  const clientKey = v.str('clientKey', { max: 80 });
  v.done();
  if (clientKey) {
    const prior = one<MsgRow>('SELECT * FROM wa_messages WHERE owner_id = ? AND created_by = ? AND client_key = ?', ownerId, u.id, clientKey);
    if (prior) return out(u, prior);
  }
  if (!inboundOn()) throw new HttpError(503, 'FEATURE_OFF', 'WhatsApp messages coming in are switched off, so replies are too.');
  if (!inboundConnected(cfg)) throw new HttpError(503, 'NOT_SET_UP', 'WhatsApp is not set up yet (Settings › Connections).');
  if (m.direction !== 'in') throw conflict('NOT_INBOUND', 'Reply to a message that came in');
  const last = lastInboundAt(ownerId, m.phone);
  if (!last || last + REPLY_WINDOW_MS <= now()) throw conflict('WINDOW_CLOSED', 'WhatsApp allows a typed reply only within 24 hours of their last message. Ask them to send a message first, or call them.');
  const rowId = newId('wam');
  const pending = `pending:${rowId}`;
  try {
    run(`INSERT INTO wa_messages(id, wamid, owner_id, direction, phone, person_id, kind, body, raw, sent_at, received_at, state, client_key, created_by, context_wamid)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, rowId, pending, ownerId, 'out', m.phone, m.person_id, 'text', seal(text!), seal('{}'), now(), now(), 'sending', clientKey ?? null, u.id, m.wamid);
  } catch (e) {
    // the same key, sent twice at once: the first one is the reply
    const prior = clientKey ? one<MsgRow>('SELECT * FROM wa_messages WHERE owner_id = ? AND created_by = ? AND client_key = ?', ownerId, u.id, clientKey) : null;
    if (prior) return out(u, prior);
    throw e;
  }
  for (const l of liveLinks(m.id)) run('INSERT INTO wa_links(id, message_id, owner_id, kind, record_id, why, linked_by, linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', newId('wal'), rowId, ownerId, l.kind, l.record_id, 'A reply about this', u.id, now());
  let wamid: string | null = null; let error: string | null = null;
  try {
    const res = await f(`${cfg.whatsapp.apiUrl}/${encodeURIComponent(cfg.whatsapp.phoneId)}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${cfg.whatsapp.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.phone, type: 'text', context: { message_id: m.wamid }, text: { body: text, preview_url: false } }),
    });
    const t = await res.text();
    if (res.ok) { try { wamid = String(JSON.parse(t)?.messages?.[0]?.id ?? '') || null; } catch { /* no id */ } if (!wamid) error = 'WhatsApp accepted the reply but gave no message id'; }
    else error = `WhatsApp refused the reply (${res.status})`;
  } catch (e) { error = `Could not reach WhatsApp: ${(e as Error).message}`.slice(0, 200); }
  // an unknown outcome stays unknown: a timeout is shown as failed to send from here, and is never retried by itself
  // WhatsApp can report delivered, read or failed before its answer to the send reaches us; those statuses are already kept
  if (wamid) { run("UPDATE wa_messages SET wamid = ?, state = 'sent' WHERE id = ?", wamid, rowId); settleState(rowId, wamid, 'sent'); }
  else run("UPDATE wa_messages SET state = 'failed', media_error = ? WHERE id = ?", error, rowId);
  audit(actorOf(u), 'whatsapp.reply', 'whatsapp', rowId, { to: m.id, ok: !!wamid }, ownerId);
  if (!wamid) console.error(JSON.stringify({ level: 'error', where: 'whatsapp-reply', message: rowId, error }));
  return out(u, one<MsgRow>('SELECT * FROM wa_messages WHERE id = ?', rowId)!);
}

/** Delivery problems WhatsApp reported for anything this number sent (sign-in codes, alerts, waitlist offers, replies). Owner only. Numbers are masked. */
export function failedDeliveries(u: UserRow, ownerId: string): { items: { at: number; to: string | null; error: string | null; reply: boolean }[] } {
  if (!isBoss(u, ownerId)) throw forbidden('Only the owner sees delivery problems');
  const rows = many<{ wamid: string; phone: string | null; error: string | null; at: number }>("SELECT wamid, phone, error, at FROM wa_statuses WHERE status = 'failed' ORDER BY at DESC LIMIT 100");
  // a business sees the failures of its own replies, and the main business also sees the number's other sends
  const main = inboxBusiness() === ownerId;
  return { items: rows.map((r) => ({ r, own: one<{ owner_id: string }>("SELECT owner_id FROM wa_messages WHERE wamid = ? AND direction = 'out'", r.wamid) }))
    .filter((x) => (x.own ? x.own.owner_id === ownerId : main))
    .map((x) => ({ at: x.r.at, to: x.r.phone ? maskPhone(x.r.phone) : null, error: x.r.error, reply: !!x.own })) };
}

// ---- for Ask AI

/** What Ask AI may say about the inbox: counts, and the newest messages waiting, as the asker may see them. Message words are quoted as data. */
export function inboxForAsk(cfg: Config | undefined, u: UserRow, ownerId: string): { available: false; why: string } | { available: true; enabled: boolean; connected: boolean | null; waitingForReview: number; filed: number; filesFailed: number; sendsFailed: number; newestWaiting: { from: string; onTeam: boolean; kind: string; words: string | null; suggestion: string | null; receivedAt: number }[] } {
  let s: InboxStatus;
  try { s = inboxStatus(cfg, u, ownerId); } catch { return { available: false, why: 'The WhatsApp inbox needs the "manage_tasks" permission.' }; }
  const waiting = listMessages(u, ownerId, { state: 'review', limit: 5 }).items;
  return { available: true, enabled: s.enabled, connected: s.connected, waitingForReview: s.counts.review, filed: s.counts.filed, filesFailed: s.counts.mediaFailed, sendsFailed: s.counts.sendsFailed,
    newestWaiting: waiting.map((m) => ({ from: m.personName ?? m.profileName ?? m.from, onTeam: m.onTeam, kind: m.kind, words: m.text ? m.text.slice(0, 160) : null, suggestion: m.suggestion?.why ?? null, receivedAt: m.receivedAt })) };
}
