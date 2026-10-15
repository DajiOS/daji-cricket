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

export interface FeedProvider {
  id: 'yodlee' | 'demo';
  /** Transactions on or after `since` (YYYY-MM-DD) for the provider's own account id. */
  fetch(ownerId: string, providerRef: string, since: string): Promise<StatementRow[]>;
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

export const yodleeConfigured = (cfg: Config): boolean => !!(cfg.yodlee.apiUrl && cfg.yodlee.privateKeyPem && cfg.yodlee.issuer);
/** Each ground owner is one Yodlee user, named from the owner's id, so one owner's banks can never be read for another. */
export const yodleeLogin = (cfg: Config, ownerId: string): string => `${cfg.yodlee.adminLoginName || 'daji'}_${ownerId}`.slice(0, 60);

export function yodleeProvider(cfg: Config, f: Fetcher = fetch): FeedProvider {
  return {
    id: 'yodlee',
    async fetch(ownerId, ref, since) {
      const out: StatementRow[] = [];
      for (let skip = 0, line = 1; skip < 5000; skip += 500) {
        const url = `${cfg.yodlee.apiUrl}/transactions?accountId=${encodeURIComponent(ref)}&fromDate=${since}&top=500&skip=${skip}`;
        const res = await f(url, { headers: { 'Api-Version': '1.1', Authorization: `Bearer ${yodleeToken(cfg, yodleeLogin(cfg, ownerId))}`, ...(cfg.yodlee.clientId ? { 'Cobrand-Name': cfg.yodlee.clientId } : {}) } });
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

interface FeedAccount { id: string; name: string; providerRef: string | null; source: string; lastSyncAt: number | null; lastOk: boolean | null; lastMessage: string | null }

export function feedStatus(cfg: Config, ownerId: string): { provider: 'yodlee' | 'demo' | null; accounts: FeedAccount[] } {
  const rows = many<{ id: string; name: string; provider_ref: string | null; source: string; last_sync_at: number | null; last_ok: number | null; last_message: string | null }>(
    `SELECT a.id, a.name, a.provider_ref, a.source, s.last_sync_at, s.last_ok, s.last_message FROM acct_accounts a LEFT JOIN acct_feed_state s ON s.account_id = a.id
     WHERE a.owner_id = ? AND a.kind = 'bank' AND a.deleted_at IS NULL ORDER BY a.name`, ownerId);
  return { provider: providerFor(cfg)?.id ?? null, accounts: rows.map((r) => ({ id: r.id, name: r.name, providerRef: r.provider_ref, source: r.source, lastSyncAt: r.last_sync_at, lastOk: r.last_ok === null ? null : !!r.last_ok, lastMessage: r.last_message })) };
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
export async function syncAccount(cfg: Config, ownerId: string, actor: Actor, accountId: string, f: Fetcher = fetch): Promise<ImportResult & { fetched: number }> {
  const p = providerFor(cfg, f);
  if (!p) throw new HttpError(409, 'FEED_NOT_CONFIGURED', 'No bank feed is set up on this server yet.');
  const a = accountOr404(ownerId, accountId);
  const ref = one<{ r: string | null }>('SELECT provider_ref r FROM acct_accounts WHERE id = ?', a.id)?.r ?? null;
  if (!ref || !ref.startsWith(`${p.id}:`)) throw new HttpError(409, 'NOT_LINKED', 'Link this account to its bank first.');
  const last = one<{ d: string | null }>("SELECT MAX(txn_date) d FROM acct_transactions WHERE owner_id = ? AND account_id = ? AND source = 'upload'", ownerId, a.id)?.d;
  const since = last ? istDate(Date.parse(last + 'T00:00:00+05:30') - 7 * DAY) : istDate(now() - 90 * DAY); // a week of overlap catches late-posting items; duplicates are skipped
  const mark = (ok: boolean, msg: string) => run('INSERT INTO acct_feed_state(account_id, last_sync_at, last_ok, last_message) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_ok = excluded.last_ok, last_message = excluded.last_message', a.id, now(), ok ? 1 : 0, msg.slice(0, 300));
  try {
    const rows = await p.fetch(ownerId, ref.slice(p.id.length + 1), since);
    const buf = csv(rows);
    const dry = importStatement(ownerId, actor, a.id, `feed-${p.id}-${istDate(now())}.csv`, buf, true);
    const res = dry.rowsNew === 0 ? dry : importStatement(ownerId, actor, a.id, `feed-${p.id}-${istDate(now())}-${now()}.csv`, buf, false);
    mark(true, `${res.rowsNew} new, ${res.rowsDuplicate} already in the books`);
    return { ...res, fetched: rows.length };
  } catch (e) { mark(false, (e as Error).message); throw e; }
}

/** The daily sweep: every linked account once a day. A failure is recorded against the account and never stops the others. */
export async function runFeedSync(cfg: Config, onError: (e: unknown) => void = () => {}): Promise<number> {
  if (!providerFor(cfg)) return 0;
  const cutoff = now() - 20 * 60 * 60 * 1000;
  const due = many<{ id: string; owner_id: string }>(`SELECT a.id, a.owner_id FROM acct_accounts a LEFT JOIN acct_feed_state s ON s.account_id = a.id
    WHERE a.provider_ref IS NOT NULL AND a.deleted_at IS NULL AND (s.last_sync_at IS NULL OR s.last_sync_at < ?)`, cutoff);
  let n = 0;
  for (const d of due) { try { await syncAccount(cfg, d.owner_id, SYSTEM, d.id); n++; } catch (e) { onError(e); } }
  return n;
}
