import { createSign } from 'node:crypto';
import { many, one, registerSchema, run } from '../db.ts';
import { now } from '../clock.ts';
import { audit, type Actor, SYSTEM } from '../audit.ts';
import { HttpError } from '../errors.ts';
import { Validator } from '../input.ts';
import { istDate, DAY } from '../time.ts';
import type { Config } from '../config.ts';
import { accountOr404 } from './store.ts';
import { importStatement, type ImportResult, type StatementRow } from './import.ts';

// A live bank feed. Whatever the source (Yodlee, or the built-in demo), a provider hands back rows in the same shape as a parsed
// statement; the rows are then loaded through the SAME import as an uploaded statement, so duplicates are skipped, rules categorise,
// signed-off months stay closed, UPI payments are matched, and an import can be undone.
//
// Not verified against a real Yodlee account (none was available): the request and response shapes follow Yodlee's published API
// and are exercised here only against a local stand-in server. Connecting the bank itself (Yodlee FastLink) is also not built:
// the bank is linked in Yodlee, then its account id is entered against the books account with POST /api/accounting/feed/link.

registerSchema('accounting-feed-1', `
CREATE TABLE acct_feed_state (
  account_id TEXT PRIMARY KEY REFERENCES acct_accounts(id),
  last_sync_at INTEGER,
  last_ok INTEGER,
  last_message TEXT
);
`);

registerSchema('accounting-feed-2', `
CREATE TABLE acct_feed_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ok INTEGER,
  fetched INTEGER NOT NULL DEFAULT 0,
  new_rows INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE INDEX ix_acct_feed_log_owner ON acct_feed_log(owner_id, started_at);
`);

registerSchema('accounting-feed-3', `
ALTER TABLE acct_feed_state ADD COLUMN bank_balance_paise INTEGER;
ALTER TABLE acct_feed_state ADD COLUMN bank_balance_at INTEGER;
`);

/** How long an account may go without a sync before the scheduler pulls it again (a webhook usually gets there first). */
export const FEED_SYNC_HOURS = 4;
const syncing = new Set<string>();

export interface FeedProvider {
  id: 'yodlee' | 'demo';
  /** Transactions on or after `since` (YYYY-MM-DD) for the provider's own account id. */
  fetch(ownerId: string, providerRef: string, since: string): Promise<StatementRow[]>;
  /** What the bank says the account's balance is now, in paise (positive for money held, as a card or loan owes it: the amount owed). */
  balance?(ownerId: string, providerRef: string): Promise<number | null>;
}

type Fetcher = typeof fetch;

// ------------------------------------------------------------------ Yodlee

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

/** A Yodlee user token: an RS512 JWT signed with your private key, valid for a few minutes. */
export function yodleeToken(cfg: Config, loginName: string, t = now()): string {
  const y = cfg.yodlee;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'RS512', ...(y.keyId ? { kid: y.keyId } : {}) }));
  const iat = Math.floor(t / 1000);
  const body = b64u(JSON.stringify({ iss: y.issuer, iat, exp: iat + 600, sub: loginName }));
  const sig = createSign('RSA-SHA512').update(`${head}.${body}`).sign(y.privateKeyPem);
  return `${head}.${body}.${b64u(sig)}`;
}

/** Yodlee is usable with either kind of key: client ID + secret (signs in at /auth/token), or an issuer + private key (we sign the token ourselves). */
export const yodleeConfigured = (cfg: Config): boolean => !!(cfg.yodlee.apiUrl && ((cfg.yodlee.clientId && cfg.yodlee.secret) || (cfg.yodlee.privateKeyPem && cfg.yodlee.issuer)));
/** Each ground owner is one Yodlee user, named from the owner's id, so one owner's banks can never be read for another. */
export const yodleeLogin = (cfg: Config, ownerId: string): string => cfg.yodlee.userLogin || `${cfg.yodlee.adminLoginName || 'daji'}_${ownerId}`.slice(0, 60);

// ---- signing in, and calling Yodlee: tokens are reused until two minutes before they expire, a 401 gets one fresh token, and a busy Yodlee is retried.
const tokens = new Map<string, { token: string; until: number }>();
export const clearYodleeTokens = (): void => { tokens.clear(); };
let retryDelays = [1000, 3000];
/** Tests shorten the waits. */
export const setYodleeRetryDelays = (d: number[]): void => { retryDelays = d; };

