// API client, formatting and small shared helpers for the admin desk.
// Talks to the same server as the website. Sign-in is the bearer token the website stored in this browser (localStorage "daji.token").
import { useEffect, useState, useCallback } from 'react';
import { problemsSentence, type FieldProblem } from './formtext';

const fieldsOf = (details: unknown): FieldProblem[] => {
  const f = (details as { fields?: FieldProblem[] } | undefined)?.fields;
  return Array.isArray(f) ? f.filter((x) => x && typeof x.field === 'string') : [];
};
export class ApiError extends Error {
  /** The fields the server turned down, each with its own message ("customer.phone" -> "Required"). */
  fields: FieldProblem[];
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    // "Some fields are not valid" says nothing; say which field and what to do about it
    super(fieldsOf(details).length && (!message || /^some fields are not valid/i.test(message)) ? problemsSentence(fieldsOf(details)) : message);
    this.fields = fieldsOf(details);
  }
}

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage can be blocked */ } },
};
export const getToken = () => store.get('daji.token');
export const setToken = (t: string | null) => store.set('daji.token', t);

// the website may sit on Wix while the server is on another host
const API = ((window as any).DAJI_API || '').replace(/\/$/, '');

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

/** The owner a super admin is looking at. Owner-scoped endpoints get `?ownerId=` added for them. */
let viewOwner: string | null = store.get('daji.viewOwner');
export const getViewOwner = () => viewOwner;
export const setViewOwner = (id: string | null) => { viewOwner = id; store.set('daji.viewOwner', id); };
let isSuper = false;
export const setIsSuper = (v: boolean) => { isSuper = v; };
/** An owner working in another business of their portfolio: every request says which (X-Daji-Business). Null on their own. */
let portfolioBiz: string | null = null;
export const setPortfolioBusiness = (id: string | null) => { portfolioBiz = id; };
const bizHeader = (): Record<string, string> => (portfolioBiz ? { 'x-daji-business': portfolioBiz } : {});
const OWNER_SCOPED = ['/api/legal/staff-terms/report', '/api/tasks', '/api/projects', '/api/staff', '/api/accounting', '/api/books', '/api/media', '/api/ask', '/api/desk', '/api/cameras', '/api/docs', '/api/cash', '/api/site-reports', '/api/whatsapp'];

export interface ApiOptions { method?: string; body?: unknown; headers?: Record<string, string>; raw?: BodyInit }

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  if (isSuper && viewOwner && OWNER_SCOPED.some((p) => path.startsWith(p)) && !/[?&]ownerId=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'ownerId=' + encodeURIComponent(viewOwner);
  const headers: Record<string, string> = { ...bizHeader(), ...(opts.headers || {}) };
  const t = getToken(); if (t) headers.authorization = 'Bearer ' + t;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) { headers['content-type'] ??= 'application/octet-stream'; body = opts.raw; }
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let res: Response;
  try { res = await fetch(API + path, { method: opts.method || (opts.body !== undefined || opts.raw !== undefined ? 'POST' : 'GET'), headers, body }); }
  catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.'); }
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = (data && data.error) || {};
    if (res.status === 401 && t) onUnauthorized();
    throw new ApiError(res.status, e.code || 'ERROR', e.message || serverTrouble(res.status), e.details);
  }
  return data as T;
}
/** What to say when the server gives no reason of its own. */
const serverTrouble = (status: number) => status === 429 ? 'Too many tries in a short time. Wait a minute and try again.'
  : status >= 500 ? 'The server had a problem and nothing was saved. Try again in a minute; if it keeps happening, tell the software owner.'
  : status === 413 ? 'That file is too big to send.' : `Something went wrong (${status}). Nothing was saved.`;

export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
/** Shrinks a phone photo (often 4–10 MB) to a sharp 1800px JPEG so it uploads fast and stays under the upload limits (business cards, cash receipts). */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.88));
    return b ?? file;
  } catch { return file; }
}

/** Sends a file as the whole request body (receipts, bank statements). */
export const sendFile = <T = any>(path: string, file: Blob, headers?: Record<string, string>) => api<T>(path, { method: 'POST', raw: file, headers });

/** The bytes of a file the server keeps (a document page to draw). The token travels in a header, so it is fetched rather than linked. */
export async function fetchBytes(path: string): Promise<ArrayBuffer> {
  if (isSuper && viewOwner && OWNER_SCOPED.some((p) => path.startsWith(p)) && !/[?&]ownerId=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'ownerId=' + encodeURIComponent(viewOwner);
  const t = getToken();
  const res = await fetch(API + path, { headers: { ...bizHeader(), ...(t ? { authorization: 'Bearer ' + t } : {}) } });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', 'Could not load that file.');
  return res.arrayBuffer();
}

/** A private file (a task photo or reference) as a blob, with the sign-in and the business being worked in. */
export async function fetchBlob(path: string): Promise<Blob> {
  if (isSuper && viewOwner && OWNER_SCOPED.some((p) => path.startsWith(p)) && !/[?&]ownerId=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'ownerId=' + encodeURIComponent(viewOwner);
  const t = getToken();
  const res = await fetch(API + path, { headers: { ...bizHeader(), ...(t ? { authorization: 'Bearer ' + t } : {}) } });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', 'Could not load that file.');
  return res.blob();
}

/** Downloads a file the server makes. The token travels in a header, so the file is fetched first and then saved. */
export async function download(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await fetchBlob(path));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Load data from an endpoint; returns [data, error, reload]. Pass null to skip loading. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true; setError(null); setStatus(null);
    api<T>(path).then((d) => live && setData(d)).catch((e) => { if (live) { setError(e.message); setStatus(e instanceof ApiError ? e.status : 0); } });
    return () => { live = false; };
  }, [path, tick, ...deps]);
  // the fourth value is the HTTP status of a failure (403: this login may not see it; 0: the server could not be reached)
  return [data, error, useCallback(() => setTick((t) => t + 1), []), status] as const;
}

