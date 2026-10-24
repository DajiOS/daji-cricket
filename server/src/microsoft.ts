import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@daji/shared';
import type { Config } from './config.ts';
import { signToken, toUser, userByEmail, userRow } from './auth.ts';
import { checkCode, mfaEnabled } from './mfa.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import { now } from './clock.ts';

// Sign in with Microsoft (work or school accounts in Microsoft Entra ID, and personal Microsoft accounts), for the phone apps.
//  1. The app opens /api/auth/microsoft/start?app=<its scheme>&challenge=<SHA-256 of a secret it keeps> in the phone's browser.
//  2. We send the browser on to Microsoft with a signed state. Microsoft sends it back to /api/auth/microsoft/callback with a code.
//  3. We swap the code for the person's ID token straight with Microsoft (with our client secret), find their account by email, and
//     send the browser back to the app (<scheme>://auth/microsoft?ticket=...) with a one-time ticket that lasts two minutes.
//  4. The app swaps the ticket and its secret for a normal sign-in at POST /api/auth/microsoft/redeem. Only the app that started the
//     sign-in holds the secret, so another app that catches the link gets nothing. A 2-step code is still asked for when one is set.
// Microsoft never makes an account here: it signs in people who already have one with the same email.

/** The phone apps' own link schemes (mobile/app.config.js). The browser is only ever sent back to one of these. */
export const APP_SCHEMES = ['dajicricket', 'dajiadmin'] as const;
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'; // personal Microsoft accounts (outlook.com, hotmail.com): the email is checked by Microsoft
const STATE_MS = 10 * 60 * 1000;
const TICKET_MS = 2 * 60 * 1000;
const TICKET_TRIES = 5;

export const microsoftConfigured = (c: Config): boolean => !!(c.microsoft.clientId && c.microsoft.clientSecret);
const redirectUri = (c: Config): string => `${c.apiUrl}/api/auth/microsoft/callback`;
const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const sign = (c: Config, body: string): string => createHmac('sha256', c.jwtSecret).update('microsoft-state.' + body).digest('base64url');

interface State { app: string; ch: string; exp: number }
interface Ticket { userId: string; ch: string; exp: number; tries: number }
const tickets = new Map<string, Ticket>(); // one server process (deploy/docker-compose.yml), and a ticket lives two minutes
export function resetMicrosoftTickets(): void { tickets.clear(); }