/** A token for one Yodlee login. Client-credentials keys ask Yodlee (POST /auth/token); private-key accounts sign it here. */
export async function userToken(cfg: Config, loginName: string, f: Fetcher = fetch): Promise<string> {
  const y = cfg.yodlee;
  if (!y.secret || !y.clientId) return yodleeToken(cfg, loginName);
  const key = `${y.apiUrl}|${y.clientId}|${loginName}`, hit = tokens.get(key);
  if (hit && hit.until - 120_000 > now()) return hit.token;
  const res = await f(`${y.apiUrl}/auth/token`, { method: 'POST', headers: { 'Api-Version': '1.1', loginName, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ clientId: y.clientId, secret: y.secret }).toString(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    let d = ''; try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; d = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ }
    throw new HttpError(502, 'FEED_AUTH', `Yodlee did not accept the client ID and secret (${res.status}${d ? ': ' + d : ''}). Check them in Admin, Yodlee.`);
  }
  const j = await res.json() as { token?: { accessToken?: string; expiresIn?: number } };
  const t = j.token?.accessToken; if (!t) throw new HttpError(502, 'FEED_AUTH', 'Yodlee signed in but sent no token.');
  tokens.set(key, { token: t, until: now() + (Number(j.token?.expiresIn) > 0 ? Number(j.token!.expiresIn) : 1800) * 1000 });
  return t;
}

/** One call to Yodlee as `loginName`. Retries 429/502/503/504 after 1 s and 3 s, and a 401 once with a fresh token. */
export async function yFetch(cfg: Config, loginName: string, path: string, init: RequestInit = {}, f: Fetcher = fetch): Promise<Response> {
  const y = cfg.yodlee; let renewed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await userToken(cfg, loginName, f);
    const res = await f(`${y.apiUrl}${path}`, { ...init, headers: { 'Api-Version': '1.1', Authorization: `Bearer ${token}`, Accept: 'application/json', ...(!y.secret && y.clientId ? { 'Cobrand-Name': y.clientId } : {}), ...(init.headers as Record<string, string> | undefined) }, signal: init.signal ?? AbortSignal.timeout(30_000) });
    if (res.status === 401 && !renewed && y.secret) { renewed = true; tokens.delete(`${y.apiUrl}|${y.clientId}|${loginName}`); continue; }
    if ([429, 502, 503, 504].includes(res.status) && attempt < retryDelays.length) { await new Promise((r) => setTimeout(r, retryDelays[attempt])); continue; }
    return res;
  }
}

export function yodleeProvider(cfg: Config, f: Fetcher = fetch): FeedProvider {
  return {
    id: 'yodlee',
    async balance(ownerId, ref) {
      const res = await yFetch(cfg, yodleeLogin(cfg, ownerId), `/accounts/${encodeURIComponent(ref)}`, {}, f);
      if (!res.ok) return null;
      const a = ((await res.json()) as { account?: { currentBalance?: { amount?: number }; balance?: { amount?: number } }[] }).account?.[0];
      const v = a?.currentBalance?.amount ?? a?.balance?.amount;
      return typeof v === 'number' ? Math.round(v * 100) : null;
    },
    async fetch(ownerId, ref, since) {
      const out: StatementRow[] = [];
      for (let skip = 0, line = 1; skip < 5000; skip += 500) {
        const res = await yFetch(cfg, yodleeLogin(cfg, ownerId), `/transactions?accountId=${encodeURIComponent(ref)}&fromDate=${since}&top=500&skip=${skip}`, {}, f);
        if (!res.ok) throw new HttpError(502, 'FEED_ERROR', `The bank feed answered ${res.status}. Try again later.`);
        const data = await res.json() as { transaction?: YodleeTxn[] };
        const page = data.transaction ?? [];
        for (const t of page) {
          if (t.status === 'PENDING') continue; // pending items change or vanish; only posted ones are books-worthy
          const amount = Math.round(Number(t.amount?.amount) * 100);
          const date = String(t.transactionDate ?? t.date ?? '').slice(0, 10);
          if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          out.push({ date, amountPaise: t.baseType === 'DEBIT' ? -Math.abs(amount) : Math.abs(amount), balancePaise: t.runningBalance?.amount !== undefined ? Math.round(Number(t.runningBalance.amount) * 100) : null,
            description: String(t.description?.original ?? t.description?.simple ?? 'Bank transaction').slice(0, 300), reference: t.id !== undefined ? String(t.id) : null, line: line++ });
        }
        if (page.length < 500) break;
      }
      return out;
    },
  };
}
interface YodleeTxn { id?: number | string; status?: string; baseType?: 'CREDIT' | 'DEBIT'; amount?: { amount: number }; runningBalance?: { amount: number }; date?: string; transactionDate?: string; description?: { original?: string; simple?: string } }

