import { createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { hasPermission, isReadOnly, type UserRow } from './auth.ts';
import { Validator, normalizePhone } from './input.ts';
import { addDays, istDate, istMidnight, timeOfDay, MIN } from './time.ts';
import { availability, type GroundRow } from './grounds.ts';
import { readXlsx, writeXlsx, XlsxError, type Cell, type SheetSpec } from './accounting/xlsx.ts';
import { decodeText, defuse, parseCsv } from './accounting/csv.ts';
import { excelSerialToDate, parseDate } from './accounting/parse.ts';
import { seal, unseal, vaultOn } from './vault.ts';
import { registerIntegration, type Fetch } from './integrations.ts';
import './priceOnEnquiry.ts'; // the enquiry slot columns a booking request fills in

// The shared spreadsheet: one business keeps a workbook with people outside the desk (Antroli's owner, a manager, an accountant).
// Daji SENDS its own tabs (bookings, open slots, customers, payments) and READS one tab people type into ("Booking requests").
// Daji stays the authority: a row read from the sheet only ever lands in a review list; accepting it makes an ordinary enquiry,
// which is then booked through the normal flow (availability, price, approval). Nothing read from a sheet creates a booking or
// touches money. Everything is per business (owner_id): one business's link, sign-in and rows are invisible to another.
//
// Three ways to use it, all built in: download the workbook and upload it back (needs nothing outside), a Microsoft Excel workbook
// on OneDrive or SharePoint, or a Google Sheet. The last two need the platform's app registration (Settings › Connections) and then
// one sign-in by the business; until then they stay off and the rest of the suite works as before.

registerSchema('sheets-1', `
CREATE TABLE sheet_links (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'file' CHECK (provider IN ('file','excel','google')),
  account TEXT,
  refresh_token TEXT,
  file_ref TEXT,
  file_name TEXT,
  file_url TEXT,
  push_tabs TEXT NOT NULL DEFAULT '[]',
  pull_requests INTEGER NOT NULL DEFAULT 1,
  include_contacts INTEGER NOT NULL DEFAULT 0,
  auto_sync INTEGER NOT NULL DEFAULT 0,
  problem TEXT,
  connected_at INTEGER,
  connected_by TEXT,
  last_auto_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE sheet_oauth_states (
  state TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE sheet_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('push','pull')),
  via TEXT NOT NULL CHECK (via IN ('download','upload','excel','google')),
  ok INTEGER NOT NULL,
  counts TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  by_user TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX ix_sheet_runs_owner ON sheet_runs(owner_id, at);
CREATE TABLE sheet_inbox (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  line INTEGER NOT NULL,
  data TEXT NOT NULL,
  problems TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('waiting','invalid','accepted','rejected')),
  enquiry_id TEXT REFERENCES enquiries(id),
  reason TEXT,
  decided_by TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_sheet_inbox_row ON sheet_inbox(owner_id, row_key);
CREATE INDEX ix_sheet_inbox_owner ON sheet_inbox(owner_id, status, created_at);
`);

// Which of the business's grounds the sheet is about (a JSON list of ground ids; empty = every ground). A sheet kept with the people of one
// ground (Antroli) then never carries the bookings, customers or money of the business's other grounds.
registerSchema('sheets-2', `ALTER TABLE sheet_links ADD COLUMN ground_ids TEXT NOT NULL DEFAULT '[]';`);

// ------------------------------------------------------------------------------------------------ the platform side (Settings › Connections)

registerIntegration({
  id: 'sheet_excel', name: 'Shared spreadsheet: Microsoft Excel', what: 'Lets a business link an Excel workbook on OneDrive or SharePoint: Daji writes its bookings, open slots, customers and payments into it, and reads booking requests back for review.',
  setup: 'In Microsoft Entra (entra.microsoft.com) register an app for "Accounts in any organizational directory and personal Microsoft accounts", add the Web redirect address <API address>/api/sheets/oauth/callback, add the delegated permissions Files.ReadWrite, User.Read and offline_access, make a client secret, then put MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in the server settings (MICROSOFT_TENANT defaults to common). Each business then signs in from its own Shared spreadsheet card. Until then, download and upload still work.',
  env: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  have: (c) => ({ MICROSOFT_CLIENT_ID: !!c.sheets.microsoft.clientId, MICROSOFT_CLIENT_SECRET: !!c.sheets.microsoft.clientSecret }),
  // there is no free check of an app secret without a person signing in; each business's own "Check the link" is the live test
});
registerIntegration({
  id: 'sheet_google', name: 'Shared spreadsheet: Google Sheets', what: 'Lets a business link a Google Sheet: Daji writes its bookings, open slots, customers and payments into it, and reads booking requests back for review.',
  setup: 'In Google Cloud Console create an OAuth client (Web application), add the redirect address <API address>/api/sheets/oauth/callback, switch on the Google Sheets API, add the scope https://www.googleapis.com/auth/spreadsheets to the consent screen, then put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server settings. Each business then signs in from its own Shared spreadsheet card. Until then, download and upload still work.',
  env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  have: (c) => ({ GOOGLE_CLIENT_ID: !!c.sheets.google.clientId, GOOGLE_CLIENT_SECRET: !!c.sheets.google.clientSecret }),
});

// ------------------------------------------------------------------------------------------------ what goes where

export type Provider = 'file' | 'excel' | 'google';
export const PUSH_TABS = ['bookings', 'slots', 'customers', 'payments'] as const;
export type PushTab = typeof PUSH_TABS[number];
/** The tab names in the workbook. Daji owns the "Daji …" tabs and replaces them on every send; "Booking requests" belongs to the people using the sheet and Daji only reads it. */
export const TAB_NAMES: Record<PushTab | 'status' | 'about', string> = {
  bookings: 'Daji Bookings', slots: 'Daji Open slots', customers: 'Daji Customers', payments: 'Daji Payments', status: 'Daji Request status', about: 'About this sheet',
};
export const REQUESTS_TAB = 'Booking requests';
export const REQUEST_HEADERS = ['Date', 'Start time', 'Hours', 'Ground', 'Name', 'Phone', 'Players', 'Note'];
const TAB_LABEL: Record<PushTab, string> = { bookings: 'Bookings', slots: 'Open slots', customers: 'Customers', payments: 'Payments' };

/** How far each tab reaches, so a sheet stays a working list rather than the whole history. */
export const WINDOW = { bookingsBackDays: 30, bookingsAheadDays: 90, slotDays: 14, paymentsBackDays: 90, maxRows: 5000, maxPullRows: 500 };
const AUTO_EVERY_MS = 15 * MIN;
const STATE_TTL_MS = 10 * MIN;

interface LinkRow {
  owner_id: string; provider: Provider; account: string | null; refresh_token: string | null; file_ref: string | null; file_name: string | null; file_url: string | null;
  push_tabs: string; pull_requests: number; include_contacts: number; auto_sync: number; problem: string | null; connected_at: number | null; connected_by: string | null;
  last_auto_at: number | null; created_at: number; updated_at: number; updated_by: string | null; ground_ids: string;
}
const linkRow = (ownerId: string): LinkRow | undefined => one<LinkRow>('SELECT * FROM sheet_links WHERE owner_id = ?', ownerId);
const tabsOf = (r: LinkRow | undefined): PushTab[] => {
  if (!r) return ['bookings', 'slots'];
  try { const v: unknown = JSON.parse(r.push_tabs); return Array.isArray(v) ? PUSH_TABS.filter((t) => v.includes(t)) : []; } catch { return []; }
};

/** The business's active grounds this sheet covers: the chosen ones, or every one when none is chosen. A chosen ground that has since gone is dropped. */
function sheetGrounds(ownerId: string, r: LinkRow | undefined): GroundRow[] {
  const all = many<GroundRow>('SELECT * FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY name', ownerId);
  const chosen = safeJson<unknown>(r?.ground_ids ?? '[]', []);
  return Array.isArray(chosen) && chosen.length ? all.filter((g) => chosen.includes(g.id)) : all;
}
const chosenIds = (r: LinkRow | undefined): string[] => { const v = safeJson<unknown>(r?.ground_ids ?? '[]', []); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };

const providerReady = (cfg: Config, p: Provider): boolean =>
  p === 'excel' ? !!(cfg.sheets.microsoft.clientId && cfg.sheets.microsoft.clientSecret) : p === 'google' ? !!(cfg.sheets.google.clientId && cfg.sheets.google.clientSecret) : true;

// ------------------------------------------------------------------------------------------------ who may do what

/** Seeing the card and the review list: the owner, the software owner, and a team member who manages bookings. */
export function canSeeSheet(u: UserRow): boolean { return u.role === 'owner' || u.role === 'super_admin' || hasPermission(u, 'manage_bookings'); }
/** Linking, signing in, choosing what is sent: the owner (or the software owner for them). The link carries the business's data out. */
export function needOwner(u: UserRow): void { if (u.role !== 'owner' && u.role !== 'super_admin') throw forbidden('Only the owner can change the shared spreadsheet.'); }
export function needReview(u: UserRow): void {
  if (!canSeeSheet(u)) throw forbidden('This needs the "manage_bookings" permission');
  if (isReadOnly(u)) throw forbidden('Your login is read only.');
}
/** The tabs this person may receive in a download: payments need "Can see revenue", customers need "view_customers". */
function allowedTabs(u: UserRow | null, tabs: PushTab[]): PushTab[] {
  if (!u) return tabs;
  return tabs.filter((t) => t === 'payments' ? hasPermission(u, 'view_revenue') : t === 'customers' ? hasPermission(u, 'view_customers') : true);
}

// ------------------------------------------------------------------------------------------------ the card

export interface SheetRun { id: string; direction: 'push' | 'pull'; via: string; ok: boolean; counts: Record<string, number>; message: string; at: number }
export interface SheetView {
  provider: Provider; providers: { id: Provider; name: string; ready: boolean; note: string }[];
  connected: boolean; account: string | null; file: { name: string | null; url: string | null } | null; problem: string | null;
  pushTabs: PushTab[]; pullRequests: boolean; includeContacts: boolean; autoSync: boolean;
  /** Every ground of the business, and which ones the sheet covers (empty = all). */
  grounds: { id: string; name: string }[]; groundIds: string[];
  tabNames: Record<string, string>; requestsTab: string; requestHeaders: string[];
  inbox: { waiting: number; invalid: number; accepted: number; rejected: number };
  lastPush: SheetRun | null; lastPull: SheetRun | null; runs: SheetRun[]; canChange: boolean; vault: boolean;
}
const toRun = (r: any): SheetRun => ({ id: r.id, direction: r.direction, via: r.via, ok: !!r.ok, counts: safeJson(r.counts, {}), message: r.message, at: r.at });
function safeJson<T>(s: string | null, d: T): T { try { return s ? JSON.parse(s) as T : d; } catch { return d; } }

export function viewSheet(cfg: Config, u: UserRow, ownerId: string): SheetView {
  if (!canSeeSheet(u)) throw forbidden('This needs the "manage_bookings" permission');
  const r = linkRow(ownerId);
  const counts = Object.fromEntries(many<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM sheet_inbox WHERE owner_id = ? GROUP BY status', ownerId).map((x) => [x.status, x.n]));
  const runs = many('SELECT * FROM sheet_runs WHERE owner_id = ? ORDER BY at DESC, rowid DESC LIMIT 20', ownerId).map(toRun);
  const provider = r?.provider ?? 'file';
  return {
    provider,
    providers: [
      { id: 'file', name: 'Download and upload', ready: true, note: 'Works now with any spreadsheet: download the workbook, share it, and upload it back when it has booking requests.' },
      { id: 'excel', name: 'Microsoft Excel (OneDrive or SharePoint)', ready: providerReady(cfg, 'excel'), note: providerReady(cfg, 'excel') ? 'Sign in with the Microsoft account that can open the workbook.' : 'Not switched on for this platform yet. The software owner adds the Microsoft app settings in Settings › Connections.' },
      { id: 'google', name: 'Google Sheets', ready: providerReady(cfg, 'google'), note: providerReady(cfg, 'google') ? 'Sign in with the Google account that can open the sheet.' : 'Not switched on for this platform yet. The software owner adds the Google app settings in Settings › Connections.' },
    ],
    connected: provider !== 'file' && !!r?.refresh_token, account: provider !== 'file' ? r?.account ?? null : null,
    file: provider !== 'file' && r?.file_ref ? { name: r.file_name, url: r.file_url } : null, problem: r?.problem ?? null,
    pushTabs: allowedTabs(u, tabsOf(r)), pullRequests: r ? !!r.pull_requests : true, includeContacts: !!r?.include_contacts, autoSync: !!r?.auto_sync,
    grounds: many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY name', ownerId), groundIds: chosenIds(r).filter((id) => !!one('SELECT 1 FROM grounds WHERE id = ? AND owner_id = ? AND active = 1', id, ownerId)),
    tabNames: TAB_NAMES, requestsTab: REQUESTS_TAB, requestHeaders: REQUEST_HEADERS,
    inbox: { waiting: counts.waiting ?? 0, invalid: counts.invalid ?? 0, accepted: counts.accepted ?? 0, rejected: counts.rejected ?? 0 },
    lastPush: runs.find((x) => x.direction === 'push') ?? null, lastPull: runs.find((x) => x.direction === 'pull') ?? null, runs,
    canChange: u.role === 'owner' || u.role === 'super_admin', vault: vaultOn(),
  };
}

function ensureLink(ownerId: string, by: string | null): LinkRow {
  const t = now();
  run("INSERT INTO sheet_links(owner_id, push_tabs, created_at, updated_at, updated_by) VALUES (?,?,?,?,?) ON CONFLICT(owner_id) DO NOTHING", ownerId, JSON.stringify(['bookings', 'slots']), t, t, by);
  return linkRow(ownerId)!;
}

/** What is sent and read, and whether it runs by itself. Choosing another kind of sheet forgets the old sign-in. */
export function saveSheetSettings(cfg: Config, u: UserRow, ownerId: string, body: unknown): SheetView {
  needOwner(u);
  const v = new Validator(body);
  const provider = v.oneOf('provider', ['file', 'excel', 'google'] as const);
  const pushTabs = (body && typeof body === 'object' ? (body as Record<string, unknown>).pushTabs : undefined);
  const pull = v.bool('pullRequests');
  const contacts = v.bool('includeContacts');
  const auto = v.bool('autoSync');
  const groundIds = v.strArray('groundIds', { max: 50, itemMax: 60 });
  v.done();
  if (groundIds?.some((id) => !one('SELECT 1 FROM grounds WHERE id = ? AND owner_id = ?', id, ownerId)))
    throw new HttpError(400, 'VALIDATION_FAILED', 'Pick grounds of this business only', { fields: [{ field: 'groundIds', message: 'Not one of this business\'s grounds' }] });
  if (pushTabs !== undefined && (!Array.isArray(pushTabs) || pushTabs.some((t) => !(PUSH_TABS as readonly unknown[]).includes(t))))
    throw new HttpError(400, 'VALIDATION_FAILED', `pushTabs must be a list of: ${PUSH_TABS.join(', ')}`, { fields: [{ field: 'pushTabs', message: 'Unknown tab' }] });
  if (provider && provider !== 'file' && !providerReady(cfg, provider)) throw new HttpError(409, 'NOT_SET_UP', `${provider === 'excel' ? 'Microsoft Excel' : 'Google Sheets'} is not switched on for this platform yet. Use download and upload meanwhile.`);
  const cur = ensureLink(ownerId, u.id);
  const switching = provider !== undefined && provider !== cur.provider;
  const nextProvider = provider ?? cur.provider;
  if (auto && nextProvider === 'file') throw new HttpError(400, 'VALIDATION_FAILED', 'Sending by itself needs a linked Excel or Google sheet.', { fields: [{ field: 'autoSync', message: 'Link a sheet first' }] });
  const tabs = pushTabs !== undefined ? PUSH_TABS.filter((t) => (pushTabs as unknown[]).includes(t)) : tabsOf(cur);
  if (groundIds !== undefined) run('UPDATE sheet_links SET ground_ids = ? WHERE owner_id = ?', JSON.stringify([...new Set(groundIds)]), ownerId);
  run(`UPDATE sheet_links SET provider = ?, push_tabs = ?, pull_requests = ?, include_contacts = ?, auto_sync = ?, updated_at = ?, updated_by = ?
       ${switching ? ', account = NULL, refresh_token = NULL, file_ref = NULL, file_name = NULL, file_url = NULL, problem = NULL, connected_at = NULL, connected_by = NULL' : ''} WHERE owner_id = ?`,
    nextProvider, JSON.stringify(tabs), pull === undefined ? cur.pull_requests : pull ? 1 : 0, contacts === undefined ? cur.include_contacts : contacts ? 1 : 0,
    switching ? 0 : auto === undefined ? cur.auto_sync : auto ? 1 : 0, now(), u.id, ownerId);
  if (switching) dropToken(ownerId);
  audit({ id: u.id, role: u.role }, 'sheet.settings', 'sheet_link', ownerId, { provider: nextProvider, pushTabs: tabs, pullRequests: pull, includeContacts: contacts, autoSync: auto, groundIds }, ownerId);
  return viewSheet(cfg, u, ownerId);
}

// ------------------------------------------------------------------------------------------------ signing in (OAuth code flow)

const redirectUri = (cfg: Config): string => `${cfg.apiUrl.replace(/\/+$/, '')}/api/sheets/oauth/callback`;
const MS_SCOPE = 'offline_access Files.ReadWrite User.Read';
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/spreadsheets';

/** The address of the Microsoft or Google sign-in page for this business. The state ties the answer to this owner and this person, once, for ten minutes. */
export function startSignIn(cfg: Config, u: UserRow, ownerId: string): { url: string } {
  needOwner(u);
  const r = ensureLink(ownerId, u.id);
  if (r.provider === 'file') throw new HttpError(400, 'PICK_A_SHEET', 'Choose Microsoft Excel or Google Sheets first.');
  if (!providerReady(cfg, r.provider)) throw new HttpError(409, 'NOT_SET_UP', 'This kind of sheet is not switched on for the platform yet.');
  if (!vaultOn() && cfg.appEnv !== 'dev') throw new HttpError(409, 'VAULT_OFF', 'The server has no FIELD_KEY, so a sign-in could not be stored safely. Ask the software owner to set FIELD_KEY first.');
  const state = randomBytes(24).toString('base64url');
  const t = now();
  run('DELETE FROM sheet_oauth_states WHERE expires_at < ?', t);
  run('INSERT INTO sheet_oauth_states(state, owner_id, provider, user_id, expires_at) VALUES (?,?,?,?,?)', state, ownerId, r.provider, u.id, t + STATE_TTL_MS);
  audit({ id: u.id, role: u.role }, 'sheet.signin_start', 'sheet_link', ownerId, { provider: r.provider }, ownerId);
  if (r.provider === 'excel') {
    const m = cfg.sheets.microsoft;
    const q = new URLSearchParams({ client_id: m.clientId, response_type: 'code', redirect_uri: redirectUri(cfg), response_mode: 'query', scope: MS_SCOPE, state, prompt: 'select_account' });
    return { url: `${m.loginUrl}/${encodeURIComponent(m.tenant)}/oauth2/v2.0/authorize?${q}` };
  }
  const g = cfg.sheets.google;
  const q = new URLSearchParams({ client_id: g.clientId, response_type: 'code', redirect_uri: redirectUri(cfg), scope: GOOGLE_SCOPE, state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' });
  return { url: `${g.authUrl}?${q}` };
}

const snip = (t: string): string => { try { const j = JSON.parse(t); return String(j?.error_description ?? j?.error?.message ?? j?.error ?? '').slice(0, 160); } catch { return t.slice(0, 120); } };
const form = (o: Record<string, string>): string => new URLSearchParams(o).toString();

async function tokenCall(cfg: Config, provider: 'excel' | 'google', params: Record<string, string>, f: Fetch): Promise<{ access: string; refresh: string | null; expiresIn: number }> {
  const url = provider === 'excel' ? `${cfg.sheets.microsoft.loginUrl}/${encodeURIComponent(cfg.sheets.microsoft.tenant)}/oauth2/v2.0/token` : cfg.sheets.google.tokenUrl;
  const creds = provider === 'excel' ? { client_id: cfg.sheets.microsoft.clientId, client_secret: cfg.sheets.microsoft.clientSecret } : { client_id: cfg.sheets.google.clientId, client_secret: cfg.sheets.google.clientSecret };
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ ...creds, ...params }), signal: AbortSignal.timeout(15_000) });
  const text = await r.text();
  if (!r.ok) throw new SheetError(`${provider === 'excel' ? 'Microsoft' : 'Google'} refused the sign-in (${r.status}). ${snip(text)}`.trim(), r.status === 400 || r.status === 401);
  const j = safeJson<Record<string, unknown>>(text, {});
  if (typeof j.access_token !== 'string') throw new SheetError('The sign-in answer had no access token.');
  return { access: j.access_token, refresh: typeof j.refresh_token === 'string' ? j.refresh_token : null, expiresIn: Number(j.expires_in) || 3600 };
}

