import type { Config } from './config.ts';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { istDate, isValidDate } from './time.ts';
import { register } from './compliance.ts';

// Law and policy updates: news of a change in an Indian law, rate or rule that may touch one of the rules in the compliance
// register. They come from a feed (LAW_FEED_URL, Settings › Connections) read once a day, or are added by hand, for example
// from the CA's email. Each one waits in Compliance › Law updates until someone marks it reviewed or not relevant. Without a
// feed everything still works: updates are simply added by hand. Nothing here changes a limit or a rate by itself.

registerSchema('compliance-2', `
CREATE TABLE compliance_alerts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  published_on TEXT NOT NULL,
  codes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','not_relevant')),
  note TEXT,
  handled_by TEXT,
  handled_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_compliance_alerts_ext ON compliance_alerts(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_compliance_alerts_status ON compliance_alerts(status, published_on);
CREATE TABLE compliance_feed_runs (
  ran_on TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL,
  found INTEGER NOT NULL,
  added INTEGER NOT NULL,
  at INTEGER NOT NULL
);
`);

/** Words that tie a piece of news to a rule in the register. A feed item that matches none is left out (unless LAW_FEED_KEEP_ALL is on). */
const TOPICS: [string, RegExp][] = [
  ['CASH_269ST', /\b269\s?st\b|cash receipts?\b/i],
  ['CASH_40A3', /\b40a\s?\(?3\)?|rule 6dd|cash (payments?|expenditure)/i],
  ['CASH_269SS', /\b269\s?(ss|t)\b|cash (loans?|deposits?)/i],
  ['GST_INV_NO', /invoice numbers?|\brule 46\b/i],
  ['GST_SAC', /\bsac\b|gst rates?|rate notification|sports? (venues?|grounds?|facilit)/i],
  ['GST_RCM', /reverse charge/i],
  ['ESI', /\besic?\b|state insurance/i],
  ['PT_GUJARAT', /professions? tax|professional tax/i],
  ['TDS_SALARY', /\btds\b[^.]*\bsalar|\bsalar[^.]*\btds\b|section (192|392)\b|income.?tax slabs?|new (tax )?regime/i],
  ['DPDP', /\bdpdp\b|personal data|data protection/i],
  ['CERT_IN', /cert-?in\b|cyber (incidents?|security)/i],
  ['GST_REG', /gst registration|registration threshold|section 22\b/i],
  ['GST_EINV', /e-?invoic|\birn\b|invoice registration portal/i],
  ['GST_RETURNS', /\bgstr-?\s?(1|3b)\b|\bqrmp\b|gst returns?/i],
  ['TDS_194C', /\b194\s?[cj]\b|\btds\b[^.]*\b(contractors?|professionals?)/i],
  ['STAFF_TERMS', /contract act|electronic records?/i],
];

/** The rules in the register that a piece of text is about. */
export function rulesIn(text: string): string[] {
  return TOPICS.filter(([, re]) => re.test(text)).map(([code]) => code);
}

