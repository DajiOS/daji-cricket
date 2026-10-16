import { createHmac, timingSafeEqual } from 'node:crypto';
import { many, one } from '../db.ts';
import { HttpError } from '../errors.ts';
import type { Config } from '../config.ts';
import { userToken, yFetch, yodleeConfigured, yodleeLogin } from './feed.ts';

// Connecting a bank through Yodlee: register this owner as a Yodlee user, open FastLink (Yodlee's hosted bank-login screen),
// list the bank accounts the owner connected, and tell the server when Yodlee has fresh data. Pulling the transactions
// themselves is in feed.ts. Request shapes follow Yodlee's published API; no live Yodlee account was available here, so they are
// exercised only against a local stand-in server (see test/yodlee.test.ts).

type Fetcher = typeof fetch;

async function failure(res: Response, what: string): Promise<HttpError> {
  let detail = ''; try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; detail = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ }
  return new HttpError(502, 'FEED_ERROR', `Yodlee could not ${what} (${res.status}${detail ? ': ' + detail : ''}).`);
}

const notSetUp = (): HttpError => new HttpError(409, 'FEED_NOT_CONFIGURED', 'Yodlee is not set up on this server yet.');

/** Makes sure this owner exists as a Yodlee user. Safe to repeat: "already exists" counts as done. A sandbox test user already exists. */
export async function ensureYodleeUser(cfg: Config, ownerId: string, f: Fetcher = fetch): Promise<void> {
  if (cfg.yodlee.userLogin) return;
  const loginName = yodleeLogin(cfg, ownerId);
  const owner = one<{ name: string; email: string | null }>('SELECT name, email FROM users WHERE id = ?', ownerId);
  const [first, ...rest] = (owner?.name || 'Owner').trim().split(/\s+/);
  // registering is done as the admin user; everything else is done as the owner's own login name
  const res = await yFetch(cfg, cfg.yodlee.adminLoginName || 'daji', '/user/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { loginName, ...(owner?.email ? { email: owner.email } : {}), name: { first: first || 'Owner', last: rest.join(' ') || 'Owner' }, address: { country: 'IN' }, preferences: { currency: 'INR', timeZone: 'Asia/Kolkata', dateFormat: 'yyyy-MM-dd' } } }),
  }, f);
  if (res.ok || res.status === 409) return; // 409 / Y800: already registered
  let code = ''; try { code = String(((await res.clone().json()) as { errorCode?: string }).errorCode ?? ''); } catch { /* not JSON */ }
  if (code === 'Y800') return;
  throw await failure(res, 'register this business');
}

export interface FastLinkSession { url: string; accessToken: string; params: { configName: string; flow?: string; providerAccountId?: string }; expiresInSeconds: number }

/** What the browser needs to open FastLink: the page address, a short-lived token for this owner only, and the config to use.
 * `flow` 'edit' fixes the login of one bank link, 'refresh' answers its one-time code. */
export async function fastLinkSession(cfg: Config, ownerId: string, opts: { flow?: 'edit' | 'refresh'; providerAccountId?: string } = {}, f: Fetcher = fetch): Promise<FastLinkSession> {
  if (!yodleeConfigured(cfg) || !cfg.yodlee.fastLinkUrl) throw notSetUp();
  if (opts.flow && !/^\d{1,18}$/.test(opts.providerAccountId ?? '')) throw new HttpError(400, 'BAD_REQUEST', 'Say which bank link to fix.');
  await ensureYodleeUser(cfg, ownerId, f);
  const token = await userToken(cfg, yodleeLogin(cfg, ownerId), f);
  return { url: cfg.yodlee.fastLinkUrl, accessToken: `Bearer ${token}`, params: { configName: cfg.yodlee.configName || 'Aggregation', ...(opts.flow ? { flow: opts.flow, providerAccountId: opts.providerAccountId } : {}) }, expiresInSeconds: 600 };
}

// ------------------------------------------------------------------ what the bank link is doing, in plain words

export interface BankStatus { code: 'ok' | 'working' | 'otp' | 'login' | 'locked' | 'consent' | 'bank_down' | 'failed'; text: string; action: 'otp' | 'fix' | 'refresh' | null }