/** A failure talking to the sheet. `signIn` means the stored sign-in no longer works and the owner must sign in again. */
export class SheetError extends Error {
  readonly signIn: boolean;
  constructor(message: string, signIn = false) { super(message); this.signIn = signIn; }
}

/** Microsoft or Google sends the person back here. Returns where the desk should open, with a short word on what happened (never a token). */
export async function finishSignIn(cfg: Config, q: URLSearchParams, f: Fetch = fetch as unknown as Fetch): Promise<string> {
  const back = (result: string) => `/desk.html#/settings/connections/sheet-${result}`;
  const state = q.get('state') ?? '';
  const st = state ? one<{ owner_id: string; provider: 'excel' | 'google'; user_id: string; expires_at: number }>('SELECT * FROM sheet_oauth_states WHERE state = ?', state) : undefined;
  if (st) run('DELETE FROM sheet_oauth_states WHERE state = ?', state); // once only
  if (!st || st.expires_at < now()) return back('expired');
  const actor: Actor = { id: st.user_id, role: 'owner' };
  if (q.get('error') || !q.get('code')) { audit(actor, 'sheet.signin_refused', 'sheet_link', st.owner_id, { provider: st.provider, error: (q.get('error') ?? 'no_code').slice(0, 40) }, st.owner_id); return back('refused'); }
  const link = linkRow(st.owner_id);
  if (!link || link.provider !== st.provider) return back('expired');
  try {
    const tok = await tokenCall(cfg, st.provider, { grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: redirectUri(cfg), ...(st.provider === 'excel' ? { scope: MS_SCOPE } : {}) }, f);
    if (!tok.refresh) throw new SheetError('The sign-in did not allow offline access, so Daji could not keep it. Sign in again and accept every permission asked.');
    const who = await accountName(cfg, st.provider, tok.access, f);
    run('UPDATE sheet_links SET account = ?, refresh_token = ?, problem = NULL, connected_at = ?, connected_by = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?',
      who, seal(tok.refresh), now(), st.user_id, now(), st.user_id, st.owner_id);
    tokens.set(st.owner_id, { access: tok.access, until: now() + (tok.expiresIn - 60) * 1000 });
    audit(actor, 'sheet.signin', 'sheet_link', st.owner_id, { provider: st.provider }, st.owner_id);
    return back('connected');
  } catch (e) {
    const msg = e instanceof SheetError ? e.message : `Could not reach the sign-in service: ${(e as Error).message}`.slice(0, 200);
    run('UPDATE sheet_links SET problem = ?, updated_at = ? WHERE owner_id = ?', msg, now(), st.owner_id);
    audit(actor, 'sheet.signin_failed', 'sheet_link', st.owner_id, { provider: st.provider }, st.owner_id);
    return back('failed');
  }
}