// ------------------------------------------------------------------ demo

/** A small, repeatable set of transactions for the demo server, so the feed screens can be tried without a bank. */
export function demoProvider(): FeedProvider {
  return {
    id: 'demo',
    async fetch(_ownerId, _ref, since) {
      const today = istDate(now());
      const rows: StatementRow[] = [];
      for (let i = 1; i <= 6; i++) {
        const date = istDate(now() - i * 2 * DAY);
        if (date < since) continue;
        rows.push({ date, amountPaise: i % 2 ? 180000 + i * 10000 : -(45000 + i * 5000), balancePaise: null, description: i % 2 ? `UPI/${400000000000 + i}/BOOKING/daji` : `NEFT/ELECTRICITY BILL/${today}`, reference: `demo-${date}-${i}`, line: i });
      }
      return rows;
    },
  };
}

export function providerFor(cfg: Config, f: Fetcher = fetch): FeedProvider | null {
  if (yodleeConfigured(cfg)) return yodleeProvider(cfg, f);
  return cfg.demoMode ? demoProvider() : null;
}

// ------------------------------------------------------------------ linking and syncing

interface FeedAccount { id: string; name: string; holds: string; providerRef: string | null; source: string; lastSyncAt: number | null; lastOk: boolean | null; lastMessage: string | null; bankBalancePaise: number | null; bankBalanceAt: number | null; bookBalancePaise: number }

export function feedStatus(cfg: Config, ownerId: string): { provider: 'yodlee' | 'demo' | null; accounts: FeedAccount[] } {
  const rows = many<{ id: string; name: string; holds: string; provider_ref: string | null; source: string; last_sync_at: number | null; last_ok: number | null; last_message: string | null; bb: number | null; bba: number | null; book: number }>(
    `SELECT a.id, a.name, a.holds, a.provider_ref, a.source, s.last_sync_at, s.last_ok, s.last_message, s.bank_balance_paise bb, s.bank_balance_at bba,
       a.opening_paise + (SELECT COALESCE(SUM(t.amount_paise), 0) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL) book
     FROM acct_accounts a LEFT JOIN acct_feed_state s ON s.account_id = a.id
     WHERE a.owner_id = ? AND a.kind = 'bank' AND a.deleted_at IS NULL ORDER BY a.name`, ownerId);
  return { provider: providerFor(cfg)?.id ?? null, accounts: rows.map((r) => ({ id: r.id, name: r.name, holds: r.holds, providerRef: r.provider_ref, source: r.source, lastSyncAt: r.last_sync_at, lastOk: r.last_ok === null ? null : !!r.last_ok, lastMessage: r.last_message, bankBalancePaise: r.bb, bankBalanceAt: r.bba, bookBalancePaise: r.book })) };
}

export function linkAccount(cfg: Config, ownerId: string, actor: Actor, body: unknown): FeedAccount {
  const p = providerFor(cfg);
  if (!p) throw new HttpError(409, 'FEED_NOT_CONFIGURED', 'No bank feed is set up on this server yet.');
  const v = new Validator(body);
  const accountId = v.str('accountId', { required: true, max: 60 });
  const ref = v.str('providerRef', { max: 80 });
  v.done();
  const a = accountOr404(ownerId, accountId!);
  if (a.kind !== 'bank') throw new HttpError(400, 'NOT_A_BANK', 'Only bank accounts can have a feed.');
  if (ref) {
    if (one('SELECT 1 x FROM acct_accounts WHERE owner_id = ? AND provider_ref = ? AND id <> ? AND deleted_at IS NULL', ownerId, `${p.id}:${ref}`, a.id)) throw new HttpError(409, 'ALREADY_LINKED', 'That bank account is already linked to another account in the books.');
    run('UPDATE acct_accounts SET provider_ref = ?, source = ?, updated_at = ?, updated_by = ? WHERE id = ?', `${p.id}:${ref}`, p.id, now(), actor.id, a.id);
  } else run("UPDATE acct_accounts SET provider_ref = NULL, source = 'upload', updated_at = ?, updated_by = ? WHERE id = ?", now(), actor.id, a.id);
  audit(actor, ref ? 'feed.link' : 'feed.unlink', 'acct_account', a.id, { provider: p.id }, ownerId);
  return feedStatus(cfg, ownerId).accounts.find((x) => x.id === a.id)!;
}

