import { createHmac, timingSafeEqual } from 'node:crypto';
import { many, one } from '../db.ts';
import { HttpError } from '../errors.ts';
import type { Config } from '../config.ts';
import { yodleeConfigured, yodleeLogin, yodleeToken } from './feed.ts';

// Connecting a bank through Yodlee: register this owner as a Yodlee user, open FastLink (Yodlee's hosted bank-login screen),
// list the bank accounts the owner connected, and tell the server when Yodlee has fresh data. Pulling the transactions
// themselves is in feed.ts. Request shapes follow Yodlee's published API; no live Yodlee account was available here, so they are
// exercised only against a local stand-in server (see test/yodlee.test.ts).

type Fetcher = typeof fetch;

const headers = (cfg: Config, token: string, json = false): Record<string, string> => ({
  'Api-Version': '1.1', Authorization: `Bearer ${token}`, Accept: 'application/json',
  ...(cfg.yodlee.clientId ? { 'Cobrand-Name': cfg.yodlee.clientId } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}),
});

async function failure(res: Response, what: string): Promise<HttpError> {
  let detail = ''; try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; detail = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ }
  return new HttpError(502, 'FEED_ERROR', `Yodlee could not ${what} (${res.status}${detail ? ': ' + detail : ''}).`);
}

/** Makes sure this owner exists as a Yodlee user. Safe to repeat: "already exists" counts as done. */
export async function ensureYodleeUser(cfg: Config, ownerId: string, f: Fetcher = fetch): Promise<void> {
  const loginName = yodleeLogin(cfg, ownerId);
  const owner = one<{ name: string; email: string | null }>('SELECT name, email FROM users WHERE id = ?', ownerId);
  const [first, ...rest] = (owner?.name || 'Owner').trim().split(/\s+/);
  // registering is done as the admin user; the user token for everything else is signed for the owner's own login name
  const adminToken = yodleeToken(cfg, cfg.yodlee.adminLoginName || 'daji');
  const res = await f(`${cfg.yodlee.apiUrl}/user/register`, {
    method: 'POST', headers: headers(cfg, adminToken, true),
    body: JSON.stringify({ user: { loginName, ...(owner?.email ? { email: owner.email } : {}), name: { first: first || 'Owner', last: rest.join(' ') || 'Owner' }, address: { country: 'IN' }, preferences: { currency: 'INR', timeZone: 'Asia/Kolkata', dateFormat: 'yyyy-MM-dd' } } }),
  });
  if (res.ok || res.status === 409) return; // 409 / Y800: already registered
  let code = ''; try { code = String(((await res.clone().json()) as { errorCode?: string }).errorCode ?? ''); } catch { /* not JSON */ }
  if (code === 'Y800') return;
  throw await failure(res, 'register this business');
}

export interface FastLinkSession { url: string; accessToken: string; params: { configName: string }; expiresInSeconds: number }

/** What the browser needs to open FastLink: the page address, a short-lived token for this owner only, and the config to use. */
export async function fastLinkSession(cfg: Config, ownerId: string, f: Fetcher = fetch): Promise<FastLinkSession> {
  if (!yodleeConfigured(cfg) || !cfg.yodlee.fastLinkUrl) throw new HttpError(409, 'FEED_NOT_CONFIGURED', 'Yodlee is not set up on this server yet.');
  await ensureYodleeUser(cfg, ownerId, f);
  return { url: cfg.yodlee.fastLinkUrl, accessToken: `Bearer ${yodleeToken(cfg, yodleeLogin(cfg, ownerId))}`, params: { configName: 'Aggregation' }, expiresInSeconds: 600 };
}

export interface ProviderAccount { id: string; bankName: string; accountName: string; maskedNumber: string; type: string; balancePaise: number | null; linkedTo: string | null; refreshStatus: string | null }

interface YAccount { id?: number | string; providerName?: string; accountName?: string; accountNumber?: string; accountType?: string; CONTAINER?: string; currentBalance?: { amount?: number }; balance?: { amount?: number }; refreshinfo?: { statusMessage?: string; status?: string } }

/** The bank accounts this owner has connected in Yodlee, each marked with the books account it is linked to (if any). */
export async function listProviderAccounts(cfg: Config, ownerId: string, f: Fetcher = fetch): Promise<ProviderAccount[]> {
  if (!yodleeConfigured(cfg)) throw new HttpError(409, 'FEED_NOT_CONFIGURED', 'Yodlee is not set up on this server yet.');
  const res = await f(`${cfg.yodlee.apiUrl}/accounts?container=bank`, { headers: headers(cfg, yodleeToken(cfg, yodleeLogin(cfg, ownerId))) });
  if (res.status === 401 || res.status === 404) return []; // not registered yet, or nothing connected yet
  if (!res.ok) throw await failure(res, 'list the connected bank accounts');
  const data = await res.json() as { account?: YAccount[] };
  const linked = new Map(many<{ id: string; provider_ref: string }>("SELECT id, provider_ref FROM acct_accounts WHERE owner_id = ? AND provider_ref LIKE 'yodlee:%' AND deleted_at IS NULL", ownerId).map((r) => [r.provider_ref.slice(7), r.id]));
  return (data.account ?? []).filter((a) => a.id !== undefined && (!a.CONTAINER || a.CONTAINER === 'bank')).map((a): ProviderAccount => {
    const bal = a.currentBalance?.amount ?? a.balance?.amount;
    const num = String(a.accountNumber ?? '');
    return { id: String(a.id), bankName: String(a.providerName ?? 'Bank'), accountName: String(a.accountName ?? 'Account'), maskedNumber: num ? '•••• ' + num.replace(/\W/g, '').slice(-4) : '', type: String(a.accountType ?? '').toLowerCase(),
      balancePaise: typeof bal === 'number' ? Math.round(bal * 100) : null, linkedTo: linked.get(String(a.id)) ?? null, refreshStatus: a.refreshinfo?.statusMessage ?? a.refreshinfo?.status ?? null };
  });
}

/** Removes the owner's bank connection at Yodlee (stops all further data). Local links are cleared by the caller. */
export async function disconnectProviderAccount(cfg: Config, ownerId: string, providerAccountId: string, f: Fetcher = fetch): Promise<void> {
  if (!/^\d{1,18}$/.test(providerAccountId)) throw new HttpError(400, 'BAD_REQUEST', 'That is not a valid Yodlee id.');
  const res = await f(`${cfg.yodlee.apiUrl}/providerAccounts/${providerAccountId}`, { method: 'DELETE', headers: headers(cfg, yodleeToken(cfg, yodleeLogin(cfg, ownerId))) });
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