async function accountName(cfg: Config, p: 'excel' | 'google', access: string, f: Fetch): Promise<string | null> {
  try {
    const r = p === 'excel'
      ? await f(`${cfg.sheets.microsoft.graphUrl}/v1.0/me?$select=userPrincipalName,mail,displayName`, { method: 'GET', headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) })
      : await f(cfg.sheets.google.userUrl, { method: 'GET', headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = safeJson<Record<string, unknown>>(await r.text(), {});
    const v = j.mail ?? j.userPrincipalName ?? j.email ?? j.displayName;
    return typeof v === 'string' ? v.slice(0, 120) : null;
  } catch { return null; }
}

/** Forgets the sign-in (the business can also remove Daji's access in its Microsoft or Google account). Settings and history stay. */
export function disconnectSheet(cfg: Config, u: UserRow, ownerId: string): SheetView {
  needOwner(u);
  run('UPDATE sheet_links SET account = NULL, refresh_token = NULL, file_ref = NULL, file_name = NULL, file_url = NULL, auto_sync = 0, problem = NULL, connected_at = NULL, connected_by = NULL, updated_at = ?, updated_by = ? WHERE owner_id = ?', now(), u.id, ownerId);
  dropToken(ownerId);
  audit({ id: u.id, role: u.role }, 'sheet.disconnect', 'sheet_link', ownerId, null, ownerId);
  return viewSheet(cfg, u, ownerId);
}

// access tokens live in memory only, for under an hour; the refresh token is sealed in the database
const tokens = new Map<string, { access: string; until: number }>();
function dropToken(ownerId: string): void { tokens.delete(ownerId); }
export function resetSheetTokens(): void { tokens.clear(); }

async function accessToken(cfg: Config, r: LinkRow, f: Fetch): Promise<string> {
  const have = tokens.get(r.owner_id);
  if (have && have.until > now()) return have.access;
  if (!r.refresh_token || r.provider === 'file') throw new SheetError('Not signed in. Sign in to the sheet first.', true);
  if (!providerReady(cfg, r.provider)) throw new SheetError('This kind of sheet has been switched off for the platform.');
  let refresh: string;
  try { refresh = unseal(r.refresh_token); } catch { throw new SheetError('The stored sign-in cannot be read (the server key changed). Sign in again.', true); }
  const tok = await tokenCall(cfg, r.provider, { grant_type: 'refresh_token', refresh_token: refresh, ...(r.provider === 'excel' ? { scope: MS_SCOPE } : {}) }, f);
  // Microsoft hands out a new refresh token each time; keep the newest
  if (tok.refresh && tok.refresh !== refresh) run('UPDATE sheet_links SET refresh_token = ? WHERE owner_id = ?', seal(tok.refresh), r.owner_id);
  tokens.set(r.owner_id, { access: tok.access, until: now() + (tok.expiresIn - 60) * 1000 });
  return tok.access;
}

// ------------------------------------------------------------------------------------------------ talking to the sheet

type Value = string | number | null;
/** `replace` clears Daji's own tab first; with clear false it only writes (the header row of a brand-new requests tab). */
interface SheetApi { tabs(): Promise<string[]>; addTab(name: string): Promise<void>; replace(name: string, rows: Value[][], clear?: boolean): Promise<void>; read(name: string): Promise<string[][]> }

async function call(f: Fetch, url: string, method: string, access: string, body?: unknown): Promise<any> {
  const r = await f(url, { method, headers: { Authorization: `Bearer ${access}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 401) throw new SheetError('The sheet refused the sign-in. Sign in again.', true);
    if (r.status === 403) throw new SheetError('The signed-in account cannot change this sheet. Share it with that account with edit rights, or sign in with another one.');
    if (r.status === 404) throw new SheetError('The sheet was not found. It may have been moved, deleted or unshared. Paste its link again.');
    if (r.status === 429) throw new SheetError('The sheet service asked Daji to slow down. It will try again later.');
    throw new SheetError(`The sheet service answered ${r.status}. ${snip(text)}`.trim());
  }
  return text ? safeJson<any>(text, {}) : {};
}

export function colLetter(n: number): string { let s = ''; for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; }

function excelApi(cfg: Config, fileRef: string, access: string, f: Fetch): SheetApi {
  const [driveId, itemId] = fileRef.split('/');
  const base = `${cfg.sheets.microsoft.graphUrl}/v1.0/drives/${encodeURIComponent(driveId!)}/items/${encodeURIComponent(itemId!)}/workbook`;
  const ws = (name: string) => `${base}/worksheets/${encodeURIComponent(name)}`;
  return {
    async tabs() { const j = await call(f, `${base}/worksheets?$select=name`, 'GET', access); return Array.isArray(j.value) ? j.value.map((w: any) => String(w.name)) : []; },
    async addTab(name) { await call(f, `${base}/worksheets/add`, 'POST', access, { name }); },
    async replace(name, rows, clear = true) {
      if (clear) await call(f, `${ws(name)}/range(address='A:Z')/clear`, 'POST', access, { applyTo: 'Contents' });
      if (!rows.length) return;
      const width = Math.max(...rows.map((r) => r.length));
      // Excel runs a cell that starts with = + - @ as a formula: text from the desk is defused, numbers stay numbers
      const values = rows.map((r) => Array.from({ length: width }, (_, i) => { const v = r[i] ?? ''; return typeof v === 'string' ? defuse(v) : v; }));
      await call(f, `${ws(name)}/range(address='A1:${colLetter(width)}${rows.length}')`, 'PATCH', access, { values });
    },
    async read(name) {
      const j = await call(f, `${ws(name)}/usedRange(valuesOnly=true)?$select=text,values`, 'GET', access);
      const grid: unknown[][] = Array.isArray(j.text) ? j.text : Array.isArray(j.values) ? j.values : [];
      return grid.map((r) => (Array.isArray(r) ? r : []).map((c) => (c === null || c === undefined ? '' : String(c))));
    },
  };
}

function googleApi(cfg: Config, id: string, access: string, f: Fetch): SheetApi {
  const base = `${cfg.sheets.google.sheetsUrl}/v4/spreadsheets/${encodeURIComponent(id)}`;
  const rng = (name: string, a = '') => encodeURIComponent(`'${name.replace(/'/g, "''")}'${a}`);
  return {
    async tabs() { const j = await call(f, `${base}?fields=sheets.properties.title`, 'GET', access); return Array.isArray(j.sheets) ? j.sheets.map((s: any) => String(s?.properties?.title ?? '')) : []; },
    async addTab(name) { await call(f, `${base}:batchUpdate`, 'POST', access, { requests: [{ addSheet: { properties: { title: name } } }] }); },
    async replace(name, rows, clear = true) {
      if (clear) await call(f, `${base}/values/${rng(name, '!A:Z')}:clear`, 'POST', access, {});
      if (!rows.length) return;
      // RAW: Google keeps every value as typed, so nothing written by Daji is ever run as a formula
      await call(f, `${base}/values/${rng(name, '!A1')}?valueInputOption=RAW`, 'PUT', access, { range: `'${name.replace(/'/g, "''")}'!A1`, majorDimension: 'ROWS', values: rows.map((r) => r.map((v) => v ?? '')) });
    },
    async read(name) {
      const j = await call(f, `${base}/values/${rng(name)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, 'GET', access);
      return (Array.isArray(j.values) ? j.values : []).map((r: unknown) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '')));
    },
  };
}

async function apiFor(cfg: Config, r: LinkRow, f: Fetch): Promise<SheetApi> {
  if (!r.file_ref) throw new SheetError('No sheet is linked yet. Paste the link of the workbook first.');
  const access = await accessToken(cfg, r, f);
  return r.provider === 'excel' ? excelApi(cfg, r.file_ref, access, f) : googleApi(cfg, r.file_ref, access, f);
}

/** Links one workbook by the address people use to open it: an Excel sharing link (OneDrive or SharePoint) or a Google Sheets address. Checks Daji can open it. */
export async function linkSheetFile(cfg: Config, u: UserRow, ownerId: string, body: unknown, f: Fetch = fetch as unknown as Fetch): Promise<SheetView> {
  needOwner(u);
  const v = new Validator(body);
  const url = v.str('url', { required: true, max: 2000 });
  v.done();
  const r = linkRow(ownerId);
  if (!r || r.provider === 'file') throw new HttpError(400, 'PICK_A_SHEET', 'Choose Microsoft Excel or Google Sheets first.');
  let parsed: URL;
  try { parsed = new URL(url!); } catch { throw new HttpError(400, 'VALIDATION_FAILED', 'Paste the full address of the sheet, starting with https://', { fields: [{ field: 'url', message: 'Not a web address' }] }); }
  if (parsed.protocol !== 'https:') throw new HttpError(400, 'VALIDATION_FAILED', 'The address must start with https://', { fields: [{ field: 'url', message: 'https only' }] });
  try {
    const access = await accessToken(cfg, r, f);
    let ref: string, name: string | null, webUrl: string | null;
    if (r.provider === 'excel') {
      if (!/(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms|live\.com|office\.com)$/i.test(parsed.hostname)) throw new SheetError('That is not a OneDrive or SharePoint link. In Excel press Share, then Copy link, and paste it here.');
      const share = 'u!' + Buffer.from(url!).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
      const item = await call(f, `${cfg.sheets.microsoft.graphUrl}/v1.0/shares/${share}/driveItem?$select=id,name,webUrl,parentReference,file`, 'GET', access);
      const driveId = item?.parentReference?.driveId;
      if (!item?.id || !driveId) throw new SheetError('Microsoft did not say which file that link opens.');
      name = typeof item.name === 'string' ? item.name.slice(0, 200) : null;
      if (!name || !/\.xlsx$/i.test(name)) throw new SheetError('That link opens something that is not an Excel workbook (.xlsx).');
      ref = `${driveId}/${item.id}`; webUrl = typeof item.webUrl === 'string' && item.webUrl.startsWith('https://') ? item.webUrl : null;
    } else {
      const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(parsed.pathname);
      if (parsed.hostname !== 'docs.google.com' || !m) throw new SheetError('That is not a Google Sheets address. Open the sheet and copy the address from the browser.');
      const j = await call(f, `${cfg.sheets.google.sheetsUrl}/v4/spreadsheets/${m[1]}?fields=properties.title`, 'GET', access);
      ref = m[1]!; name = typeof j?.properties?.title === 'string' ? j.properties.title.slice(0, 200) : null; webUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/edit`;
    }
    run('UPDATE sheet_links SET file_ref = ?, file_name = ?, file_url = ?, problem = NULL, updated_at = ?, updated_by = ? WHERE owner_id = ?', ref, name, webUrl, now(), u.id, ownerId);
    audit({ id: u.id, role: u.role }, 'sheet.link_file', 'sheet_link', ownerId, { provider: r.provider, name }, ownerId);
    return viewSheet(cfg, u, ownerId);
  } catch (e) {
    if (e instanceof SheetError) {
      if (e.signIn) run('UPDATE sheet_links SET problem = ? WHERE owner_id = ?', e.message, ownerId);
      throw new HttpError(e.signIn ? 409 : 400, e.signIn ? 'SIGN_IN_AGAIN' : 'SHEET_LINK_FAILED', e.message);
    }
    throw new HttpError(502, 'SHEET_UNREACHABLE', `Could not reach the sheet service: ${(e as Error).message}`.slice(0, 200));
  }
}

// ------------------------------------------------------------------------------------------------ building the tabs (out of Daji)

const rs = (paise: number): number => Math.round(paise) / 100;
const STATUS_WORD: Record<string, string> = { held: 'Held', confirmed: 'Confirmed', cancelled: 'Cancelled', expired: 'Expired', no_show: 'No-show', completed: 'Played' };

interface Grid { name: string; head: string[]; rows: Value[][]; money: number[] }

/** The rows of each tab, for one business only. Everything is read with `owner_id = ?`; nothing of another business can reach the sheet. */
export function buildTabs(ownerId: string, tabs: PushTab[], includeContacts: boolean, grounds: GroundRow[] = many<GroundRow>('SELECT * FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY name', ownerId)): Grid[] {
  const today = istDate(now());
  const out: Grid[] = [];
  // only the grounds the sheet covers; with none, every query below matches nothing
  const gids = grounds.map((g) => g.id);
  const inG = `IN (${gids.map(() => '?').join(',') || 'NULL'})`;
  if (tabs.includes('bookings')) {
    const rows = many<any>(`SELECT b.ref, b.date, b.start_at, b.end_at, g.name ground, b.format_label, u.name cname, u.phone, b.status, b.total_paise, b.paid_paise
      FROM bookings b JOIN grounds g ON g.id = b.ground_id JOIN users u ON u.id = b.customer_id
      WHERE b.owner_id = ? AND b.ground_id ${inG} AND b.deleted_at IS NULL AND b.date >= ? AND b.date <= ? AND b.status IN ('held','confirmed','completed','no_show','cancelled')
      ORDER BY b.start_at, b.ref LIMIT ?`, ownerId, ...gids, addDays(today, -WINDOW.bookingsBackDays), addDays(today, WINDOW.bookingsAheadDays), WINDOW.maxRows);
    out.push({ name: TAB_NAMES.bookings, money: includeContacts ? [9, 10, 11] : [8, 9, 10],
      head: ['Ref', 'Date', 'Start', 'End', 'Ground', 'Type', 'Customer', ...(includeContacts ? ['Phone'] : []), 'Status', 'Total (Rs)', 'Paid (Rs)', 'Balance (Rs)'],
      rows: rows.map((b) => [b.ref, b.date, timeOfDay(b.start_at), timeOfDay(b.end_at), b.ground, b.format_label ?? '', b.cname, ...(includeContacts ? [b.phone ?? ''] : []), STATUS_WORD[b.status] ?? b.status,
        rs(b.total_paise), rs(b.paid_paise), b.status === 'cancelled' || b.status === 'expired' ? 0 : rs(Math.max(0, b.total_paise - b.paid_paise))]) });
  }
  if (tabs.includes('slots')) {
    const rows: Value[][] = [];
    for (let d = 0; d < WINDOW.slotDays && rows.length < WINDOW.maxRows; d++) {
      const date = addDays(today, d);
      for (const g of grounds) for (const s of availability(g, date).slots) if (s.state === 'available') rows.push([date, g.name, s.time, timeOfDay(s.end), rs(s.pricePaise)]);
    }
    out.push({ name: TAB_NAMES.slots, head: ['Date', 'Ground', 'Start', 'End', 'Price (Rs)'], rows: rows.slice(0, WINDOW.maxRows), money: [4] });
  }
  if (tabs.includes('customers')) {
    const rows = many<any>(`SELECT u.name, u.phone, u.email, COUNT(*) n,
        MAX(CASE WHEN b.start_at <= ? THEN b.date END) last_on, MIN(CASE WHEN b.start_at > ? AND b.status IN ('held','confirmed') THEN b.date END) next_on
      FROM bookings b JOIN users u ON u.id = b.customer_id
      WHERE b.owner_id = ? AND b.ground_id ${inG} AND b.deleted_at IS NULL AND b.status IN ('held','confirmed','completed','no_show')
      GROUP BY u.id ORDER BY lower(u.name) LIMIT ?`, now(), now(), ownerId, ...gids, WINDOW.maxRows);
    out.push({ name: TAB_NAMES.customers, money: [],
      head: ['Name', ...(includeContacts ? ['Phone', 'Email'] : []), 'Bookings', 'Last played', 'Next booking'],
      rows: rows.map((c) => [c.name, ...(includeContacts ? [c.phone ?? '', c.email ?? ''] : []), c.n, c.last_on ?? '', c.next_on ?? '']) });
  }
  if (tabs.includes('payments')) {
    const rows = many<any>(`SELECT p.created_at, b.ref, u.name cname, p.method, p.purpose, p.status, p.amount_paise, p.refunded_paise
      FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN users u ON u.id = p.customer_id
      WHERE p.owner_id = ? AND b.ground_id ${inG} AND p.created_at >= ? AND p.status IN ('submitted','captured','refunded','partially_refunded','rejected')
      ORDER BY p.created_at, p.id LIMIT ?`, ownerId, ...gids, istMidnight(addDays(today, -WINDOW.paymentsBackDays)), WINDOW.maxRows);
    const PAY: Record<string, string> = { submitted: 'Waiting for a check', captured: 'Received', refunded: 'Refunded', partially_refunded: 'Part refunded', rejected: 'Rejected' };
    out.push({ name: TAB_NAMES.payments, money: [6, 7],
      head: ['Date', 'Booking', 'Customer', 'Method', 'For', 'Status', 'Amount (Rs)', 'Refunded (Rs)'],
      rows: rows.map((p) => [istDate(p.created_at), p.ref, p.cname, p.method === 'bank_transfer' ? 'Bank transfer' : p.method === 'razorpay' ? 'Online' : p.method.toUpperCase() === 'UPI' ? 'UPI' : p.method[0].toUpperCase() + p.method.slice(1),
        p.purpose === 'advance' ? 'Advance' : p.purpose === 'balance' ? 'Balance' : 'Full', PAY[p.status] ?? p.status, rs(p.amount_paise), rs(p.refunded_paise)]) });
  }
  return out;
}

/** What happened to each row read from "Booking requests", so the people on the sheet can see it was received. */
function statusGrid(ownerId: string, grounds: GroundRow[]): Grid {
  const gids = new Set(grounds.map((g) => g.id));
  // a row about another ground of the business stays off this sheet; a row whose ground could not be read is shown, as it came from this sheet
  const rows = many<any>('SELECT * FROM sheet_inbox WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500', ownerId).filter((r) => { const g = safeJson<Record<string, any>>(r.data, {}).groundId; return !g || gids.has(g); });
  const WORD: Record<string, string> = { waiting: 'Received, waiting for review', invalid: 'Not read: needs fixing', accepted: 'Accepted as an enquiry', rejected: 'Not taken' };
  return { name: TAB_NAMES.status, money: [], head: ['Read on', 'Line', 'Date asked', 'Start', 'Name', 'Status', 'Why'],
    rows: rows.map((r) => { const d = safeJson<Record<string, any>>(r.data, {}); return [istDate(r.created_at), r.line, d.date ?? d.rawDate ?? '', d.start ?? d.rawStart ?? '', d.name ?? '', WORD[r.status] ?? r.status, r.status === 'invalid' ? safeJson<string[]>(r.problems, []).join('; ') : r.reason ?? '']; }) };
}

const ABOUT_ROWS = (pull: boolean): Value[][] => [
  ['This workbook is kept by Daji.'],
  ['The tabs that start with "Daji" are written by Daji and replaced each time it sends. Changes typed into them are lost; change things in the desk instead.'],
  [pull ? `To ask for a booking, add a row to the "${REQUESTS_TAB}" tab. Daji reads it, checks it, and puts it in front of the ground's team. It becomes a booking only when the team books it, at the price and time Daji confirms.` : 'Booking requests are not read from this sheet.'],
  ['Dates as 2026-11-15 or 15/11/2026. Times as 18:00 or 6 pm. Phone as a 10-digit mobile number.'],
  ['Amounts are in rupees. Money is never changed from this sheet.'],
];

// ------------------------------------------------------------------------------------------------ sending (push)

const busy = new Set<string>();
async function exclusive<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(ownerId)) throw conflict('SHEET_BUSY', 'A sync with the sheet is already running for this business. Try again in a minute.');
  busy.add(ownerId);
  try { return await fn(); } finally { busy.delete(ownerId); }
}

function recordRun(ownerId: string, direction: 'push' | 'pull', via: SheetRun['via'], ok: boolean, counts: Record<string, number>, message: string, by: string | null): string {
  const id = newId('shr');
  run('INSERT INTO sheet_runs(id, owner_id, direction, via, ok, counts, message, by_user, at) VALUES (?,?,?,?,?,?,?,?,?)', id, ownerId, direction, via, ok ? 1 : 0, JSON.stringify(counts), message.slice(0, 400), by, now());
  return id;
}

/** The workbook to download: the business's own tabs, the request status, an empty "Booking requests" tab to fill in, and a note on how it works. */
export function downloadWorkbook(u: UserRow, ownerId: string): { data: Buffer; filename: string } {
  if (!canSeeSheet(u)) throw forbidden('This needs the "manage_bookings" permission');
  const r = linkRow(ownerId);
  const tabs = allowedTabs(u, tabsOf(r));
  const contacts = !!r?.include_contacts && hasPermission(u, 'view_customers');
  const pull = r ? !!r.pull_requests : true;
  const gs = sheetGrounds(ownerId, r);
  const grids = [...buildTabs(ownerId, tabs, contacts, gs), ...(pull ? [statusGrid(ownerId, gs)] : [])];
  const head = (h: string[]): Cell[] => h.map((v) => ({ v, s: 'header' as const }));
  const sheets: SheetSpec[] = [
    { name: TAB_NAMES.about, rows: ABOUT_ROWS(pull).map((r) => r.map((v) => ({ v, s: 'wrap' as const }))), widths: [110] },
    ...grids.map((g) => ({ name: g.name, freezeRows: 1, widths: g.head.map((h) => Math.max(10, Math.min(28, h.length + 6))),
      rows: [head(g.head), ...g.rows.map((row) => row.map((v, i): Cell => (g.money.includes(i) && typeof v === 'number' ? { v, s: 'money' } : v)))] })),
    ...(pull ? [{ name: REQUESTS_TAB, freezeRows: 1, widths: [14, 12, 8, 20, 22, 16, 10, 40], rows: [head(REQUEST_HEADERS)] }] : []),
  ];
  const data = writeXlsx(sheets, { creator: 'Daji' });
  recordRun(ownerId, 'push', 'download', true, Object.fromEntries(grids.map((g) => [g.name, g.rows.length])), `Downloaded ${grids.map((g) => `${g.name} (${g.rows.length})`).join(', ') || 'the request tab'}.`, u.id);
  audit({ id: u.id, role: u.role }, 'sheet.download', 'sheet_link', ownerId, { tabs, contacts, grounds: gs.map((g) => g.id) }, ownerId);
  return { data, filename: `daji-sheet-${istDate(now())}.xlsx` };
}

/** Writes the business's tabs into the linked Excel or Google sheet. Daji's tabs are replaced; "Booking requests" is created when missing and never cleared. */
export async function pushSheet(cfg: Config, actor: Actor, ownerId: string, f: Fetch = fetch as unknown as Fetch): Promise<SheetRun> {
  return exclusive(ownerId, async () => {
    const r = linkRow(ownerId);
    if (!r || r.provider === 'file') throw new HttpError(400, 'PICK_A_SHEET', 'No Excel or Google sheet is linked. Use Download meanwhile.');
    const tabs = tabsOf(r), pull = !!r.pull_requests;
    const gs = sheetGrounds(ownerId, r);
    const grids = [...buildTabs(ownerId, tabs, !!r.include_contacts, gs), ...(pull ? [statusGrid(ownerId, gs)] : [])];
    const via = r.provider;
    try {
      const api = await apiFor(cfg, r, f);
      const have = new Set((await api.tabs()).map((t) => t.toLowerCase()));
      const want: [string, Value[][]][] = [[TAB_NAMES.about, ABOUT_ROWS(pull)], ...grids.map((g): [string, Value[][]] => [g.name, [g.head, ...g.rows]])];
      for (const [name, rows] of want) { if (!have.has(name.toLowerCase())) await api.addTab(name); await api.replace(name, rows); }
      if (pull && !have.has(REQUESTS_TAB.toLowerCase())) { await api.addTab(REQUESTS_TAB); await api.replace(REQUESTS_TAB, [REQUEST_HEADERS], false); }
      run('UPDATE sheet_links SET problem = NULL WHERE owner_id = ?', ownerId);
      const counts = Object.fromEntries(grids.map((g) => [g.name, g.rows.length]));
      const id = recordRun(ownerId, 'push', via, true, counts, `Sent ${grids.map((g) => `${g.name} (${g.rows.length})`).join(', ') || 'the about tab'}.`, actor.id);
      audit(actor, 'sheet.push', 'sheet_link', ownerId, { via, counts }, ownerId);
      return toRun(one('SELECT * FROM sheet_runs WHERE id = ?', id));
    } catch (e) {
      const msg = e instanceof SheetError ? e.message : `Could not reach the sheet: ${(e as Error).message}`.slice(0, 200);
      run('UPDATE sheet_links SET problem = ? WHERE owner_id = ?', msg, ownerId);
      const id = recordRun(ownerId, 'push', via, false, {}, msg, actor.id);
      audit(actor, 'sheet.push_failed', 'sheet_link', ownerId, { via }, ownerId);
      return toRun(one('SELECT * FROM sheet_runs WHERE id = ?', id));
    }
  });
}

// ------------------------------------------------------------------------------------------------ reading (pull) into the review list

const HEAD: Record<string, RegExp> = {
  date: /^(date|day|booking date|play date)$/i,
  start: /^(start|start time|time|from|slot|slot time)$/i,
  hours: /^(hours?|hrs?|duration|slots?)$/i,
  ground: /^(ground|pitch|venue|turf|net)$/i,
  name: /^(name|customer|customer name|team|team name|booked by)$/i,
  phone: /^(phone|mobile|phone number|mobile number|contact|whatsapp)$/i,
  players: /^(players?|people|team size|no\.? of players)$/i,
  note: /^(note|notes|message|remarks?|comments?|details)$/i,
};

/** "18:00", "6 pm", "6.30pm", "18.00" or a spreadsheet time (0.75) → "HH:MM". */
export function readTime(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) { const m = Math.round(Number(s) * 1440); return m >= 0 && m < 1440 ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : null; }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] ?? 0); const ap = m[3]?.[0];
  if (mi > 59) return null;
  if (ap) { if (h < 1 || h > 12) return null; if (ap === 'p' && h !== 12) h += 12; if (ap === 'a' && h === 12) h = 0; }
  else if (!m[2]) return null; // a bare "6" could be 6 am or 6 pm
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
function readDay(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));
  return parseDate(s, 'dmy');
}