/** Turns Yodlee's status and additionalStatus into one sentence and the one thing the person can do about it. */
export function bankStatus(status?: string | null, additional?: string | null): BankStatus {
  const s = String(status ?? '').toUpperCase(), a = String(additional ?? '').toUpperCase();
  const k = a || s;
  if (['SUCCESS', 'PARTIAL_SUCCESS'].includes(k) || (s === 'SUCCESS' && !a)) return { code: 'ok', text: 'Connected', action: 'refresh' };
  if (['IN_PROGRESS', 'LOGIN_IN_PROGRESS', 'LOGIN_SUCCESS', 'DATA_RETRIEVAL_IN_PROGRESS'].includes(k) || s === 'IN_PROGRESS') return { code: 'working', text: 'Fetching from the bank…', action: null };
  if (k === 'USER_INPUT_REQUIRED') return { code: 'otp', text: 'The bank is asking for a one-time code or an answer', action: 'otp' };
  if (['INCORRECT_CREDENTIALS', 'CREDENTIALS_UPDATE_NEEDED', 'PASSWORD_EXPIRED', 'ADDL_AUTHENTICATION_REQUIRED', 'INVALID_ADDL_INFO_PROVIDED', 'NEW_AUTHENTICATION_REQUIRED'].includes(k)) return { code: 'login', text: 'The bank login needs updating', action: 'fix' };
  if (['ACCOUNT_LOCKED', 'LOGIN_NOT_ALLOWED'].includes(k)) return { code: 'locked', text: 'The bank login is locked. Unlock it at the bank, then fix the login here', action: 'fix' };
  if (['CONSENT_EXPIRED', 'CONSENT_REVOKED', 'CONSENT_REQUIRED'].includes(k)) return { code: 'consent', text: 'Bank consent has expired. Give consent again', action: 'fix' };
  if (['SITE_UNAVAILABLE', 'TECH_ERROR', 'DATA_RETRIEVAL_FAILED', 'REQUEST_TIME_OUT', 'SITE_BLOCKING_ERROR', 'UNEXPECTED_SITE_ERROR', 'SITE_SESSION_INVALIDATED', 'SITE_NOT_SUPPORTED'].includes(k)) return { code: 'bank_down', text: 'The bank website is not responding. Yodlee will try again', action: null };
  return { code: 'failed', text: `Not connected${k ? ` (${k.toLowerCase().replace(/_/g, ' ')})` : ''}`, action: 'fix' };
}

export interface ProviderAccount {
  id: string; providerAccountId: string | null; bankName: string; accountName: string; maskedNumber: string; last4: string; type: string; container: 'bank' | 'creditCard' | 'loan';
  balancePaise: number | null; linkedTo: string | null; refreshStatus: string | null; status: BankStatus; lastRefreshed: string | null;
}

interface YAccount { id?: number | string; providerAccountId?: number | string; providerName?: string; accountName?: string; accountNumber?: string; accountType?: string; CONTAINER?: string; currentBalance?: { amount?: number }; balance?: { amount?: number }; refreshinfo?: { statusMessage?: string; status?: string; additionalStatus?: string; lastRefreshed?: string } }
interface YLink { id?: number | string; status?: string; refreshInfo?: { status?: string; additionalStatus?: string; lastRefreshed?: string } }

