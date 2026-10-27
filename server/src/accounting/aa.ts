import { createHmac, timingSafeEqual } from 'node:crypto';
import { many, one, registerSchema, run } from '../db.ts';
import { now } from '../clock.ts';
import { audit, SYSTEM, type Actor } from '../audit.ts';
import { seal, unseal, vaultOn } from '../vault.ts';
import { HttpError } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator, normalizePhone } from '../input.ts';
import { istDate } from '../time.ts';
import type { Config } from '../config.ts';
import type { StatementRow } from './import.ts';
import { ingestFeedRows } from './feed.ts';
import { accountOr404 } from './store.ts';

// Account Aggregator (AA): the RBI-regulated way to read a bank account with the account holder's consent. The owner enters the mobile number linked to the
// bank, the AA gateway (Setu, Finvu) sends them to approve on its own page, and once approved the transactions arrive and go through the same import as every other
// bank feed (never twice, statement lines adopted). Nothing here reads a bank password: the consent and the data both travel through the gateway.
//
// Setu follows its published v2 API. Finvu is wired in behind the same interface but is not built: its API document has not been published to us, so it refuses with
// a clear message instead of guessing. Neither has been run against a real account (no credentials were available); the tests use stand-in servers.

registerSchema('aa-1', `
CREATE TABLE aa_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE aa_consents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('setu','finvu')),
  consent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  mobile TEXT NOT NULL,
  data_from TEXT NOT NULL,
  data_to TEXT NOT NULL,
  session_id TEXT,
  session_status TEXT,
  last_fetch_at INTEGER,
  last_message TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_aa_consents ON aa_consents(provider, consent_id);
CREATE INDEX ix_aa_consents_owner ON aa_consents(owner_id);
CREATE TABLE aa_accounts (
  id TEXT PRIMARY KEY,
  consent_row TEXT NOT NULL REFERENCES aa_consents(id),
  owner_id TEXT NOT NULL,
  link_ref TEXT NOT NULL,
  masked TEXT,
  last4 TEXT,
  fip_id TEXT,
  account_id TEXT,
  balance_paise INTEGER,
  balance_at INTEGER,
  UNIQUE (consent_row, link_ref)
);
CREATE TABLE aa_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  type TEXT,
  consent_id TEXT,
  ok INTEGER NOT NULL,
  note TEXT
);
`);

type Fetcher = typeof fetch;
export type AaProvider = 'setu' | 'finvu';
const PROVIDERS: readonly AaProvider[] = ['setu', 'finvu'];

// ------------------------------------------------------------------ settings (kept encrypted when FIELD_KEY is set; secrets never go back to the browser)

const TEXT_KEYS = ['setu.baseUrl', 'setu.clientId', 'setu.productInstanceId', 'setu.authUrl', 'finvu.baseUrl', 'finvu.clientId'] as const;
const SECRET_KEYS = ['setu.clientSecret', 'finvu.clientSecret', 'webhookSecret'] as const;

function stored(): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of many<{ name: string; value: string }>('SELECT name, value FROM aa_settings')) { try { m.set(r.name, unseal(r.value)); } catch { /* unreadable counts as not set */ } }
  return m;
}
const SETU_SANDBOX = 'https://fiu-sandbox.setu.co';

export interface AaSettingsView { text: Record<string, string>; secretsSet: Record<string, boolean>; encrypted: boolean; setuReady: boolean; finvuReady: boolean; webhookUrl: string | null }
export function viewAaSettings(cfg: Config): AaSettingsView {
  const s = stored();
  const text: Record<string, string> = {}; for (const k of TEXT_KEYS) text[k] = s.get(k) ?? '';
  const secretsSet: Record<string, boolean> = {}; for (const k of SECRET_KEYS) secretsSet[k] = s.has(k);
  const hook = s.get('webhookSecret');
  return { text, secretsSet, encrypted: vaultOn(), setuReady: !!(s.get('setu.clientId') && s.get('setu.clientSecret') && s.get('setu.productInstanceId')), finvuReady: !!(s.get('finvu.baseUrl') && s.get('finvu.clientId') && s.get('finvu.clientSecret')),
    webhookUrl: hook ? `${cfg.publicUrl.replace(/\/+$/, '')}/api/webhooks/aa/setu?token=${encodeURIComponent(hook)}` : null };
}