interface Parsed { line: number; data: Record<string, string | number | null>; problems: string[]; key: string }

/** Finds the requests tab (by name, else the first tab whose header row names a date, a time and a name) and checks each row. */
export function parseRequests(ownerId: string, grid: string[][]): { rows: Parsed[]; skipped: number; error: string | null } {
  const headAt = grid.findIndex((r) => r.some((c) => HEAD.date!.test(c.trim())) && r.some((c) => HEAD.name!.test(c.trim())));
  if (headAt < 0) return { rows: [], skipped: 0, error: `No header row with Date and Name was found. The "${REQUESTS_TAB}" tab starts with: ${REQUEST_HEADERS.join(', ')}.` };
  const head = grid[headAt]!.map((c) => c.trim());
  const col: Record<string, number> = {};
  for (const [k, re] of Object.entries(HEAD)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) col[k] = i; }
  const grounds = sheetGrounds(ownerId, linkRow(ownerId));
  const today = istDate(now());
  const rows: Parsed[] = [];
  let skipped = 0;
  for (let i = headAt + 1; i < grid.length; i++) {
    const r = grid[i]!;
    const cell = (k: string) => (col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim());
    if (!r.some((c) => String(c ?? '').trim())) continue; // blank line
    if (rows.length >= WINDOW.maxPullRows) { skipped++; continue; }
    const problems: string[] = [];
    const rawDate = cell('date'), rawStart = cell('start'), rawHours = cell('hours'), rawGround = cell('ground'), name = cell('name').replace(/\s+/g, ' '), rawPhone = cell('phone'), rawPlayers = cell('players'), note = cell('note').slice(0, 500);
    const date = readDay(rawDate);
    if (!rawDate) problems.push('Date is empty'); else if (!date) problems.push(`Date "${rawDate.slice(0, 20)}" is not a date`); else if (date < today) problems.push('Date has passed'); else if (date > addDays(today, 365)) problems.push('Date is more than a year ahead');
    const start = readTime(rawStart);
    if (!rawStart) problems.push('Start time is empty'); else if (!start) problems.push(`Start time "${rawStart.slice(0, 12)}" is not a time like 18:00 or 6 pm`);
    const hours = rawHours ? Number(rawHours) : 1;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 || Math.round(hours * 2) !== hours * 2) problems.push(`Hours "${rawHours.slice(0, 8)}" must be a number like 1, 2 or 1.5`);
    let ground: GroundRow | undefined;
    if (rawGround) { ground = grounds.find((g) => g.name.toLowerCase() === rawGround.toLowerCase()) ?? grounds.find((g) => g.name.toLowerCase().includes(rawGround.toLowerCase())); if (!ground) problems.push(`Ground "${rawGround.slice(0, 40)}" is not one of the grounds this sheet covers`); }
    else if (grounds.length === 1) ground = grounds[0];
    else problems.push(grounds.length ? 'Ground is empty and there is more than one' : 'This sheet covers no ground yet');
    if (name.length < 2) problems.push('Name is empty'); else if (name.length > 80) problems.push('Name is longer than 80 letters');
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!rawPhone) problems.push('Phone is empty'); else if (!phone) problems.push('Phone is not a 10-digit Indian mobile number');
    const players = rawPlayers ? Number(rawPlayers) : null;
    if (rawPlayers && (!Number.isInteger(players) || players! < 1 || players! > 500)) problems.push('Players must be a whole number from 1 to 500');
    const data = { date, start, hours: Number.isFinite(hours) ? hours : null, groundId: ground?.id ?? null, ground: ground?.name ?? (rawGround || null), name: name.slice(0, 80), phone, players: problems.some((p) => p.startsWith('Players')) ? null : players, note,
      ...(date ? {} : { rawDate: rawDate.slice(0, 20) }), ...(start ? {} : { rawStart: rawStart.slice(0, 12) }) };
    // the same request read twice is one row: what it asks for, not where it sits in the sheet
    const key = createHash('sha256').update(JSON.stringify([ownerId, date ?? rawDate, start ?? rawStart, data.hours, data.groundId ?? rawGround.toLowerCase(), name.toLowerCase(), phone ?? rawPhone, note])).digest('hex');
    rows.push({ line: i + 1, data, problems, key });
  }
  return { rows, skipped, error: null };
}