// This CSV is read straight back by the importer, not opened in a spreadsheet, so values are quoted but not "defused" (that would put a stray ' in front of a minus sign).
const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: StatementRow[]): Buffer => Buffer.from(['Date,Description,Reference,Amount,Balance', ...rows.map((r) => [r.date, r.description, r.reference ?? '', (r.amountPaise / 100).toFixed(2), r.balancePaise === null ? '' : (r.balancePaise / 100).toFixed(2)].map(cell).join(','))].join('\r\n') + '\r\n');

/** Pulls the latest transactions for one linked account and loads them through the normal import. */
export async function syncAccount(cfg: Config, ownerId: string, actor: Actor, accountId: string, f: Fetcher = fetch, trigger: 'manual' | 'schedule' | 'webhook' = 'manual'): Promise<ImportResult & { fetched: number; adopted: number }> {
  const p = providerFor(cfg, f);
  if (!p) throw new HttpError(409, 'FEED_NOT_CONFIGURED', 'No bank feed is set up on this server yet.');
  const a = accountOr404(ownerId, accountId);
  const holds = one<{ h: string }>('SELECT holds h FROM acct_accounts WHERE id = ?', a.id)?.h ?? 'bank';
  const ref = one<{ r: string | null }>('SELECT provider_ref r FROM acct_accounts WHERE id = ?', a.id)?.r ?? null;
  if (!ref || !ref.startsWith(`${p.id}:`)) throw new HttpError(409, 'NOT_LINKED', 'Link this account to its bank first.');
  const last = one<{ d: string | null }>("SELECT MAX(txn_date) d FROM acct_transactions WHERE owner_id = ? AND account_id = ? AND source = 'upload'", ownerId, a.id)?.d;
  const since = last ? istDate(Date.parse(last + 'T00:00:00+05:30') - 7 * DAY) : istDate(now() - (p.id === 'yodlee' ? 180 : 90) * DAY); // a week of overlap catches late-posting items; duplicates are skipped
  const mark = (ok: boolean, msg: string) => run('INSERT INTO acct_feed_state(account_id, last_sync_at, last_ok, last_message) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_ok = excluded.last_ok, last_message = excluded.last_message', a.id, now(), ok ? 1 : 0, msg.slice(0, 300));
  if (syncing.has(a.id)) throw new HttpError(409, 'SYNC_RUNNING', 'This account is already being synced. Try again in a minute.');
  syncing.add(a.id);
  run('INSERT INTO acct_feed_log(owner_id, account_id, trigger, started_at) VALUES(?,?,?,?)', ownerId, a.id, trigger, now());
  const logId = one<{ m: number }>('SELECT MAX(id) m FROM acct_feed_log WHERE account_id = ?', a.id)!.m;
  const finish = (ok: boolean, o: { fetched?: number; rowsNew?: number; rowsDuplicate?: number; matched?: number }, msg: string) => run('UPDATE acct_feed_log SET finished_at = ?, ok = ?, fetched = ?, new_rows = ?, duplicates = ?, matched = ?, message = ? WHERE id = ?', now(), ok ? 1 : 0, o.fetched ?? 0, o.rowsNew ?? 0, o.rowsDuplicate ?? 0, o.matched ?? 0, msg.slice(0, 300), logId);
  try {
    const rows = await p.fetch(ownerId, ref.slice(p.id.length + 1), since);
    // A line the bank sent before is never added twice. A line that was uploaded from a statement earlier (same amount, within a day, no bank id yet) takes the bank's id instead of being doubled.
    let adopted = 0; const fresh: StatementRow[] = [];
    for (const r of rows) {
      if (p.id !== 'yodlee' || !r.reference) { fresh.push(r); continue; }
      if (one('SELECT 1 FROM acct_transactions WHERE account_id = ? AND (ext_id = ? OR reference = ?)', a.id, r.reference, r.reference)) continue;
      const m = one<{ id: string }>(`SELECT id FROM acct_transactions WHERE account_id = ? AND ext_id IS NULL AND deleted_at IS NULL AND amount_paise = ? AND ABS(julianday(txn_date) - julianday(?)) <= 1
        ORDER BY ABS(julianday(txn_date) - julianday(?)), seq LIMIT 1`, a.id, r.amountPaise, r.date, r.date);
      if (m) { run('UPDATE acct_transactions SET ext_id = ? WHERE id = ?', r.reference, m.id); adopted++; continue; }
      fresh.push(r);
    }
    const buf = csv(fresh);
    const none = { importId: null, dryRun: false, filename: '', rowsTotal: 0, rowsNew: 0, rowsDuplicate: 0, rowsSkipped: 0, periodFrom: null, periodTo: null, categorisedByRules: 0, warnings: [], skipped: [], columns: {}, sample: [], lockedMonthRows: 0, reviewRequired: false, preview: [] } as unknown as ImportResult; // nothing new to load
    const dry = fresh.length === 0 ? none : importStatement(ownerId, actor, a.id, `feed-${p.id}-${istDate(now())}.csv`, buf, true);
    const res = dry.rowsNew === 0 ? dry : importStatement(ownerId, actor, a.id, `feed-${p.id}-${istDate(now())}-${now()}.csv`, buf, false);
    if (p.id === 'yodlee' && res.importId) run('UPDATE acct_transactions SET ext_id = reference WHERE import_id = ? AND ext_id IS NULL AND reference IS NOT NULL', res.importId);
    const msg = `${res.rowsNew} new, ${rows.length - fresh.length - adopted + res.rowsDuplicate} already in the books${adopted ? `, ${adopted} matched to statement lines` : ''}`;
    mark(true, msg);
    try { // the bank's own balance, to show beside the books' balance; a failure here never fails the sync
      const b = await p.balance?.(ownerId, ref.slice(p.id.length + 1));
      if (b !== null && b !== undefined) run('UPDATE acct_feed_state SET bank_balance_paise = ?, bank_balance_at = ? WHERE account_id = ?', holds === 'bank' ? b : -Math.abs(b), now(), a.id);
    } catch { /* optional */ }
    finish(true, { fetched: rows.length, rowsNew: res.rowsNew, rowsDuplicate: rows.length - fresh.length - adopted + res.rowsDuplicate, matched: res.categorisedByRules }, msg);
    return { ...res, fetched: rows.length, adopted };
  } catch (e) { mark(false, (e as Error).message); finish(false, {}, (e as Error).message); throw e; }
  finally { syncing.delete(a.id); }
}