export interface FeedItem { id: string; title: string; summary: string; url: string; publishedOn: string; codes: string[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = (s: string, max: number): string => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim().slice(0, max);
const tag = (block: string, name: string): string => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '';
const dayOf = (v: string, today: string): string => {
  if (isValidDate(v)) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return today;
  const d = istDate(t);
  return d > today ? today : d;
};
const webUrl = (v: string): string => (/^https?:\/\/[^\s]+$/i.test(v) ? v.slice(0, 500) : '');

/** Reads an RSS 2.0, Atom or JSON feed. JSON is an array, or an object with `items`, of { id, title, summary, url, publishedOn, codes }. */
export function parseFeed(text: string, today: string): FeedItem[] {
  const out: FeedItem[] = [];
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    let j: unknown;
    try { j = JSON.parse(t); } catch { throw new Error('The feed is not valid JSON'); }
    const list = Array.isArray(j) ? j : Array.isArray((j as { items?: unknown })?.items) ? (j as { items: unknown[] }).items : null;
    if (!list) throw new Error('The JSON feed has no items list');
    for (const raw of list.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
      const title = clean(s('title'), 200);
      if (!title) continue;
      const url = webUrl(s('url') || s('link'));
      const codes = Array.isArray(r.codes) ? r.codes.filter((c): c is string => typeof c === 'string').map((c) => c.toUpperCase()) : [];
      out.push({ id: (s('id') || url || title).slice(0, 300), title, summary: clean(s('summary') || s('description'), 1000), url, publishedOn: dayOf(s('publishedOn') || s('date') || s('published'), today), codes });
    }
    return out;
  }
  if (!/<(rss|feed|rdf:RDF)\b/i.test(t)) throw new Error('The address did not return an RSS, Atom or JSON feed');
  const blocks = t.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks.slice(0, 200)) {
    const title = clean(tag(b, 'title'), 200);
    if (!title) continue;
    const url = webUrl(clean(tag(b, 'link'), 500) || (b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''));
    const id = clean(tag(b, 'guid') || tag(b, 'id'), 300) || url || title;
    const when = clean(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'), 60);
    out.push({ id, title, summary: clean(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'), 1000), url, publishedOn: dayOf(when, today), codes: [] });
  }
  return out;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const MAX_FEED_BYTES = 2_000_000;

/** Fetches and reads one feed address. Throws a plain-words reason when it cannot. */
export async function readFeed(cfg: Config, url: string, f: Fetch): Promise<FeedItem[]> {
  if (!/^https?:\/\//i.test(url)) throw new Error('The feed address must start with https://');
  const headers: Record<string, string> = { accept: 'application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5', 'user-agent': 'DajiCompliance/1' };
  if (cfg.lawFeed.token && /^https:\/\//i.test(url)) headers.authorization = `Bearer ${cfg.lawFeed.token}`;
  const r = await f(url, { method: 'GET', headers, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`The feed answered ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('The feed is larger than 2 MB');
  return parseFeed(text, istDate(now()));
}

const host = (u: string): string => { try { return new URL(u).host; } catch { return u.slice(0, 40); } };

export interface FeedRun { ranOn: string; ok: boolean; message: string; found: number; added: number; at: number }

/**
 * Reads the feeds once a day (the first scheduler tick of each India day), or now when `force` is set (the "Fetch now"
 * button). Each item is stored once, however many times the feed repeats it. A failure is written down and shown, never
 * counted as "nothing new".
 */
export async function syncLawFeed(cfg: Config, f: Fetch = fetch as unknown as Fetch, opts: { force?: boolean } = {}): Promise<FeedRun | null> {
  if (!cfg.lawFeed.urls.length) return null;
  const today = istDate(now());
  if (!opts.force && one('SELECT 1 FROM compliance_feed_runs WHERE ran_on = ?', today)) return null;
  const known = new Set(register().map((r) => r.code));
  let found = 0, added = 0;
  const problems: string[] = [];
  for (const url of cfg.lawFeed.urls) {
    let items: FeedItem[];
    try { items = await readFeed(cfg, url, f); } catch (e) { problems.push(`${host(url)}: ${String((e as Error)?.message ?? e).slice(0, 160)}`); continue; }
    for (const it of items) {
      const codes = [...new Set([...it.codes.filter((c) => known.has(c)), ...rulesIn(`${it.title} ${it.summary}`)])];
      if (!codes.length && !cfg.lawFeed.keepAll) continue;
      found++;
      const r = run(`INSERT INTO compliance_alerts(id, source, external_id, title, summary, url, published_on, codes, created_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source, external_id) WHERE external_id IS NOT NULL DO NOTHING`, newId('law'), 'feed', `${host(url)}|${it.id}`, it.title, it.summary || null, it.url || null, it.publishedOn, codes.join(','), now());
      added += r.changes;
    }
  }
  const ok = problems.length === 0;
  const message = ok ? (added ? `${added} new update${added === 1 ? '' : 's'}` : 'Read the feed; nothing new') : `Could not read ${problems.length} of ${cfg.lawFeed.urls.length} feed${cfg.lawFeed.urls.length === 1 ? '' : 's'}: ${problems.join('; ')}`.slice(0, 500);
  run('INSERT INTO compliance_feed_runs(ran_on, ok, message, found, added, at) VALUES(?,?,?,?,?,?) ON CONFLICT(ran_on) DO UPDATE SET ok = excluded.ok, message = excluded.message, found = excluded.found, added = compliance_feed_runs.added + excluded.added, at = excluded.at',
    today, ok ? 1 : 0, message, found, added, now());
  audit(SYSTEM, 'compliance.feed', 'compliance', today, { ok, found, added, failed: problems.length });
  return lastFeedRun();
}

export function lastFeedRun(): FeedRun | null {
  const r = one<{ ran_on: string; ok: number; message: string; found: number; added: number; at: number }>('SELECT * FROM compliance_feed_runs ORDER BY at DESC LIMIT 1');
  return r ? { ranOn: r.ran_on, ok: !!r.ok, message: r.message, found: r.found, added: r.added, at: r.at } : null;
}

export function feedStatus(cfg: Config): { connected: boolean; sources: string[]; lastRun: FeedRun | null } {
  return { connected: cfg.lawFeed.urls.length > 0, sources: cfg.lawFeed.urls.map(host), lastRun: lastFeedRun() };
}

export interface Alert { id: string; source: 'feed' | 'manual'; title: string; summary: string | null; url: string | null; publishedOn: string; codes: string[]; status: 'new' | 'reviewed' | 'not_relevant'; note: string | null; handledBy: string | null; handledAt: number | null; createdAt: number }
interface AlertRow { id: string; source: 'feed' | 'manual'; title: string; summary: string | null; url: string | null; published_on: string; codes: string; status: Alert['status']; note: string | null; handled_by: string | null; handled_at: number | null; created_at: number }
const toAlert = (r: AlertRow): Alert => ({ id: r.id, source: r.source, title: r.title, summary: r.summary, url: r.url, publishedOn: r.published_on, codes: r.codes ? r.codes.split(',') : [], status: r.status, note: r.note, handledBy: r.handled_by, handledAt: r.handled_at, createdAt: r.created_at });

/** Updates waiting for a look first, newest first; then the last ones handled. */
export function alerts(limit = 100): Alert[] {
  return many<AlertRow>("SELECT * FROM compliance_alerts ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, published_on DESC, created_at DESC LIMIT ?", limit).map(toAlert);
}
export const openAlertCount = (): number => one<{ n: number }>("SELECT COUNT(*) n FROM compliance_alerts WHERE status = 'new'")!.n;

/** Adds an update by hand, for example from the CA's email or a newspaper. The same title on the same day is refused, so a double click adds one. */
export function addAlert(actor: Actor, body: unknown): Alert {
  const v = new Validator(body);
  const title = v.str('title', { required: true, min: 5, max: 200 }), summary = v.str('summary', { max: 1000 }), url = v.str('url', { max: 500 });
  const publishedOn = v.date('publishedOn') ?? istDate(now());
  const raw = v.strArray('codes', { max: 20, itemMax: 40 });
  if (url && !webUrl(url)) v.fail('url', 'A web address starting with https://');
  if (publishedOn > istDate(now())) v.fail('publishedOn', 'Cannot be in the future');
  v.done();
  const known = new Set(register().map((r) => r.code));
  const picked = (raw ?? []).map((c) => c.toUpperCase());
  const unknown = picked.filter((c) => !known.has(c));
  if (unknown.length) throw new HttpError(400, 'VALIDATION_FAILED', 'No such rule in the register', { fields: [{ field: 'codes', message: `Unknown: ${unknown.join(', ')}` }] });
  const codes = [...new Set([...picked, ...rulesIn(`${title} ${summary ?? ''}`)])];
  if (one("SELECT 1 FROM compliance_alerts WHERE source = 'manual' AND title = ? AND published_on = ?", title!, publishedOn)) throw new HttpError(409, 'DUPLICATE', 'This update is already on the list');
  const id = newId('law');
  run('INSERT INTO compliance_alerts(id, source, title, summary, url, published_on, codes, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, 'manual', title!, summary ?? null, url ?? null, publishedOn, codes.join(','), actor.id, now());
  audit(actor, 'compliance.alert.add', 'compliance_alert', id, { title, codes });
  return toAlert(one<AlertRow>('SELECT * FROM compliance_alerts WHERE id = ?', id)!);
}

/** Marks an update reviewed or not relevant. Only a waiting one: if two people answer at once, the second is told it is done. */
export function handleAlert(actor: Actor, id: string, body: unknown): Alert {
  const v = new Validator(body);
  const status = v.str('status', { required: true }), note = v.str('note', { max: 300 });
  if (status && status !== 'reviewed' && status !== 'not_relevant') v.fail('status', 'reviewed or not_relevant');
  v.done();
  const cur = one<AlertRow>('SELECT * FROM compliance_alerts WHERE id = ?', id);
  if (!cur) throw notFound('No such update');
  const r = run("UPDATE compliance_alerts SET status = ?, note = ?, handled_by = ?, handled_at = ? WHERE id = ? AND status = 'new'", status!, note ?? null, actor.id, now(), id);
  if (!r.changes) throw new HttpError(409, 'ALREADY_HANDLED', 'Someone has already dealt with this update');
  audit(actor, 'compliance.alert.handle', 'compliance_alert', id, { status, note: note ?? null });
  return toAlert(one<AlertRow>('SELECT * FROM compliance_alerts WHERE id = ?', id)!);
}