/** Stores the checked rows: new valid ones wait for review, new broken ones are kept with the reason so they are never silently lost. */
function storeRequests(ownerId: string, via: SheetRun['via'], actor: Actor, parsed: ReturnType<typeof parseRequests>): SheetRun {
  if (parsed.error) {
    const id = recordRun(ownerId, 'pull', via, false, {}, parsed.error, actor.id);
    return toRun(one('SELECT * FROM sheet_runs WHERE id = ?', id));
  }
  const runId = newId('shr');
  const counts = { read: parsed.rows.length, new: 0, invalid: 0, alreadySeen: 0, tooMany: parsed.skipped };
  tx(() => {
    for (const p of parsed.rows) {
      const res = run(`INSERT INTO sheet_inbox(id, owner_id, run_id, kind, row_key, line, data, problems, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id, row_key) DO NOTHING`,
        newId('shi'), ownerId, runId, 'booking_request', p.key, p.line, JSON.stringify(p.data), JSON.stringify(p.problems), p.problems.length ? 'invalid' : 'waiting', now());
      if (!res.changes) counts.alreadySeen++; else if (p.problems.length) counts.invalid++; else counts.new++;
    }
    const msg = `Read ${counts.read} row${counts.read === 1 ? '' : 's'}: ${counts.new} new to review, ${counts.invalid} with problems, ${counts.alreadySeen} already read${counts.tooMany ? `, ${counts.tooMany} left for next time (${WINDOW.maxPullRows} at a time)` : ''}.`;
    run('INSERT INTO sheet_runs(id, owner_id, direction, via, ok, counts, message, by_user, at) VALUES (?,?,?,?,?,?,?,?,?)', runId, ownerId, 'pull', via, 1, JSON.stringify(counts), msg, actor.id, now());
    audit(actor, 'sheet.pull', 'sheet_link', ownerId, { via, ...counts }, ownerId);
  });
  return toRun(one('SELECT * FROM sheet_runs WHERE id = ?', runId));
}