/** The scheduled sweep: every linked account that has not synced for four hours. A failure is recorded against the account and never stops the others. */
export async function runFeedSync(cfg: Config, onError: (e: unknown) => void = () => {}): Promise<number> {
  if (!providerFor(cfg)) return 0;
  const cutoff = now() - FEED_SYNC_HOURS * 60 * 60 * 1000;
  const due = many<{ id: string; owner_id: string }>(`SELECT a.id, a.owner_id FROM acct_accounts a LEFT JOIN acct_feed_state s ON s.account_id = a.id
    WHERE a.provider_ref IS NOT NULL AND a.deleted_at IS NULL AND a.active = 1 AND (s.last_sync_at IS NULL OR s.last_sync_at < ?)`, cutoff);
  let n = 0;
  for (const d of due) { try { await syncAccount(cfg, d.owner_id, SYSTEM, d.id, fetch, 'schedule'); n++; } catch (e) { if ((e as { code?: string }).code !== 'SYNC_RUNNING') onError(e); } }
  return n;
}

export interface FeedLogOut { id: number; accountId: string; accountName: string; trigger: string; startedAt: number; finishedAt: number | null; ok: boolean | null; fetched: number; newRows: number; duplicates: number; matched: number; message: string | null }
/** The latest syncs for one owner, newest first. */
export function feedLog(ownerId: string, limit = 50): FeedLogOut[] {
  return many<{ id: number; account_id: string; name: string; trigger: string; started_at: number; finished_at: number | null; ok: number | null; fetched: number; new_rows: number; duplicates: number; matched: number; message: string | null }>(
    `SELECT l.*, a.name FROM acct_feed_log l JOIN acct_accounts a ON a.id = l.account_id WHERE l.owner_id = ? ORDER BY l.id DESC LIMIT ?`, ownerId, Math.min(Math.max(limit, 1), 200))
    .map((r) => ({ id: r.id, accountId: r.account_id, accountName: r.name, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === null ? null : !!r.ok, fetched: r.fetched, newRows: r.new_rows, duplicates: r.duplicates, matched: r.matched, message: r.message }));
}