/** The accounts this owner has connected in Yodlee (bank accounts, credit cards and loans), each with its link's plain status and the books account it feeds (if any). */
export async function listProviderAccounts(cfg: Config, ownerId: string, f: Fetcher = fetch): Promise<ProviderAccount[]> {
  if (!yodleeConfigured(cfg)) throw notSetUp();
  const login = yodleeLogin(cfg, ownerId);
  const res = await yFetch(cfg, login, '/accounts', {}, f);
  if (res.status === 401 || res.status === 404) return []; // not registered yet, or nothing connected yet
  if (!res.ok) throw await failure(res, 'list the connected accounts');
  const data = await res.json() as { account?: YAccount[] };
  const links = new Map<string, YLink>();
  try {
    const lr = await yFetch(cfg, login, '/providerAccounts', {}, f);
    if (lr.ok) for (const l of ((await lr.json()) as { providerAccount?: YLink[] }).providerAccount ?? []) if (l.id !== undefined) links.set(String(l.id), l);
  } catch { /* status is nice to have; the accounts are what matter */ }
  const linked = new Map(many<{ id: string; provider_ref: string }>("SELECT id, provider_ref FROM acct_accounts WHERE owner_id = ? AND provider_ref LIKE 'yodlee:%' AND deleted_at IS NULL", ownerId).map((r) => [r.provider_ref.slice(7), r.id]));
  const box = (c?: string): ProviderAccount['container'] | null => { const x = String(c ?? 'bank').toLowerCase(); return x === 'bank' ? 'bank' : x === 'creditcard' ? 'creditCard' : x === 'loan' ? 'loan' : null; };
  const out: ProviderAccount[] = [];
  for (const a of data.account ?? []) {
    const container = box(a.CONTAINER); if (a.id === undefined || !container) continue;
    const pid = a.providerAccountId !== undefined ? String(a.providerAccountId) : null;
    const ri = (pid ? links.get(pid)?.refreshInfo : undefined) ?? a.refreshinfo;
    const bal = a.currentBalance?.amount ?? a.balance?.amount;
    const num = String(a.accountNumber ?? '').replace(/\W/g, '');
    out.push({ id: String(a.id), providerAccountId: pid, bankName: String(a.providerName ?? 'Bank'), accountName: String(a.accountName ?? 'Account'), maskedNumber: num ? '•••• ' + num.slice(-4) : '', last4: /^\d{4}$/.test(num.slice(-4)) ? num.slice(-4) : '', type: String(a.accountType ?? '').toLowerCase(), container,
      balancePaise: typeof bal === 'number' ? Math.round(bal * 100) : null, linkedTo: linked.get(String(a.id)) ?? null, refreshStatus: a.refreshinfo?.statusMessage ?? a.refreshinfo?.status ?? null,
      status: bankStatus(ri?.status, ri?.additionalStatus), lastRefreshed: ri?.lastRefreshed ?? null });
  }
  return out;
}

/** Asks the bank for fresh data now (Yodlee fetches in the background; the webhook or the next sync brings the lines in). */
export async function refreshProviderAccount(cfg: Config, ownerId: string, providerAccountId: string, f: Fetcher = fetch): Promise<void> {
  if (!/^\d{1,18}$/.test(providerAccountId)) throw new HttpError(400, 'BAD_REQUEST', 'That is not a valid Yodlee id.');
  if (!yodleeConfigured(cfg)) throw notSetUp();
  const res = await yFetch(cfg, yodleeLogin(cfg, ownerId), `/providerAccounts?providerAccountIds=${providerAccountId}`, { method: 'PUT' }, f);
  if (!res.ok) throw await failure(res, 'ask the bank for new data');
}

/** Removes the owner's bank connection at Yodlee (stops all further data). Local links are cleared by the caller. */
export async function disconnectProviderAccount(cfg: Config, ownerId: string, providerAccountId: string, f: Fetcher = fetch): Promise<void> {
  if (!/^\d{1,18}$/.test(providerAccountId)) throw new HttpError(400, 'BAD_REQUEST', 'That is not a valid Yodlee id.');
  const res = await yFetch(cfg, yodleeLogin(cfg, ownerId), `/providerAccounts/${providerAccountId}`, { method: 'DELETE' }, f);
  if (!res.ok && res.status !== 404) throw await failure(res, 'disconnect that bank');
}

// ------------------------------------------------------------------ webhook

/** Yodlee calls the webhook with `?token=<YODLEE_WEBHOOK_SECRET>` (compared in constant time). Returns the owners whose data changed. */
export function webhookAuthorised(cfg: Config, token: string | undefined): boolean {
  const want = cfg.yodlee.webhookSecret; if (!want || !token) return false;
  const k = 'daji-yodlee-webhook';
  const a = createHmac('sha256', k).update(want).digest(), b = createHmac('sha256', k).update(token).digest();
  return timingSafeEqual(a, b);
}

/** Owner ids named in a DATA_UPDATES / REFRESH notification (`event.data.userData[].user.loginName`), matched against our own login names. */
export function ownersInWebhook(cfg: Config, body: unknown): string[] {
  const out = new Set<string>();
  const users = (body as { event?: { data?: { userData?: { user?: { loginName?: string } }[] } } })?.event?.data?.userData;
  if (!Array.isArray(users)) return [];
  const prefix = `${cfg.yodlee.adminLoginName || 'daji'}_`;
  const owners = new Set(many<{ owner_id: string }>("SELECT DISTINCT owner_id FROM acct_accounts WHERE provider_ref LIKE 'yodlee:%' AND deleted_at IS NULL").map((r) => r.owner_id));
  for (const u of users) {
    const ln = String(u?.user?.loginName ?? '');
    if (!ln.startsWith(prefix)) continue;
    for (const o of owners) if (yodleeLogin(cfg, o) === ln) out.add(o);
  }
  return [...out];
}