/** An uploaded copy of the workbook (or a CSV of the requests tab). It was virus-checked before this runs and is not kept. */
export function pullFromFile(u: UserRow, ownerId: string, filename: string, buf: Buffer): SheetRun {
  needReview(u);
  const r = linkRow(ownerId);
  if (r && !r.pull_requests) throw new HttpError(409, 'PULL_OFF', 'Reading booking requests from the sheet is switched off for this business.');
  if (!buf.length) throw new HttpError(400, 'VALIDATION_FAILED', 'The file is empty.');
  let grid: string[][];
  try {
    if (/\.csv$/i.test(filename) || !buf.subarray(0, 2).equals(Buffer.from('PK'))) grid = parseCsv(decodeText(buf)).rows;
    else {
      const sheets = readXlsx(buf).filter((s) => !s.hidden);
      const tab = sheets.find((s) => s.name.trim().toLowerCase() === REQUESTS_TAB.toLowerCase()) ?? sheets.find((s) => s.rows.some((row) => row.some((c) => HEAD.date!.test(String(c ?? '').trim())) && row.some((c) => HEAD.name!.test(String(c ?? '').trim()))) && !s.name.startsWith('Daji '));
      if (!tab) throw new HttpError(400, 'NO_REQUESTS_TAB', `The workbook has no "${REQUESTS_TAB}" tab.`);
      grid = tab.rows.map((row) => row.map((c) => String(c ?? '')));
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'BAD_FILE', e instanceof XlsxError ? e.message : 'The file could not be read as an Excel workbook or a CSV.');
  }
  return storeRequests(ownerId, 'upload', { id: u.id, role: u.role }, parseRequests(ownerId, grid));
}

