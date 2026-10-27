import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.dajicricket.com').replace(/\/$/, '');
const KEY = 'daji.token';
let token: string | null = null;
/** The super admin works inside one owner's desk at a time; this owner is added to owner-scoped requests. */
let viewOwner: string | null = null;
export const setViewOwner = (id: string | null): void => { viewOwner = id; };
const OWNER_SCOPED = ['/api/tasks', '/api/staff', '/api/accounting', '/api/media', '/api/desk'];
const scoped = (path: string): string => (viewOwner && OWNER_SCOPED.some((p) => path.startsWith(p)) && !/[?&]ownerId=/.test(path) ? path + (path.includes('?') ? '&' : '?') + 'ownerId=' + encodeURIComponent(viewOwner) : path);

export async function loadToken(): Promise<string | null> { try { token = await SecureStore.getItemAsync(KEY); } catch { token = null; } return token; }
export async function setToken(t: string | null): Promise<void> {
  token = t;
  try { if (t) await SecureStore.setItemAsync(KEY, t); else await SecureStore.deleteItemAsync(KEY); } catch { /* the session just will not survive a restart */ }
}
export const currentToken = (): string | null => token;
/** Ends the session on the server too, so a copied token stops working. Never throws. */
export async function serverSignOut(): Promise<void> {
  if (!token) return;
  try { await fetch(API_URL + '/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch { /* offline: the token still expires */ }
}

/** details carries the server's extra facts, such as the fields that failed ({ fields: [{ field, message }] }). */
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: any) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  // a slow or sleeping server must not leave a screen spinning forever
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    res = await fetch(API_URL + scoped(path), {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
  } catch { throw new ApiError(0, 'NETWORK', ctl.signal.aborted ? 'The server is taking too long to answer. Please try again.' : 'Could not reach the server. Check your connection.'); } finally { clearTimeout(timer); }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Something went wrong (${res.status})`, data?.error?.details);
  return data as T;
}

/** Sends a picture from the phone as the raw body. `headers` carries extras such as when it was shot. */
export async function upload<T = any>(path: string, uri: string, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    const blob = await (await fetch(uri)).blob();
    res = await fetch(API_URL + scoped(path), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: blob });
  } catch { throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection.'); }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Something went wrong (${res.status})`, data?.error?.details);
  return data as T;
}
/** An image address that needs the sign-in header (task photos). Public pictures (profile) use the plain address. */
export const authImage = (url: string): { uri: string; headers?: Record<string, string> } => {
  if (/^(https?:|data:)/.test(url)) return { uri: url };
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return { uri: API_URL + url, headers };
};