/** Where the phone's browser goes first: Microsoft's sign-in page. */
export function startUrl(c: Config, app: string | null, challenge: string | null): string {
  if (!microsoftConfigured(c)) throw new HttpError(404, 'MICROSOFT_OFF', 'Sign in with Microsoft is not set up on this server yet.');
  if (!app || !(APP_SCHEMES as readonly string[]).includes(app)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown app', { fields: [{ field: 'app', message: 'Must be one of ' + APP_SCHEMES.join(', ') }] });
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the SHA-256 challenge', { fields: [{ field: 'challenge', message: 'A base64url SHA-256 hash' }] });
  const body = b64url(JSON.stringify({ app, ch: challenge, exp: now() + STATE_MS } satisfies State));
  const q = new URLSearchParams({
    client_id: c.microsoft.clientId, response_type: 'code', redirect_uri: redirectUri(c), response_mode: 'query',
    scope: 'openid email profile', state: `${body}.${sign(c, body)}`, prompt: 'select_account',
  });
  return `${c.microsoft.loginUrl}/${encodeURIComponent(c.microsoft.tenant)}/oauth2/v2.0/authorize?${q}`;
}

function readState(c: Config, raw: string | null): State | null {
  const [body, mac] = (raw ?? '').split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(c, body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as State;
    return s.exp > now() && (APP_SCHEMES as readonly string[]).includes(s.app) ? s : null;
  } catch { return null; }
}

/** The claims we read from Microsoft's ID token. */
interface Claims { aud?: string; exp?: number; tid?: string; email?: string; preferred_username?: string; xms_edov?: boolean | string | number }

/**
 * Microsoft's answer comes back here. Always ends in a redirect to the app: with a ticket, or with ?error= and a sentence to show.
 * A broken or old state (no app to go back to) gets a short page instead.
 */
export async function callback(c: Config, q: URLSearchParams): Promise<{ location: string } | { page: string }> {
  const st = readState(c, q.get('state'));
  if (!st) return { page: 'This sign-in link has run out. Go back to the Daji app and press Sign in with Microsoft again.' };
  const back = (p: Record<string, string>) => ({ location: `${st.app}://auth/microsoft?${new URLSearchParams(p)}` });
  if (q.get('error')) return back({ error: q.get('error') === 'access_denied' ? 'Microsoft sign-in was cancelled.' : 'Microsoft could not sign you in. Try again, or use your password.' });
  const code = q.get('code');
  if (!code) return back({ error: 'Microsoft did not send a sign-in code. Try again.' });

  let claims: Claims;
  try {
    const res = await fetch(`${c.microsoft.loginUrl}/${encodeURIComponent(c.microsoft.tenant)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.microsoft.clientId, client_secret: c.microsoft.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri(c), scope: 'openid email profile' }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as { id_token?: string };
    if (!res.ok || !data.id_token) throw new Error('no id token');
    // The token came straight from Microsoft over HTTPS in answer to our secret, so (OpenID Connect Core 3.1.3.7) the TLS check stands
    // in for checking its signature. Who it is for and when it runs out are still checked.
    claims = JSON.parse(Buffer.from(data.id_token.split('.')[1] ?? '', 'base64url').toString()) as Claims;
  } catch { return back({ error: 'Could not reach Microsoft. Check your connection and try again.' }); }
  if (claims.aud !== c.microsoft.clientId || !claims.exp || claims.exp * 1000 < now()) return back({ error: 'Microsoft sign-in did not check out. Try again.' });

  // An email in a work account can be typed in by that company's admin, so it only counts when Microsoft vouches for it:
  // a personal account, our own tenant (when MICROSOFT_TENANT names one), or the xms_edov claim (domain owner verified).
  const ownTenant = /^[0-9a-f-]{36}$/i.test(c.microsoft.tenant) && claims.tid === c.microsoft.tenant;
  const personal = claims.tid === CONSUMER_TENANT;
  const vouched = personal || ownTenant || claims.xms_edov === true || claims.xms_edov === 'true' || claims.xms_edov === 1;
  const email = (claims.email ?? (personal ? claims.preferred_username : undefined))?.trim();
  if (!email || !vouched) return back({ error: 'Microsoft could not confirm the email on this account. Sign in with your email and password instead.' });
  const u = userByEmail(email);
  if (!u) return back({ error: `There is no Daji account for ${email}. Sign in with your password, or create an account with this email first.` });
  if (!u.active) return back({ error: 'This account has been disabled.' });

  for (const [k, t] of tickets) if (t.exp < now()) tickets.delete(k);
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { userId: u.id, ch: st.ch, exp: now() + TICKET_MS, tries: 0 });
  return back({ ticket });
}

/** The app's last step: the ticket, the secret behind its challenge and, for accounts with 2-step sign-in, the code. */
export function redeem(c: Config, ticket: string, verifier: string, code?: string): { token: string; user: User } {
  const t = tickets.get(ticket);
  if (!t || t.exp < now()) { tickets.delete(ticket); throw new HttpError(401, 'TICKET_EXPIRED', 'That Microsoft sign-in has run out. Press Sign in with Microsoft again.'); }
  if (createHash('sha256').update(verifier).digest('base64url') !== t.ch) { tickets.delete(ticket); throw new HttpError(401, 'TICKET_INVALID', 'That Microsoft sign-in did not come from this app. Press Sign in with Microsoft again.'); }
  const u = userRow(t.userId);
  if (!u || !u.active) { tickets.delete(ticket); throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled'); }
  if (mfaEnabled(u.id)) {
    if (!code) throw new HttpError(401, 'MFA_REQUIRED', 'Enter the 6 digit code from your authenticator app');
    if (!checkCode(u.id, code, { requireEnabled: true })) {
      if (++t.tries >= TICKET_TRIES) tickets.delete(ticket);
      throw new HttpError(401, 'MFA_INVALID', 'That code is not right or has already been used. Wait for the next one.');
    }
  }
  tickets.delete(ticket);
  audit({ id: u.id, role: u.role }, 'auth.microsoft', 'user', u.id, {});
  return { token: signToken(c, u), user: toUser(u) };
}