/** Reads "Booking requests" from the linked Excel or Google sheet. */
export async function pullSheet(cfg: Config, actor: Actor, ownerId: string, f: Fetch = fetch as unknown as Fetch): Promise<SheetRun> {
  return exclusive(ownerId, async () => {
    const r = linkRow(ownerId);
    if (!r || r.provider === 'file') throw new HttpError(400, 'PICK_A_SHEET', 'No Excel or Google sheet is linked. Upload the workbook instead.');
    if (!r.pull_requests) throw new HttpError(409, 'PULL_OFF', 'Reading booking requests from the sheet is switched off for this business.');
    try {
      const api = await apiFor(cfg, r, f);
      const name = (await api.tabs()).find((t) => t.trim().toLowerCase() === REQUESTS_TAB.toLowerCase());
      if (!name) throw new SheetError(`The sheet has no "${REQUESTS_TAB}" tab yet. Press Send now once and Daji adds it.`);
      const out = storeRequests(ownerId, r.provider, actor, parseRequests(ownerId, await api.read(name)));
      run('UPDATE sheet_links SET problem = NULL WHERE owner_id = ?', ownerId);
      return out;
    } catch (e) {
      const msg = e instanceof SheetError ? e.message : `Could not reach the sheet: ${(e as Error).message}`.slice(0, 200);
      run('UPDATE sheet_links SET problem = ? WHERE owner_id = ?', msg, ownerId);
      const id = recordRun(ownerId, 'pull', r.provider, false, {}, msg, actor.id);
      audit(actor, 'sheet.pull_failed', 'sheet_link', ownerId, { via: r.provider }, ownerId);
      return toRun(one('SELECT * FROM sheet_runs WHERE id = ?', id));
    }
  });
}

// ------------------------------------------------------------------------------------------------ the review list