// ---------- formatting ----------
/** paise -> "₹12,34,567" (Indian grouping) */
export const inr = (paise: number | null | undefined, decimals?: number) => {
  const r = (paise || 0) / 100;
  const d = decimals ?? (Number.isInteger(r) ? 0 : 2);
  // a loss reads "−₹700" as on the accounting pages, never "₹-700"
  return (r < 0 ? '−₹' : '₹') + Math.abs(r).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
};
/** paise -> compact "₹12.3 L" / "₹1.24 Cr" */
export function inrShort(paise: number | null | undefined) {
  const r = (paise || 0) / 100, a = Math.abs(r), s = r < 0 ? '−₹' : '₹';
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)} K`;
  return `${s}${a.toFixed(0)}`;
}
/** "1234.50" typed by a person -> paise, or null when it is not a number */
export function toPaise(text: string): number | null {
  const t = String(text).replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const rupees = (paise: number) => (paise / 100).toFixed(2);
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "2026-10-16" -> "16 Oct 2026" */
export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONS[m! - 1]} ${y}`;
};
/** "2026-10-16" -> "Fri 16 Oct" */
export const fmtDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${DOWS[new Date(Date.UTC(y!, m! - 1, d)).getUTCDay()]} ${d} ${MONS[m! - 1]}`; };
const IST = 330 * 60000;
/** epoch milliseconds -> "16 Oct, 07:30 pm" in India time */
export const fmtDateTime = (ms?: number | null) => {
  if (!ms) return '—';
  const d = new Date(ms + IST); const h = d.getUTCHours();
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONS[d.getUTCMonth()]}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export const fmtTime = (ms: number) => fmtDateTime(ms).split(', ')[1]!;
export const monthLabel = (p: string) => { const [y, m] = p.split('-').map(Number); return `${MONS[m! - 1]} ${String(y).slice(2)}`; };
export const todayISO = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
export const thisMonth = () => todayISO().slice(0, 7);
export const addDaysISO = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : '';
};
/** Every phone number is shown with its country code: Indian numbers (stored as 10 digits) get +91, others keep their own +code. Same as shared/src/money.ts. */
export function formatPhone(phone?: string | null): string {
  const p = (phone ?? '').trim();
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const m = /^(?:91|0)?(\d{5})(\d{5})$/.exec(d);
  if (m && (!p.startsWith('+') || d.startsWith('91'))) return `+91 ${m[1]} ${m[2]}`;
  return p; // already has its own +code, or is not a phone number we can read
}

// ---------- tiny router (hash based) ----------
const hashPath = () => location.hash.replace(/^#/, '') || '/';
export function useRoute() {
  const [hash, setHash] = useState(hashPath);
  useEffect(() => { const f = () => setHash(hashPath()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return hash;
}
export const go = (path: string) => { location.hash = path; };

// ---------- who is signed in ----------
export interface Me {
  id: string; role: 'owner' | 'staff' | 'super_admin' | 'customer'; name: string; email: string | null; phone: string | null; ownerId: string | null;
  permissions: string[]; businessName: string | null; avatarUrl: string | null;
  /** The assistant's name as this person sees it, and their own pick (null = the business default). A label only. */
  aiName?: string; aiNameOwn?: string | null;
  /** A team member the owner marked "Read only": every screen opens, but the server refuses changes (READ_ONLY). */
  readOnly?: boolean;
}
// ---------- the assistant's display name ----------
// Platform AI is the core feature; what each person sees it called is their own pick (Profile › Preferences) or the business default
// (Settings). It is shown exactly as given ("Guppi", "Hey Guppi", "Ask AI"). Changing it changes labels only.
let AI_NAME = 'Ask AI';
export const setAiName = (n: string | undefined | null) => { if (n && n.trim()) AI_NAME = n.trim(); };
export const aiName = () => AI_NAME;
/** Owners and the super admin may do anything; staff need the named permission. */
export const can = (me: Me | null, perm?: string) => !!me && (!perm || me.role === 'owner' || me.role === 'super_admin' || me.permissions.includes(perm));
export const roleLabel = (me: Me) => (me.role === 'super_admin' ? 'Software owner' : me.role === 'owner' ? 'Owner' : 'Team');