export function saveAaSettings(cfg: Config, actor: Actor, body: unknown): AaSettingsView {
  const v = new Validator(body); const b = (body ?? {}) as Record<string, unknown>;
  const set = new Map<string, string>(); const del = new Set<string>();
  for (const k of TEXT_KEYS) {
    if (b[k] === '') { del.add(k); continue; }
    const x = v.str(k, { max: 300 }); if (x === undefined) continue;
    if (/\.(baseUrl|authUrl)$/.test(k) && !/^https:\/\/[\w.-]+(:\d+)?(\/[\w./%-]*)?$/i.test(x)) throw new HttpError(400, 'VALIDATION', 'Web addresses must start with https://');
    set.set(k, /\.baseUrl$/.test(k) ? x.replace(/\/+$/, '') : x);
  }
  for (const k of SECRET_KEYS) { const x = v.str(k, { max: 500 }); if (x) set.set(k, x); }
  if (b.generateWebhookSecret === true) set.set('webhookSecret', newId('aah').slice(4) + newId('aah').slice(4));
  const clear = Array.isArray(b.clear) ? (b.clear as unknown[]).filter((x): x is string => typeof x === 'string' && SECRET_KEYS.includes(x as never)) : [];
  v.done();
  const t = now();
  for (const [k, val] of set) run('INSERT INTO aa_settings(name, value, updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', k, seal(val), t);
  for (const k of [...del, ...clear]) run('DELETE FROM aa_settings WHERE name = ?', k);
  audit(actor, 'aa.settings', 'aa_settings', null, { changed: [...set.keys(), ...del, ...clear.map((c) => '-' + c)] });
  return viewAaSettings(cfg);
}

// ------------------------------------------------------------------ what a gateway gives back, in one shape

export interface AaAccountData { linkRef: string; masked: string | null; fipId: string | null; status: string | null; balancePaise: number | null; rows: StatementRow[] }
export interface AaConsentInfo { consentId: string; url: string | null; status: string }
export interface AaSessionInfo { status: string; accounts: AaAccountData[] }
export interface AaAdapter {
  id: AaProvider;
  createConsent(a: { mobile: string; from: string; to: string; months: number; tag: string }): Promise<AaConsentInfo>;
  getConsent(consentId: string): Promise<{ status: string }>;
  createSession(consentId: string, from: string, to: string): Promise<{ sessionId: string }>;
  getSession(sessionId: string): Promise<AaSessionInfo>;
}

/** "1234.50" to 123450 paise, without floating point. Accepts numbers too. Returns null for anything that is not a plain amount. */
export function paise(x: unknown): number | null {
  const t = (typeof x === 'number' ? (Number.isFinite(x) ? String(x) : '') : typeof x === 'string' ? x : '').trim().replace(/,/g, '');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(t); if (!m) return null;
  const frac = (m[3] ?? '').padEnd(2, '0'); const r = Math.round(Number(`${m[2]}${frac.slice(0, 2)}.${frac.slice(2) || '0'}`));
  return m[1] ? -r : r;
}

/** The transactions of one deposit account in the AA (ReBIT) deposit format, as statement rows. Lines without a valid date or amount are left out. */
export function depositRows(account: unknown): StatementRow[] {
  const a = account as { data?: { account?: { transactions?: { transaction?: unknown } } }; transactions?: { transaction?: unknown } } | null;
  const list = (a?.data?.account?.transactions?.transaction ?? a?.transactions?.transaction) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(list)) return [];
  const rows: StatementRow[] = [];
  list.forEach((t, i) => {
    const amt = paise(t.amount); const type = String(t.type ?? '').toUpperCase();
    if (amt === null || amt === 0 || (type !== 'CREDIT' && type !== 'DEBIT')) return;
    const ts = typeof t.transactionTimestamp === 'string' ? Date.parse(t.transactionTimestamp) : NaN;
    const date = Number.isFinite(ts) ? istDate(ts) : /^\d{4}-\d{2}-\d{2}/.test(String(t.valueDate ?? '')) ? String(t.valueDate).slice(0, 10) : null;
    if (!date) return;
    const id = String(t.txnId ?? '').trim();
    const text = [String(t.narration ?? '').trim(), t.mode ? `(${String(t.mode)})` : ''].filter(Boolean).join(' ') || 'Bank transaction';
    rows.push({ date, amountPaise: type === 'CREDIT' ? Math.abs(amt) : -Math.abs(amt), balancePaise: paise(t.currentBalance), description: text.slice(0, 300), reference: id ? `aa:${id}`.slice(0, 80) : null, line: i + 1 });
  });
  return rows;
}