export interface InboxItem {
  id: string; line: number; status: string; problems: string[]; reason: string | null; enquiryId: string | null; createdAt: number; decidedAt: number | null;
  date: string | null; start: string | null; hours: number | null; groundId: string | null; ground: string | null; name: string; phone: string | null; players: number | null; note: string;
  /** Whether that time is free right now, by Daji's own calendar. Only a hint: the booking itself checks again. */
  free: boolean | null;
}
function toItem(r: any, withFree: boolean): InboxItem {
  const d = safeJson<Record<string, any>>(r.data, {});
  let free: boolean | null = null;
  if (withFree && r.status === 'waiting' && d.groundId && d.date && d.start) {
    const g = one<GroundRow>('SELECT * FROM grounds WHERE id = ? AND owner_id = ?', d.groundId, r.owner_id);
    if (g) {
      const slots = availability(g, d.date).slots, from = istMidnight(d.date) + (Number(d.start.slice(0, 2)) * 60 + Number(d.start.slice(3))) * MIN, to = from + (d.hours ?? 1) * 60 * MIN;
      const inside = slots.filter((s) => s.start >= from && s.start < to);
      free = inside.length > 0 && inside.length * g.slot_minutes * MIN >= to - from && inside.every((s) => s.state === 'available');
    }
  }
  return { id: r.id, line: r.line, status: r.status, problems: safeJson<string[]>(r.problems, []), reason: r.reason, enquiryId: r.enquiry_id, createdAt: r.created_at, decidedAt: r.decided_at,
    date: d.date ?? null, start: d.start ?? null, hours: d.hours ?? null, groundId: d.groundId ?? null, ground: d.ground ?? null, name: d.name ?? '', phone: d.phone ?? null, players: d.players ?? null, note: d.note ?? '', free };
}

export function listInbox(u: UserRow, ownerId: string, status?: string): { items: InboxItem[] } {
  if (!canSeeSheet(u)) throw forbidden('This needs the "manage_bookings" permission');
  if (status && !['waiting', 'invalid', 'accepted', 'rejected'].includes(status)) throw new HttpError(400, 'VALIDATION_FAILED', 'status must be waiting, invalid, accepted or rejected');
  const rows = many(`SELECT * FROM sheet_inbox WHERE owner_id = ? ${status ? 'AND status = ?' : ''} ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'invalid' THEN 1 ELSE 2 END, created_at DESC, line LIMIT 300`, ownerId, ...(status ? [status] : []));
  return { items: rows.map((r) => toItem(r, true)) };
}

function inboxRow(ownerId: string, id: string): any {
  const r = one('SELECT * FROM sheet_inbox WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r) throw notFound('That row is not in this business\'s list.');
  return r;
}

/** Accepting turns the row into an ordinary enquiry for this business. The team books it from there, with Daji's own availability, price and approval. */
export function acceptRequest(u: UserRow, ownerId: string, id: string): InboxItem {
  needReview(u);
  const actor: Actor = { id: u.id, role: u.role };
  return tx(() => {
    const r = inboxRow(ownerId, id);
    if (r.status !== 'waiting') throw conflict('ALREADY_DECIDED', r.status === 'invalid' ? 'This row has problems. Fix it in the sheet and read the sheet again.' : 'This row has already been handled.');
    const d = safeJson<Record<string, any>>(r.data, {});
    const g = d.groundId ? one<GroundRow>('SELECT * FROM grounds WHERE id = ? AND owner_id = ?', d.groundId, ownerId) : undefined;
    if (!g) throw conflict('GROUND_GONE', 'That ground is no longer one of this business\'s grounds.');
    if (!sheetGrounds(ownerId, linkRow(ownerId)).some((x) => x.id === g.id)) throw conflict('GROUND_NOT_ON_SHEET', 'This sheet no longer covers that ground. Reject this row, or add the ground back to the sheet.');
    if (d.date < istDate(now())) throw conflict('DATE_PASSED', 'The date asked for has passed. Reject this row.');
    const enqId = newId('enq'), t = now();
    const slots = Math.max(1, Math.round(((d.hours ?? 1) * 60) / g.slot_minutes));
    const message = `From the shared sheet (line ${r.line}): ${d.note || `${d.hours ?? 1} hour${(d.hours ?? 1) === 1 ? '' : 's'} from ${d.start}`}`.slice(0, 2000);
    run(`INSERT INTO enquiries(id, owner_id, ground_id, customer_id, name, phone, email, preferred_date, preferred_time, preferred_slots, preferred_label, move_booking_id, players, message, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?)`,
      enqId, ownerId, g.id, null, d.name, d.phone, null, d.date, d.start, slots, null, null, d.players ?? null, message, t, t);
    run("UPDATE sheet_inbox SET status = 'accepted', enquiry_id = ?, decided_by = ?, decided_at = ? WHERE id = ?", enqId, u.id, t, id);
    audit(actor, 'enquiry.create', 'enquiry', enqId, { groundId: g.id, source: 'sheet', sheetRow: id }, ownerId);
    audit(actor, 'sheet.accept', 'sheet_inbox', id, { enquiryId: enqId }, ownerId);
    return toItem(one('SELECT * FROM sheet_inbox WHERE id = ?', id), false);
  });
}

export function rejectRequest(u: UserRow, ownerId: string, id: string, body: unknown): InboxItem {
  needReview(u);
  const v = new Validator(body);
  const reason = v.str('reason', { max: 200 });
  v.done();
  const r = inboxRow(ownerId, id);
  if (r.status === 'accepted' || r.status === 'rejected') throw conflict('ALREADY_DECIDED', 'This row has already been handled.');
  const res = run("UPDATE sheet_inbox SET status = 'rejected', reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status IN ('waiting','invalid')", reason ?? null, u.id, now(), id);
  if (!res.changes) throw conflict('ALREADY_DECIDED', 'This row has already been handled.');
  audit({ id: u.id, role: u.role }, 'sheet.reject', 'sheet_inbox', id, { hadProblems: r.status === 'invalid' }, ownerId);
  return toItem(one('SELECT * FROM sheet_inbox WHERE id = ?', id), false);
}

// ------------------------------------------------------------------------------------------------ by itself

/** Every 15 minutes, for each business that switched it on: send, then read. A failure is recorded on the card and the next round tries again. */
export async function runSheetSync(cfg: Config, f: Fetch = fetch as unknown as Fetch, onError: (e: unknown) => void = () => {}): Promise<number> {
  const due = many<LinkRow>("SELECT * FROM sheet_links WHERE auto_sync = 1 AND provider IN ('excel','google') AND refresh_token IS NOT NULL AND file_ref IS NOT NULL AND (last_auto_at IS NULL OR last_auto_at <= ?)", now() - AUTO_EVERY_MS);
  let n = 0;
  for (const r of due) {
    if (!providerReady(cfg, r.provider)) continue;
    run('UPDATE sheet_links SET last_auto_at = ? WHERE owner_id = ?', now(), r.owner_id);
    try {
      await pushSheet(cfg, SYSTEM, r.owner_id, f);
      if (r.pull_requests) await pullSheet(cfg, SYSTEM, r.owner_id, f);
      n++;
    } catch (e) { onError(e); }
  }
  return n;
}

// ------------------------------------------------------------------------------------------------ for Platform AI

/** The shared spreadsheet as Platform AI sees it: whether it is linked, the last send and read, and the rows waiting. No phone numbers, no sign-in details. */
export function sheetSummary(ownerId: string, withNames: boolean) {
  const r = linkRow(ownerId);
  const runs = many('SELECT * FROM sheet_runs WHERE owner_id = ? ORDER BY at DESC, rowid DESC LIMIT 20', ownerId).map(toRun);
  const counts = Object.fromEntries(many<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM sheet_inbox WHERE owner_id = ? GROUP BY status', ownerId).map((x) => [x.status, x.n]));
  const waiting = many("SELECT * FROM sheet_inbox WHERE owner_id = ? AND status IN ('waiting','invalid') ORDER BY created_at DESC, line LIMIT 20", ownerId).map((x) => toItem(x, false));
  const provider = r?.provider ?? 'file';
  return {
    kind: provider === 'excel' ? 'Microsoft Excel' : provider === 'google' ? 'Google Sheets' : 'download and upload',
    linked: provider !== 'file' && !!r?.refresh_token && !!r?.file_ref, fileName: provider !== 'file' ? r?.file_name ?? null : null,
    grounds: sheetGrounds(ownerId, r).map((g) => g.name), sends: tabsOf(r).map((t) => TAB_LABEL[t]), readsBookingRequests: r ? !!r.pull_requests : true, sendsByItself: !!r?.auto_sync, problem: r?.problem ?? null,
    lastSend: runs.find((x) => x.direction === 'push') ?? null, lastRead: runs.find((x) => x.direction === 'pull') ?? null,
    requestsWaiting: counts.waiting ?? 0, requestsWithProblems: counts.invalid ?? 0, requestsAccepted: counts.accepted ?? 0, requestsRejected: counts.rejected ?? 0,
    rows: waiting.map((w) => ({ line: w.line, status: w.status === 'waiting' ? 'waiting for review' : 'has problems', date: w.date, start: w.start, ground: w.ground, ...(withNames ? { name: w.name } : {}), problems: w.problems })),
  };
}