// ------------------------------------------------------------------ Setu (API v2)

async function setuError(res: Response, what: string): Promise<HttpError> {
  let detail = ''; try { const j = await res.json() as { errorMsg?: string; errorCode?: string; message?: string }; detail = j.errorMsg || j.message || j.errorCode || ''; } catch { /* not JSON */ }
  return new HttpError(502, 'AA_ERROR', `Setu could not ${what} (${res.status}${detail ? ': ' + detail : ''}).`);
}

export function setuAdapter(f: Fetcher = fetch): AaAdapter {
  const s = stored();
  const base = (s.get('setu.baseUrl') || SETU_SANDBOX).replace(/\/+$/, '');
  const id = s.get('setu.clientId'), secret = s.get('setu.clientSecret'), product = s.get('setu.productInstanceId'), authUrl = s.get('setu.authUrl');
  if (!id || !secret || !product) throw new HttpError(409, 'AA_NOT_CONFIGURED', 'Setu is not set up on this server yet. The software owner adds its keys under Platform.');
  let token: { v: string; exp: number } | null = null;
  // Setu's page says "Bearer token" in one place and client id/secret headers in another. If a login address is saved a token is fetched from it; otherwise the headers are sent.
  const headers = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = { 'x-product-instance-id': product, 'Content-Type': 'application/json' };
    if (!authUrl) { h['x-client-id'] = id; h['x-client-secret'] = secret; return h; }
    if (!token || token.exp < Date.now()) {
      const r = await f(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientID: id, secret }), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw await setuError(r, 'sign in');
      const j = await r.json() as { data?: { token?: string }; access_token?: string; token?: string };
      const tk = j.data?.token ?? j.access_token ?? j.token; if (!tk) throw new HttpError(502, 'AA_ERROR', 'Setu sign-in did not return a token.');
      token = { v: tk, exp: Date.now() + 25 * 60_000 };
    }
    h.Authorization = `Bearer ${token.v}`; return h;
  };
  const call = async (method: string, path: string, body?: unknown, what = 'answer'): Promise<any> => {
    let res: Response;
    try { res = await f(`${base}/v2${path}`, { method, headers: await headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) }); }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'AA_ERROR', `Setu did not answer (${(e as Error).message}).`); }
    if (!res.ok) throw await setuError(res, what);
    return res.json();
  };
  return {
    id: 'setu',
    async createConsent(a) {
      const j = await call('POST', '/consents', { consentDuration: { unit: 'MONTH', value: String(a.months) }, vua: a.mobile, dataRange: { from: `${a.from}T00:00:00Z`, to: `${a.to}T23:59:59Z` }, context: [], additionalParams: { tags: ['daji', a.tag] } }, 'create the consent');
      if (!j?.id) throw new HttpError(502, 'AA_ERROR', 'Setu did not return a consent id.');
      return { consentId: String(j.id), url: typeof j.url === 'string' ? j.url : null, status: String(j.status ?? 'PENDING').toUpperCase() };
    },
    async getConsent(consentId) { const j = await call('GET', `/consents/${encodeURIComponent(consentId)}`, undefined, 'read the consent'); return { status: String(j?.status ?? '').toUpperCase() }; },
    async createSession(consentId, from, to) {
      const j = await call('POST', '/sessions', { consentId, dataRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` }, format: 'json' }, 'ask for the data');
      if (!j?.id) throw new HttpError(502, 'AA_ERROR', 'Setu did not return a data session id.');
      return { sessionId: String(j.id) };
    },
    async getSession(sessionId) {
      const j = await call('GET', `/sessions/${encodeURIComponent(sessionId)}`, undefined, 'read the data');
      const accounts: AaAccountData[] = [];
      for (const fip of Array.isArray(j?.fips) ? j.fips : []) for (const ac of Array.isArray(fip?.accounts) ? fip.accounts : []) {
        if (!ac?.linkRefNumber) continue;
        const sum = ac?.data?.account?.summary;
        accounts.push({ linkRef: String(ac.linkRefNumber), masked: typeof ac.maskedAccNumber === 'string' ? ac.maskedAccNumber : null, fipId: typeof fip.fipID === 'string' ? fip.fipID : null,
          status: typeof ac.FIStatus === 'string' ? ac.FIStatus : typeof ac.status === 'string' ? ac.status : null, balancePaise: paise(sum?.currentBalance), rows: depositRows(ac) });
      }
      return { status: String(j?.status ?? '').toUpperCase(), accounts };
    },
  };
}

// ------------------------------------------------------------------ Finvu (not built: needs Finvu's FIU API document and credentials)

export function finvuAdapter(): AaAdapter {
  const no = (): never => { throw new HttpError(501, 'AA_NOT_BUILT', 'Finvu is not connected yet. Its integration needs Finvu\'s FIU API document, UAT credentials and signing keys, which have not been provided. Setu works today.'); };
  return { id: 'finvu', createConsent: no, getConsent: no, createSession: no, getSession: no };
}

export function adapterFor(provider: AaProvider, f: Fetcher = fetch): AaAdapter { return provider === 'setu' ? setuAdapter(f) : finvuAdapter(); }

// ------------------------------------------------------------------ consents

export interface ConsentOut { id: string; provider: AaProvider; status: string; url: string | null; mobile: string; dataFrom: string; dataTo: string; sessionStatus: string | null; lastFetchAt: number | null; lastMessage: string | null; createdAt: number; accounts: { id: string; masked: string | null; last4: string | null; fipId: string | null; accountId: string | null; accountName: string | null; balancePaise: number | null; balanceAt: number | null }[] }
interface CRow { id: string; provider: AaProvider; consent_id: string; status: string; url: string | null; mobile: string; data_from: string; data_to: string; session_id: string | null; session_status: string | null; last_fetch_at: number | null; last_message: string | null; created_at: number; owner_id: string }

const maskPhone = (m: string): string => m.slice(0, 2) + '••••••' + m.slice(-2);

export function listConsents(ownerId: string): ConsentOut[] {
  const rows = many<CRow>('SELECT * FROM aa_consents WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100', ownerId);
  return rows.map((r) => ({ id: r.id, provider: r.provider, status: r.status, url: r.status === 'PENDING' ? r.url : null, mobile: maskPhone(r.mobile), dataFrom: r.data_from, dataTo: r.data_to, sessionStatus: r.session_status, lastFetchAt: r.last_fetch_at, lastMessage: r.last_message, createdAt: r.created_at,
    accounts: many<{ id: string; masked: string | null; last4: string | null; fip_id: string | null; account_id: string | null; name: string | null; balance_paise: number | null; balance_at: number | null }>(
      'SELECT x.id, x.masked, x.last4, x.fip_id, x.account_id, a.name, x.balance_paise, x.balance_at FROM aa_accounts x LEFT JOIN acct_accounts a ON a.id = x.account_id WHERE x.consent_row = ? ORDER BY x.masked', r.id)
      .map((x) => ({ id: x.id, masked: x.masked, last4: x.last4, fipId: x.fip_id, accountId: x.account_id, accountName: x.name, balancePaise: x.balance_paise, balanceAt: x.balance_at })) }));
}

export async function createConsent(cfg: Config, ownerId: string, actor: Actor, body: unknown, f: Fetcher = fetch): Promise<ConsentOut> {
  const v = new Validator(body);
  const provider = v.str('provider', { required: true, max: 10 }) as AaProvider;
  const rawMobile = v.str('mobile', { required: true, max: 20 });
  const months = v.int('months', { min: 1, max: 24 }) ?? 12;
  v.done();
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'VALIDATION', 'Choose Setu or Finvu.');
  const mobile = normalizePhone(rawMobile ?? ''); if (!mobile) throw new HttpError(400, 'VALIDATION', 'Enter the 10-digit mobile number linked to the bank account.');
  const today = istDate(now());
  const from = istDate(now() - 365 * 86_400_000), to = istDate(now() + months * 30 * 86_400_000);
  const c = await adapterFor(provider, f).createConsent({ mobile, from, to, months, tag: ownerId });
  const id = newId('aac'), t = now();
  run('INSERT INTO aa_consents(id, owner_id, provider, consent_id, status, url, mobile, data_from, data_to, created_at, created_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, ownerId, provider, c.consentId, c.status, c.url, mobile, from, to, t, actor.id, t);
  audit(actor, 'aa.consent', 'aa_consent', id, { provider, today }, ownerId);
  return listConsents(ownerId).find((x) => x.id === id)!;
}

const owned = (ownerId: string, id: string): CRow => {
  const r = one<CRow>('SELECT * FROM aa_consents WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'That consent was not found.');
  return r;
};
const note = (provider: string, type: string | null, consentId: string | null, ok: boolean, text: string): void => { run('INSERT INTO aa_events(at, provider, type, consent_id, ok, note) VALUES(?,?,?,?,?,?)', now(), provider, type, consentId, ok ? 1 : 0, text.slice(0, 300)); };

/** Reads the consent's status from the gateway (never from a webhook body) and asks for data when it has just become active. */
export async function refreshConsent(cfg: Config, row: CRow, actor: Actor = SYSTEM, f: Fetcher = fetch): Promise<void> {
  const ad = adapterFor(row.provider, f);
  const { status } = await ad.getConsent(row.consent_id);
  if (status && status !== row.status) run('UPDATE aa_consents SET status = ?, updated_at = ? WHERE id = ?', status, now(), row.id);
  if (status === 'ACTIVE' && !row.session_id) await requestData(row.id, actor, f);
}

/** Asks the gateway for the latest data: from a week before the last fetch (late items), or the whole consent range the first time. */
export async function requestData(rowId: string, actor: Actor = SYSTEM, f: Fetcher = fetch): Promise<void> {
  const row = one<CRow>('SELECT * FROM aa_consents WHERE id = ?', rowId); if (!row) return;
  if (row.status !== 'ACTIVE') throw new HttpError(409, 'CONSENT_NOT_ACTIVE', 'The account holder has not approved this consent yet.');
  const from = row.last_fetch_at ? istDate(row.last_fetch_at - 7 * 86_400_000) : row.data_from;
  const to = istDate(now());
  const from2 = from < row.data_from ? row.data_from : from;
  const { sessionId } = await adapterFor(row.provider, f).createSession(row.consent_id, from2, to);
  run("UPDATE aa_consents SET session_id = ?, session_status = 'PENDING', updated_at = ? WHERE id = ?", sessionId, now(), row.id);
  audit(actor, 'aa.request', 'aa_consent', row.id, {}, row.owner_id);
}

/** Reads a finished data session and loads each mapped account through the normal import. Returns whether the data was ready. */
export async function fetchData(cfg: Config, rowId: string, actor: Actor = SYSTEM, f: Fetcher = fetch, trigger = 'schedule'): Promise<{ ready: boolean; newRows: number; unmapped: number }> {
  const row = one<CRow>('SELECT * FROM aa_consents WHERE id = ?', rowId);
  if (!row?.session_id) return { ready: false, newRows: 0, unmapped: 0 };
  const sess = await adapterFor(row.provider, f).getSession(row.session_id);
  run('UPDATE aa_consents SET session_status = ?, updated_at = ? WHERE id = ?', sess.status, now(), row.id);
  if (sess.status !== 'COMPLETED' && sess.status !== 'PARTIAL') {
    if (sess.status === 'FAILED' || sess.status === 'EXPIRED') run('UPDATE aa_consents SET session_id = NULL, last_message = ? WHERE id = ?', `The bank did not send data (${sess.status.toLowerCase()}). It will be asked again.`, row.id);
    return { ready: false, newRows: 0, unmapped: 0 };
  }
  let newRows = 0, unmapped = 0; const lines: string[] = [];
  for (const ac of sess.accounts) {
    const last4 = ac.masked ? (/(\d{4})\D*$/.exec(ac.masked)?.[1] ?? null) : null;
    run('INSERT INTO aa_accounts(id, consent_row, owner_id, link_ref, masked, last4, fip_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(consent_row, link_ref) DO UPDATE SET masked = excluded.masked, last4 = excluded.last4, fip_id = excluded.fip_id', newId('aaa'), row.id, row.owner_id, ac.linkRef, ac.masked, last4, ac.fipId);
    const rec = one<{ id: string; account_id: string | null }>('SELECT id, account_id FROM aa_accounts WHERE consent_row = ? AND link_ref = ?', row.id, ac.linkRef)!;
    let target = rec.account_id;
    if (!target && last4) { // join by the last 4 digits when exactly one bank account in the books has them and is not already taken
      const c = many<{ id: string }>(`SELECT a.id FROM acct_accounts a WHERE a.owner_id = ? AND a.kind = 'bank' AND a.holds = 'bank' AND a.last4 = ? AND a.deleted_at IS NULL AND a.active = 1
        AND a.id NOT IN (SELECT account_id FROM aa_accounts WHERE account_id IS NOT NULL)`, row.owner_id, last4);
      if (c.length === 1) { target = c[0]!.id; run('UPDATE aa_accounts SET account_id = ? WHERE id = ?', target, rec.id); }
    }
    if (ac.balancePaise !== null) run('UPDATE aa_accounts SET balance_paise = ?, balance_at = ? WHERE id = ?', ac.balancePaise, now(), rec.id);
    if (!target) { unmapped++; continue; }
    if (ac.status && ac.status !== 'READY' && ac.status !== 'DELIVERED') continue;
    run('INSERT INTO acct_feed_log(owner_id, account_id, trigger, started_at) VALUES(?,?,?,?)', row.owner_id, target, trigger, now());
    const logId = one<{ m: number }>('SELECT MAX(id) m FROM acct_feed_log WHERE account_id = ?', target)!.m;
    try {
      const { res, adopted, fresh } = ingestFeedRows(row.owner_id, actor, target, row.provider, ac.rows);
      newRows += res.rowsNew;
      const dup = ac.rows.length - fresh.length - adopted + res.rowsDuplicate;
      const msg = `${res.rowsNew} new, ${dup} already in the books${adopted ? `, ${adopted} matched to statement lines` : ''}`;
      run('UPDATE acct_feed_log SET finished_at = ?, ok = 1, fetched = ?, new_rows = ?, duplicates = ?, matched = ?, message = ? WHERE id = ?', now(), ac.rows.length, res.rowsNew, dup, res.categorisedByRules, msg, logId);
      run('INSERT INTO acct_feed_state(account_id, last_sync_at, last_ok, last_message, bank_balance_paise, bank_balance_at) VALUES(?,?,1,?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_ok = 1, last_message = excluded.last_message, bank_balance_paise = COALESCE(excluded.bank_balance_paise, acct_feed_state.bank_balance_paise), bank_balance_at = COALESCE(excluded.bank_balance_at, acct_feed_state.bank_balance_at)', target, now(), msg, ac.balancePaise, ac.balancePaise === null ? null : now());
      lines.push(msg);
    } catch (e) {
      run('UPDATE acct_feed_log SET finished_at = ?, ok = 0, message = ? WHERE id = ?', now(), (e as Error).message.slice(0, 300), logId);
      run('INSERT INTO acct_feed_state(account_id, last_sync_at, last_ok, last_message) VALUES(?,?,0,?) ON CONFLICT(account_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_ok = 0, last_message = excluded.last_message', target, now(), (e as Error).message.slice(0, 300));
      lines.push((e as Error).message);
    }
  }
  const summary = lines.length ? lines.join('; ') : unmapped ? 'Choose which books account each bank account belongs to.' : 'No accounts came back.';
  run('UPDATE aa_consents SET last_fetch_at = ?, last_message = ?, session_id = NULL, updated_at = ? WHERE id = ?', now(), summary.slice(0, 300), now(), row.id);
  note(row.provider, 'fetch', row.consent_id, true, `${newRows} new rows`);
  return { ready: true, newRows, unmapped };
}

/** Joins one gateway account to a books bank account (or unjoins with accountId ''). */
export function mapAccount(ownerId: string, actor: Actor, aaAccountId: string, body: unknown): void {
  const v = new Validator(body); const accountId = v.str('accountId', { max: 60 }); v.done();
  const r = one<{ id: string }>('SELECT id FROM aa_accounts WHERE id = ? AND owner_id = ?', aaAccountId, ownerId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'That bank account was not found.');
  if (!accountId) { run('UPDATE aa_accounts SET account_id = NULL WHERE id = ?', r.id); return; }
  const a = accountOr404(ownerId, accountId);
  if (a.kind !== 'bank') throw new HttpError(400, 'NOT_A_BANK', 'Only bank accounts can have a feed.');
  if (one('SELECT 1 x FROM aa_accounts WHERE account_id = ? AND id <> ?', a.id, r.id)) throw new HttpError(409, 'ALREADY_LINKED', 'That books account is already joined to another bank account.');
  run('UPDATE aa_accounts SET account_id = ? WHERE id = ?', a.id, r.id);
  audit(actor, 'aa.map', 'aa_account', r.id, { accountId: a.id }, ownerId);
}

/** The owner presses "Get the latest": checks the consent, asks for data if none is on the way, and reads it if it has arrived. */
export async function syncConsent(cfg: Config, ownerId: string, actor: Actor, id: string, f: Fetcher = fetch): Promise<{ status: string; ready: boolean; newRows: number; message: string }> {
  const row = owned(ownerId, id);
  await refreshConsent(cfg, row, actor, f);
  let cur = owned(ownerId, id);
  if (cur.status !== 'ACTIVE') return { status: cur.status, ready: false, newRows: 0, message: cur.status === 'PENDING' ? 'Waiting for the account holder to approve the consent.' : `The consent is ${cur.status.toLowerCase()}.` };
  if (!cur.session_id) { await requestData(cur.id, actor, f); cur = owned(ownerId, id); }
  const r = await fetchData(cfg, cur.id, actor, f, 'manual');
  return { status: 'ACTIVE', ...r, message: r.ready ? `${r.newRows} new lines loaded.` : 'The bank is still preparing the data. It is picked up automatically.' };
}

export function revokeLocal(ownerId: string, actor: Actor, id: string): void {
  const r = owned(ownerId, id);
  run("UPDATE aa_consents SET status = 'REVOKED', session_id = NULL, updated_at = ? WHERE id = ?", now(), r.id);
  audit(actor, 'aa.forget', 'aa_consent', r.id, {}, ownerId);
}

// ------------------------------------------------------------------ the webhook, and the daily catch-up (the gateway does not retry a missed webhook)

export function aaWebhookAuthorised(token: string | undefined): boolean {
  const want = stored().get('webhookSecret'); if (!want || !token) return false;
  const k = 'daji-aa-webhook';
  return timingSafeEqual(createHmac('sha256', k).update(want).digest(), createHmac('sha256', k).update(token).digest());
}

/** A notification only says "look again": the consent and the data are always read back from the gateway, never taken from the body. */
export async function handleAaWebhook(cfg: Config, provider: AaProvider, body: unknown, f: Fetcher = fetch): Promise<void> {
  const b = (body ?? {}) as { type?: unknown; consentId?: unknown };
  const consentId = typeof b.consentId === 'string' ? b.consentId : null, type = typeof b.type === 'string' ? b.type : null;
  const row = consentId ? one<CRow>('SELECT * FROM aa_consents WHERE provider = ? AND consent_id = ?', provider, consentId) : undefined;
  if (!row) { note(provider, type, consentId, false, 'unknown consent'); return; }
  try {
    if (type === 'CONSENT_STATUS_UPDATE') await refreshConsent(cfg, row, SYSTEM, f);
    else if (type === 'SESSION_STATUS_UPDATE') await fetchData(cfg, row.id, SYSTEM, f, 'webhook');
    note(provider, type, consentId, true, 'handled');
  } catch (e) { note(provider, type, consentId, false, (e as Error).message); throw e; }
}

/** Daily: every active consent is asked for fresh data (at most once a day), and any data that was asked for earlier is read. */
const lastLook = new Map<string, number>();
export async function runAaSync(cfg: Config, onError: (e: unknown) => void = () => {}, f: Fetcher = fetch): Promise<number> {
  const rows = many<CRow>("SELECT * FROM aa_consents WHERE status IN ('ACTIVE','PENDING') AND provider = 'setu' AND created_at > ?", now() - 30 * 86_400_000);
  if (!rows.length || !stored().get('setu.clientId')) return 0;
  let n = 0;
  for (const r of rows) {
    if ((lastLook.get(r.id) ?? 0) > now() - 5 * 60_000) continue; // the sweep runs every minute or so; the gateway is asked at most every five minutes per consent
    lastLook.set(r.id, now());
    try {
      if (r.status === 'PENDING') await refreshConsent(cfg, r, SYSTEM, f);
      let cur = one<CRow>('SELECT * FROM aa_consents WHERE id = ?', r.id)!;
      if (cur.status !== 'ACTIVE') continue;
      if (!cur.session_id && (!cur.last_fetch_at || cur.last_fetch_at < now() - 23 * 3_600_000)) { await requestData(cur.id, SYSTEM, f); cur = one<CRow>('SELECT * FROM aa_consents WHERE id = ?', r.id)!; }
      if (cur.session_id) { const x = await fetchData(cfg, cur.id, SYSTEM, f, 'schedule'); if (x.ready) n++; }
    } catch (e) { onError(e); }
  }
  return n;
}
