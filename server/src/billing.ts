import { createHash, createHmac } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { storeUpload } from './intake.ts';
import { audit, type Actor } from './audit.ts';
import { seal, unseal } from './vault.ts';
import { HttpError, conflict, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { istDate } from './time.ts';
import { MAX_ATTACHMENT_BYTES, sniff } from './accounting/books.ts';
import type { Config } from './config.ts';

// Software billing: what the platform costs to build and run. Every outside service (hosting, domain, website, payments, messages, AI, app stores) is a
// "service"; each bill from it is an "invoice". Where the service has an API (AWS, Anthropic, Razorpay) the invoices are fetched by themselves; the rest are
// entered by hand (with the PDF attached), and fixed fees (domain, plan) create an "expected" invoice on their due date to be confirmed. Only the software owner sees this.

registerSchema('billing-1', `
CREATE TABLE sw_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT,
  category TEXT NOT NULL CHECK (category IN ('hosting','domain','website','payments','messaging','banking','ai','app','tools','other')),
  cycle TEXT NOT NULL CHECK (cycle IN ('monthly','quarterly','yearly','usage','one_time')),
  currency TEXT NOT NULL CHECK (currency IN ('INR','USD')),
  expected_minor INTEGER NOT NULL DEFAULT 0,
  gst_percent REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','aws','anthropic','razorpay')),
  source_ref TEXT,
  next_due TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE sw_invoices (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES sw_services(id),
  period_from TEXT,
  period_to TEXT,
  invoice_no TEXT,
  invoice_date TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('INR','USD')),
  amount_minor INTEGER NOT NULL,
  gst_minor INTEGER NOT NULL DEFAULT 0,
  fx_rate REAL NOT NULL DEFAULT 1,
  inr_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected','due','paid')),
  paid_on TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','auto','recurring')),
  external_id TEXT,
  file_name TEXT,
  file_mime TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX ix_sw_invoices_date ON sw_invoices(invoice_date);
CREATE UNIQUE INDEX uq_sw_invoices_ext ON sw_invoices(service_id, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE sw_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
`);

type Fetcher = typeof fetch;

export const CATEGORIES = ['hosting', 'domain', 'website', 'payments', 'messaging', 'banking', 'ai', 'app', 'tools', 'other'] as const;
export const CYCLES = ['monthly', 'quarterly', 'yearly', 'usage', 'one_time'] as const;
const SOURCES = ['manual', 'aws', 'anthropic', 'razorpay'] as const;

/** The services this platform normally uses. Prices are left at 0 for the owner to fill from the real invoice; nothing here is a quote. */
export const CATALOG: { name: string; vendor: string; category: (typeof CATEGORIES)[number]; cycle: (typeof CYCLES)[number]; currency: 'INR' | 'USD'; gst: number; source: (typeof SOURCES)[number]; sourceRef?: string; notes: string }[] = [
  { name: 'Server (Lightsail)', vendor: 'Amazon Web Services', category: 'hosting', cycle: 'usage', currency: 'USD', gst: 0, source: 'aws', sourceRef: 'Amazon Lightsail', notes: 'The API server and database. Fetched from AWS Cost Explorer.' },
  { name: 'Domain dajicricket.com', vendor: 'Registrar', category: 'domain', cycle: 'yearly', currency: 'INR', gst: 18, source: 'manual', notes: 'Renewal date and price from the registrar invoice.' },
  { name: 'Website plan', vendor: 'Wix', category: 'website', cycle: 'yearly', currency: 'INR', gst: 18, source: 'manual', notes: 'The public website.' },
  { name: 'Payment fees', vendor: 'Razorpay', category: 'payments', cycle: 'usage', currency: 'INR', gst: 0, source: 'razorpay', notes: 'Fees and GST on each online payment, fetched from Razorpay.' },
  { name: 'WhatsApp messages', vendor: 'Meta', category: 'messaging', cycle: 'usage', currency: 'INR', gst: 18, source: 'manual', notes: 'Sign-in codes and reminders. Meta bills by conversation.' },
  { name: 'Text messages (SMS)', vendor: 'MSG91', category: 'messaging', cycle: 'usage', currency: 'INR', gst: 18, source: 'manual', notes: 'Backup sign-in codes.' },
  { name: 'Bank feed', vendor: 'Yodlee', category: 'banking', cycle: 'yearly', currency: 'USD', gst: 0, source: 'manual', notes: 'Contract price once signed.' },
  { name: 'Account Aggregator', vendor: 'Setu / Finvu', category: 'banking', cycle: 'usage', currency: 'INR', gst: 18, source: 'manual', notes: 'Per consent and per data fetch.' },
  { name: 'Ask AI', vendor: 'Anthropic', category: 'ai', cycle: 'usage', currency: 'USD', gst: 0, source: 'anthropic', notes: 'Fetched from the Anthropic cost report (needs an Admin key).' },
  { name: 'Apple Developer Program', vendor: 'Apple', category: 'app', cycle: 'yearly', currency: 'USD', gst: 0, source: 'manual', notes: 'Needed to publish the iPhone app.' },
  { name: 'Google Play developer account', vendor: 'Google', category: 'app', cycle: 'one_time', currency: 'USD', gst: 0, source: 'manual', notes: 'One-time registration.' },
  { name: 'Email (Google Workspace)', vendor: 'Google', category: 'tools', cycle: 'monthly', currency: 'INR', gst: 18, source: 'manual', notes: 'dajicricket@gmail.com is free; a business domain mailbox is not.' },
];

// ------------------------------------------------------------------ settings (keys are kept encrypted; they never go back to the browser)

const KEYS = ['anthropicAdminKey', 'awsAccessKeyId', 'awsSecretAccessKey'] as const;
const PLAIN = ['usdInr'] as const;

function setting(name: string): string {
  const r = one<{ value: string }>('SELECT value FROM sw_settings WHERE name = ?', name);
  if (!r) return '';
  try { return unseal(r.value); } catch { return ''; }
}
export const usdInr = (): number => { const v = Number(setting('usdInr')); return Number.isFinite(v) && v > 0 ? v : 85; };

export interface BillingSettingsView { usdInr: number; usdInrSet: boolean; keysSet: Record<string, boolean>; razorpay: boolean }
export function viewBillingSettings(cfg: Config): BillingSettingsView {
  return { usdInr: usdInr(), usdInrSet: !!setting('usdInr'), keysSet: Object.fromEntries(KEYS.map((k) => [k, !!setting(k)])), razorpay: !!(cfg.razorpay.keyId && cfg.razorpay.keySecret) };
}
export function saveBillingSettings(cfg: Config, actor: Actor, body: unknown): BillingSettingsView {
  const v = new Validator(body);
  const rate = v.num('usdInr', { min: 1, max: 1000 });
  const vals = new Map<string, string>();
  for (const k of KEYS) { const x = v.str(k, { max: 300 }); if (x) vals.set(k, x.trim()); }
  const clear = Array.isArray((body as { clear?: unknown })?.clear) ? (body as { clear: unknown[] }).clear.filter((x): x is string => typeof x === 'string' && (KEYS as readonly string[]).includes(x)) : [];
  v.done();
  if (rate !== undefined) vals.set('usdInr', String(rate));
  const t = now();
  for (const [name, value] of vals) run('INSERT INTO sw_settings(name, value, updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', name, seal(value), t);
  for (const c of clear) run('DELETE FROM sw_settings WHERE name = ?', c);
  audit(actor, 'billing.settings', 'sw_settings', null, { changed: [...vals.keys(), ...clear.map((c) => '-' + c)] });
  return viewBillingSettings(cfg);
}

// ------------------------------------------------------------------ services

export interface ServiceOut {
  id: string; name: string; vendor: string | null; category: string; cycle: string; currency: string; expectedMinor: number; gstPercent: number; source: string; sourceRef: string | null;
  nextDue: string | null; active: boolean; notes: string | null; invoices: number; totalInrPaise: number; lastInvoiceDate: string | null;
}
interface ServiceRow { id: string; name: string; vendor: string | null; category: string; cycle: string; currency: string; expected_minor: number; gst_percent: number; source: string; source_ref: string | null; next_due: string | null; active: number; notes: string | null; n: number; total: number; last: string | null }

export function listSwServices(): ServiceOut[] {
  return many<ServiceRow>(`SELECT s.*, (SELECT COUNT(*) FROM sw_invoices i WHERE i.service_id = s.id AND i.deleted_at IS NULL AND i.status <> 'expected') n,
      (SELECT COALESCE(SUM(i.inr_paise), 0) FROM sw_invoices i WHERE i.service_id = s.id AND i.deleted_at IS NULL AND i.status <> 'expected') total,
      (SELECT MAX(i.invoice_date) FROM sw_invoices i WHERE i.service_id = s.id AND i.deleted_at IS NULL) last
    FROM sw_services s WHERE s.deleted_at IS NULL ORDER BY s.active DESC, s.category, s.name`)
    .map((r) => ({ id: r.id, name: r.name, vendor: r.vendor, category: r.category, cycle: r.cycle, currency: r.currency, expectedMinor: r.expected_minor, gstPercent: r.gst_percent, source: r.source, sourceRef: r.source_ref,
      nextDue: r.next_due, active: !!r.active, notes: r.notes, invoices: r.n, totalInrPaise: r.total, lastInvoiceDate: r.last }));
}

function serviceBody(body: unknown, partial: boolean): { name?: string; vendor?: string; category?: string; cycle?: string; currency?: string; expectedMinor?: number; gstPercent?: number; source?: string; sourceRef?: string; nextDue?: string; active?: boolean; notes?: string } {
  const v = new Validator(body);
  const o = {
    name: v.str('name', { required: !partial, min: 2, max: 80 }), vendor: v.str('vendor', { max: 80 }),
    category: v.oneOf('category', CATEGORIES, !partial), cycle: v.oneOf('cycle', CYCLES, !partial), currency: v.oneOf('currency', ['INR', 'USD'] as const, !partial),
    expectedMinor: v.int('expectedMinor', { min: 0, max: 100_000_000_000 }), gstPercent: v.num('gstPercent', { min: 0, max: 28 }),
    source: v.oneOf('source', SOURCES), sourceRef: v.str('sourceRef', { max: 100 }), nextDue: v.date('nextDue'), active: v.bool('active'), notes: v.str('notes', { max: 500 }),
  };
  v.done();
  return o;
}

export function createSwService(actor: Actor, body: unknown): ServiceOut {
  const o = serviceBody(body, false);
  if (one('SELECT 1 FROM sw_services WHERE deleted_at IS NULL AND lower(name) = lower(?)', o.name!)) throw conflict('DUPLICATE', 'There is already a service with this name');
  const id = newId('sws'), t = now();
  run(`INSERT INTO sw_services(id, name, vendor, category, cycle, currency, expected_minor, gst_percent, source, source_ref, next_due, active, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, o.name!, o.vendor ?? null, o.category!, o.cycle!, o.currency!, o.expectedMinor ?? 0, o.gstPercent ?? 0, o.source ?? 'manual', o.sourceRef ?? null, o.nextDue ?? null, o.active === false ? 0 : 1, o.notes ?? null, t, t);
  audit(actor, 'billing.service.create', 'sw_service', id, { name: o.name });
  return listSwServices().find((s) => s.id === id)!;
}

export function updateSwService(actor: Actor, id: string, body: unknown): ServiceOut {
  const cur = one<ServiceRow>('SELECT *, 0 n, 0 total, NULL last FROM sw_services WHERE id = ? AND deleted_at IS NULL', id);
  if (!cur) throw notFound('Service not found');
  const o = serviceBody(body, true);
  const raw = (body ?? {}) as Record<string, unknown>;
  const clear = (k: string) => raw[k] === '' || raw[k] === null;
  if (o.name && o.name.toLowerCase() !== cur.name.toLowerCase() && one('SELECT 1 FROM sw_services WHERE deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?', o.name, id)) throw conflict('DUPLICATE', 'There is already a service with this name');
  run(`UPDATE sw_services SET name = ?, vendor = ?, category = ?, cycle = ?, currency = ?, expected_minor = ?, gst_percent = ?, source = ?, source_ref = ?, next_due = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?`,
    o.name ?? cur.name, clear('vendor') ? null : o.vendor ?? cur.vendor, o.category ?? cur.category, o.cycle ?? cur.cycle, o.currency ?? cur.currency, o.expectedMinor ?? cur.expected_minor, o.gstPercent ?? cur.gst_percent,
    o.source ?? cur.source, clear('sourceRef') ? null : o.sourceRef ?? cur.source_ref, clear('nextDue') ? null : o.nextDue ?? cur.next_due, o.active === undefined ? cur.active : o.active ? 1 : 0, clear('notes') ? null : o.notes ?? cur.notes, now(), id);
  audit(actor, 'billing.service.update', 'sw_service', id, { name: o.name ?? cur.name });
  return listSwServices().find((s) => s.id === id)!;
}

/** A service with invoices is only switched off (its history stays in the totals); one with none is removed. */
export function deleteSwService(actor: Actor, id: string): { removed: boolean } {
  const s = one<{ name: string }>('SELECT name FROM sw_services WHERE id = ? AND deleted_at IS NULL', id);
  if (!s) throw notFound('Service not found');
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM sw_invoices WHERE service_id = ? AND deleted_at IS NULL', id)!.n;
  if (n > 0) { run('UPDATE sw_services SET active = 0, updated_at = ? WHERE id = ?', now(), id); audit(actor, 'billing.service.deactivate', 'sw_service', id, { name: s.name }); return { removed: false }; }
  run('UPDATE sw_services SET deleted_at = ? WHERE id = ?', now(), id);
  audit(actor, 'billing.service.delete', 'sw_service', id, { name: s.name });
  return { removed: true };
}

export function addUsualServices(actor: Actor): { added: number } {
  let added = 0;
  for (const c of CATALOG) {
    if (one('SELECT 1 FROM sw_services WHERE deleted_at IS NULL AND lower(name) = lower(?)', c.name)) continue;
    const t = now();
    run(`INSERT INTO sw_services(id, name, vendor, category, cycle, currency, expected_minor, gst_percent, source, source_ref, active, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,0,?,?,?,1,?,?,?)`,
      newId('sws'), c.name, c.vendor, c.category, c.cycle, c.currency, c.gst, c.source, c.sourceRef ?? null, c.notes, t, t);
    added++;
  }
  if (added) audit(actor, 'billing.service.catalog', 'sw_service', null, { added });
  return { added };
}

// ------------------------------------------------------------------ invoices

export interface InvoiceOut {
  id: string; serviceId: string; serviceName: string; category: string; periodFrom: string | null; periodTo: string | null; invoiceNo: string | null; invoiceDate: string; currency: string;
  amountMinor: number; gstMinor: number; fxRate: number; inrPaise: number; status: string; paidOn: string | null; source: string; hasFile: boolean; fileName: string | null; notes: string | null;
}
interface InvRow { id: string; service_id: string; sname: string; category: string; period_from: string | null; period_to: string | null; invoice_no: string | null; invoice_date: string; currency: string; amount_minor: number; gst_minor: number; fx_rate: number; inr_paise: number; status: string; paid_on: string | null; source: string; file_name: string | null; notes: string | null }
const toInv = (r: InvRow): InvoiceOut => ({ id: r.id, serviceId: r.service_id, serviceName: r.sname, category: r.category, periodFrom: r.period_from, periodTo: r.period_to, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, currency: r.currency,
  amountMinor: r.amount_minor, gstMinor: r.gst_minor, fxRate: r.fx_rate, inrPaise: r.inr_paise, status: r.status, paidOn: r.paid_on, source: r.source, hasFile: !!r.file_name, fileName: r.file_name, notes: r.notes });
const INV_SELECT = `SELECT i.*, s.name sname, s.category FROM sw_invoices i JOIN sw_services s ON s.id = i.service_id WHERE i.deleted_at IS NULL`;

export function listInvoices(q: { serviceId?: string; from?: string; to?: string; status?: string } = {}, limit = 300): InvoiceOut[] {
  const where: string[] = [], p: unknown[] = [];
  if (q.serviceId) { where.push('i.service_id = ?'); p.push(q.serviceId); }
  if (q.from) { where.push('i.invoice_date >= ?'); p.push(q.from); }
  if (q.to) { where.push('i.invoice_date <= ?'); p.push(q.to); }
  if (q.status && ['expected', 'due', 'paid'].includes(q.status)) { where.push('i.status = ?'); p.push(q.status); }
  return many<InvRow>(`${INV_SELECT}${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT ?`, ...p, Math.min(Math.max(limit, 1), 1000)).map(toInv);
}

/** USD amounts are turned into rupees with the rate given, or the saved rate. Paise and cents are both hundredths, so the rate applies directly. */
export const toInr = (amountMinor: number, currency: string, fx: number): number => (currency === 'INR' ? amountMinor : Math.round(amountMinor * fx));

function invoiceBody(body: unknown, serviceId: string | undefined) {
  const v = new Validator(body);
  const o = {
    serviceId: serviceId ?? v.str('serviceId', { required: true, max: 60 }), invoiceNo: v.str('invoiceNo', { max: 60 }), invoiceDate: v.date('invoiceDate', true),
    periodFrom: v.date('periodFrom'), periodTo: v.date('periodTo'), amountMinor: v.int('amountMinor', { required: true, min: 0, max: 100_000_000_000 }),
    gstMinor: v.int('gstMinor', { min: 0, max: 100_000_000_000 }), fxRate: v.num('fxRate', { min: 1, max: 1000 }), status: v.oneOf('status', ['expected', 'due', 'paid'] as const), paidOn: v.date('paidOn'), notes: v.str('notes', { max: 500 }),
  };
  v.done();
  if (o.periodFrom && o.periodTo && o.periodTo < o.periodFrom) throw new HttpError(400, 'VALIDATION_FAILED', 'The period ends before it starts', { fields: [{ field: 'periodTo', message: 'Before the start' }] });
  return o;
}

export function createInvoice(actor: Actor, body: unknown): InvoiceOut {
  const o = invoiceBody(body, undefined);
  const s = one<{ currency: string; gst_percent: number }>('SELECT currency, gst_percent FROM sw_services WHERE id = ? AND deleted_at IS NULL', o.serviceId!);
  if (!s) throw notFound('Service not found');
  const fx = s.currency === 'USD' ? o.fxRate ?? usdInr() : 1;
  const gst = o.gstMinor ?? Math.round(o.amountMinor! * s.gst_percent / 100);
  const status = o.status ?? (o.paidOn ? 'paid' : 'due');
  const id = newId('swi'), t = now();
  run(`INSERT INTO sw_invoices(id, service_id, period_from, period_to, invoice_no, invoice_date, currency, amount_minor, gst_minor, fx_rate, inr_paise, status, paid_on, source, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, o.serviceId!, o.periodFrom ?? null, o.periodTo ?? null, o.invoiceNo ?? null, o.invoiceDate!, s.currency, o.amountMinor!, gst, fx, toInr(o.amountMinor! + gst, s.currency, fx), status, status === 'paid' ? o.paidOn ?? o.invoiceDate! : null, 'manual', o.notes ?? null, t, t);
  audit(actor, 'billing.invoice.create', 'sw_invoice', id, { serviceId: o.serviceId, amountMinor: o.amountMinor });
  return listInvoices().find((i) => i.id === id) ?? toInv(one<InvRow>(`${INV_SELECT} AND i.id = ?`, id)!);
}

export function updateInvoice(actor: Actor, id: string, body: unknown): InvoiceOut {
  const cur = one<InvRow & { gst_percent: number }>(`SELECT i.*, s.name sname, s.category, s.gst_percent FROM sw_invoices i JOIN sw_services s ON s.id = i.service_id WHERE i.id = ? AND i.deleted_at IS NULL`, id);
  if (!cur) throw notFound('Invoice not found');
  const o = invoiceBody({ serviceId: cur.service_id, invoiceDate: cur.invoice_date, amountMinor: cur.amount_minor, ...(body as object) }, cur.service_id);
  const fx = cur.currency === 'USD' ? o.fxRate ?? cur.fx_rate : 1;
  const status = o.status ?? (o.paidOn ? 'paid' : cur.status === 'expected' ? 'due' : cur.status);
  const gst = (body as Record<string, unknown>)?.gstMinor !== undefined ? o.gstMinor! : (o.amountMinor !== cur.amount_minor ? Math.round(o.amountMinor! * cur.gst_percent / 100) : cur.gst_minor);
  run(`UPDATE sw_invoices SET invoice_no = ?, invoice_date = ?, period_from = ?, period_to = ?, amount_minor = ?, gst_minor = ?, fx_rate = ?, inr_paise = ?, status = ?, paid_on = ?, notes = ?, updated_at = ? WHERE id = ?`,
    o.invoiceNo ?? cur.invoice_no, o.invoiceDate!, o.periodFrom ?? cur.period_from, o.periodTo ?? cur.period_to, o.amountMinor!, gst, fx, toInr(o.amountMinor! + gst, cur.currency, fx), status,
    status === 'paid' ? o.paidOn ?? cur.paid_on ?? istDate(now()) : null, o.notes ?? cur.notes, now(), id);
  audit(actor, 'billing.invoice.update', 'sw_invoice', id, { status, amountMinor: o.amountMinor });
  return toInv(one<InvRow>(`${INV_SELECT} AND i.id = ?`, id)!);
}

export function deleteInvoice(dataDir: string, actor: Actor, id: string): void {
  const cur = one<{ file_name: string | null; source: string }>('SELECT file_name, source FROM sw_invoices WHERE id = ? AND deleted_at IS NULL', id);
  if (!cur) throw notFound('Invoice not found');
  run('UPDATE sw_invoices SET deleted_at = ? WHERE id = ?', now(), id);
  if (cur.file_name) try { rmSync(filePath(dataDir, id)); } catch { /* already gone */ }
  audit(actor, 'billing.invoice.delete', 'sw_invoice', id, { source: cur.source });
}

const filePath = (dataDir: string, id: string): string => join(dataDir, 'uploads', '_software', id.replace(/[^\w-]/g, ''));

export function attachInvoiceFile(dataDir: string, actor: Actor, id: string, filename: string, buf: Buffer): InvoiceOut {
  if (!one('SELECT 1 FROM sw_invoices WHERE id = ? AND deleted_at IS NULL', id)) throw notFound('Invoice not found');
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB.');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'FILE_TYPE_NOT_ALLOWED', 'Only PDF, PNG, JPEG and WebP files can be attached.');
  const base = filename.replace(/[\\/]/g, '_').replace(/[^\w .()\-]/g, '_').slice(0, 80).trim() || 'invoice';
  const name = /\.(pdf|png|jpe?g|webp)$/i.test(base) ? base : `${base}.${kind.ext}`;
  storeUpload({
    dataDir, buf, finalPath: filePath(dataDir, id), purpose: 'invoice', actor, versioned: true,
    writeMetadata: () => {
      run('UPDATE sw_invoices SET file_name = ?, file_mime = ?, updated_at = ? WHERE id = ?', name, kind.mime, now(), id);
      audit(actor, 'billing.invoice.file', 'sw_invoice', id, { bytes: buf.length });
    },
  });
  return toInv(one<InvRow>(`${INV_SELECT} AND i.id = ?`, id)!);
}

export function readInvoiceFile(dataDir: string, id: string): { data: Buffer; name: string; mime: string } {
  const r = one<{ file_name: string | null; file_mime: string | null }>('SELECT file_name, file_mime FROM sw_invoices WHERE id = ? AND deleted_at IS NULL', id);
  if (!r?.file_name) throw notFound('No file attached');
  return { data: readFileSync(filePath(dataDir, id)), name: r.file_name, mime: r.file_mime ?? 'application/octet-stream' };
}

// ------------------------------------------------------------------ the cost picture

export interface CostSummary {
  thisMonthPaise: number; last12MonthsPaise: number; yearlyRunRatePaise: number; oneTimePaise: number; tillDatePaise: number; gstPaise: number; expectedNextPaise: number;
  perBookingPaise: number | null; bookingsLast12: number;
  months: { month: string; totalPaise: number; byCategory: Record<string, number> }[];
  byService: { id: string; name: string; category: string; last12Paise: number; sharePercent: number }[];
  byCategory: { category: string; last12Paise: number }[];
  dueNow: InvoiceOut[];
}

const addMonths = (m: string, n: number): string => { const [y, mo] = m.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/** What the software costs, in rupees. Expected (not yet confirmed) invoices are shown but kept out of the totals. */
export function costSummary(): CostSummary {
  const today = istDate(now()), thisMonth = today.slice(0, 7), first = addMonths(thisMonth, -11);
  const rows = many<{ m: string; cat: string; sid: string; sname: string; cycle: string; inr: number; gst: number; fx: number; cur: string }>(
    `SELECT substr(i.invoice_date, 1, 7) m, s.category cat, s.id sid, s.name sname, s.cycle, i.inr_paise inr, i.gst_minor gst, i.fx_rate fx, i.currency cur
     FROM sw_invoices i JOIN sw_services s ON s.id = i.service_id WHERE i.deleted_at IS NULL AND i.status <> 'expected'`);
  const months: CostSummary['months'] = [];
  for (let k = 0; k < 12; k++) months.push({ month: addMonths(first, k), totalPaise: 0, byCategory: {} });
  const idx = new Map(months.map((m, i) => [m.month, i]));
  const svc = new Map<string, { id: string; name: string; category: string; last12Paise: number }>();
  let last12 = 0, oneTime = 0, till = 0, gst = 0, thisM = 0;
  for (const r of rows) {
    till += r.inr; gst += Math.round(r.gst * (r.cur === 'USD' ? r.fx : 1));
    if (r.cycle === 'one_time') oneTime += r.inr;
    const at = idx.get(r.m);
    if (at !== undefined) {
      months[at]!.totalPaise += r.inr; months[at]!.byCategory[r.cat] = (months[at]!.byCategory[r.cat] ?? 0) + r.inr; last12 += r.inr;
      const s = svc.get(r.sid) ?? { id: r.sid, name: r.sname, category: r.cat, last12Paise: 0 }; s.last12Paise += r.inr; svc.set(r.sid, s);
    }
    if (r.m === thisMonth) thisM += r.inr;
  }
  const byService = [...svc.values()].sort((a, b) => b.last12Paise - a.last12Paise).map((s) => ({ ...s, sharePercent: last12 ? Math.round((s.last12Paise / last12) * 1000) / 10 : 0 }));
  const cats = new Map<string, number>(); for (const s of byService) cats.set(s.category, (cats.get(s.category) ?? 0) + s.last12Paise);
  // run rate: what the fixed plans cost over a year, plus the average monthly usage bills
  const fx = usdInr();
  let fixedYear = 0;
  for (const s of listSwServices().filter((x) => x.active && x.cycle !== 'usage' && x.cycle !== 'one_time')) {
    const per = toInr(s.expectedMinor + Math.round(s.expectedMinor * s.gstPercent / 100), s.currency, fx);
    fixedYear += per * (s.cycle === 'monthly' ? 12 : s.cycle === 'quarterly' ? 4 : 1);
  }
  const usageYear = [...svc.values()].filter((s) => listSwServices().find((x) => x.id === s.id)?.cycle === 'usage').reduce((a, s) => a + s.last12Paise, 0);
  const nextExpected = many<{ p: number }>(`SELECT i.inr_paise p FROM sw_invoices i WHERE i.deleted_at IS NULL AND i.status = 'expected'`).reduce((a, r) => a + r.p, 0);
  const b12 = one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE status IN ('confirmed','completed') AND date >= ? AND date <= ?`, `${first}-01`, today)!.n;
  return {
    thisMonthPaise: thisM, last12MonthsPaise: last12, yearlyRunRatePaise: fixedYear + usageYear, oneTimePaise: oneTime, tillDatePaise: till, gstPaise: gst, expectedNextPaise: nextExpected,
    perBookingPaise: b12 > 0 ? Math.round(last12 / b12) : null, bookingsLast12: b12, months, byService, byCategory: [...cats].map(([category, last12Paise]) => ({ category, last12Paise })).sort((a, b) => b.last12Paise - a.last12Paise),
    dueNow: listInvoices({ status: 'due' }, 50),
  };
}

// ------------------------------------------------------------------ expected invoices for fixed fees

const stepDue = (d: string, cycle: string): string => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; const n = cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : 12; const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`; };

/** When a fixed fee falls due, an "expected" invoice is made for it so it is not forgotten. The owner confirms it (and the real amount) when the bill arrives. */
export function makeExpectedInvoices(today = istDate(now())): number {
  let n = 0;
  for (const s of many<{ id: string; cycle: string; currency: string; expected_minor: number; gst_percent: number; next_due: string }>(
    `SELECT id, cycle, currency, expected_minor, gst_percent, next_due FROM sw_services WHERE deleted_at IS NULL AND active = 1 AND next_due IS NOT NULL AND next_due <= ? AND cycle IN ('monthly','quarterly','yearly') AND source = 'manual'`, today)) {
    let due = s.next_due, guard = 0;
    while (due <= today && guard++ < 24) {
      const gst = Math.round(s.expected_minor * s.gst_percent / 100), fx = s.currency === 'USD' ? usdInr() : 1, t = now();
      if (s.expected_minor > 0) {
        const r = run(`INSERT OR IGNORE INTO sw_invoices(id, service_id, period_from, invoice_date, currency, amount_minor, gst_minor, fx_rate, inr_paise, status, source, external_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          newId('swi'), s.id, due, due, s.currency, s.expected_minor, gst, fx, toInr(s.expected_minor + gst, s.currency, fx), 'expected', 'recurring', `due:${due}`, t, t);
        n += r.changes;
      }
      due = stepDue(due, s.cycle);
    }
    run('UPDATE sw_services SET next_due = ?, updated_at = ? WHERE id = ?', due, now(), s.id);
  }
  return n;
}

// ------------------------------------------------------------------ fetching invoices from the services that have an API

const monthEnd = (m: string): string => { const [y, mo] = m.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const lastMonths = (n: number): string[] => { const cur = istDate(now()).slice(0, 7); return Array.from({ length: n }, (_, k) => addMonths(cur, k - (n - 1))); };

/** Adds or refreshes the invoice for one service and month. The running month is "expected" (an estimate that changes); finished months are "due". A paid invoice is never changed. */
function upsertAuto(serviceId: string, month: string, currency: 'INR' | 'USD', amountMinor: number, gstMinor: number, detail: string): 'added' | 'updated' | 'same' | 'skipped' {
  const ext = `auto:${month}`, today = istDate(now()), running = month === today.slice(0, 7);
  const cur = one<{ id: string; status: string; amount_minor: number; gst_minor: number }>('SELECT id, status, amount_minor, gst_minor FROM sw_invoices WHERE service_id = ? AND external_id = ? AND deleted_at IS NULL', serviceId, ext);
  const fx = currency === 'USD' ? usdInr() : 1, status = running ? 'expected' : 'due', t = now();
  if (cur) {
    if (cur.status === 'paid') return 'skipped';
    if (cur.amount_minor === amountMinor && cur.gst_minor === gstMinor && cur.status === status) return 'same';
    run('UPDATE sw_invoices SET amount_minor = ?, gst_minor = ?, fx_rate = ?, inr_paise = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?', amountMinor, gstMinor, fx, toInr(amountMinor + gstMinor, currency, fx), status, detail, t, cur.id);
    return 'updated';
  }
  if (amountMinor === 0 && gstMinor === 0) return 'skipped';
  run(`INSERT INTO sw_invoices(id, service_id, period_from, period_to, invoice_date, currency, amount_minor, gst_minor, fx_rate, inr_paise, status, source, external_id, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newId('swi'), serviceId, `${month}-01`, running ? today : monthEnd(month), running ? today : monthEnd(month), currency, amountMinor, gstMinor, fx, toInr(amountMinor + gstMinor, currency, fx), status, 'auto', ext, detail, t, t);
  return 'added';
}

/** Anthropic cost report (needs an Admin key): USD for the month, in cents. */
export async function fetchAnthropicMonth(key: string, month: string, f: Fetcher = fetch): Promise<number> {
  let cents = 0, page: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const u = new URL('https://api.anthropic.com/v1/organizations/cost_report');
    u.searchParams.set('starting_at', `${month}-01T00:00:00Z`); u.searchParams.set('ending_at', `${addMonths(month, 1)}-01T00:00:00Z`); u.searchParams.set('bucket_width', '1d'); u.searchParams.set('limit', '31');
    if (page) u.searchParams.set('page', page);
    const res = await f(u, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new HttpError(502, 'BILLING_SOURCE', `Anthropic answered ${res.status}. Check the Admin key (it starts with sk-ant-admin).`);
    const j = await res.json() as { data?: { results?: { amount?: string | number }[] }[]; has_more?: boolean; next_page?: string };
    for (const b of j.data ?? []) for (const r of b.results ?? []) cents += Number(r.amount) || 0;
    if (!j.has_more || !j.next_page) break;
    page = j.next_page;
  }
  return Math.round(cents);
}

// AWS Signature Version 4, for Cost Explorer.
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string): Buffer => createHmac('sha256', k).update(s).digest();
export function signAws(o: { method: string; host: string; path: string; query?: string; headers: Record<string, string>; body: string; region: string; service: string; accessKey: string; secret: string; amzDate: string; sessionToken?: string }): string {
  const h: Record<string, string> = { ...o.headers, host: o.host, 'x-amz-date': o.amzDate }; if (o.sessionToken) h['x-amz-security-token'] = o.sessionToken;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const canon = [o.method, o.path, o.query ?? '', names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), sha(o.body)].join('\n');
  const day = o.amzDate.slice(0, 8), scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', o.amzDate, scope, sha(canon)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + o.secret, day), o.region), o.service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', key).update(sts).digest('hex')}`;
}

/** AWS Cost Explorer: the month's unblended cost in USD cents, for one AWS service name (or the whole account when none is given). */
export async function fetchAwsMonth(keys: { id: string; secret: string }, month: string, awsService: string | null, f: Fetcher = fetch): Promise<number> {
  const host = 'ce.us-east-1.amazonaws.com', amzDate = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = JSON.stringify({ TimePeriod: { Start: `${month}-01`, End: `${addMonths(month, 1)}-01` }, Granularity: 'MONTHLY', Metrics: ['UnblendedCost'], ...(awsService ? { Filter: { Dimensions: { Key: 'SERVICE', Values: [awsService] } } } : {}) });
  const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSInsightsIndexService.GetCostAndUsage' };
  const auth = signAws({ method: 'POST', host, path: '/', headers, body, region: 'us-east-1', service: 'ce', accessKey: keys.id, secret: keys.secret, amzDate });
  const res = await f(`https://${host}/`, { method: 'POST', headers: { ...headers, 'x-amz-date': amzDate, Authorization: auth }, body, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new HttpError(502, 'BILLING_SOURCE', `AWS answered ${res.status}. Check the access key (it needs ce:GetCostAndUsage).`);
  const j = await res.json() as { ResultsByTime?: { Total?: { UnblendedCost?: { Amount?: string } } }[] };
  return Math.round((j.ResultsByTime ?? []).reduce((a, r) => a + (Number(r.Total?.UnblendedCost?.Amount) || 0), 0) * 100);
}

/** Razorpay's own fee and GST on each payment of the month, in paise, from the payments API. */
export async function fetchRazorpayMonth(cfg: Config, month: string, f: Fetcher = fetch): Promise<{ fee: number; tax: number; payments: number }> {
  const from = Math.floor(Date.parse(`${month}-01T00:00:00+05:30`) / 1000), to = Math.floor(Date.parse(`${addMonths(month, 1)}-01T00:00:00+05:30`) / 1000) - 1;
  const auth = 'Basic ' + Buffer.from(`${cfg.razorpay.keyId}:${cfg.razorpay.keySecret}`).toString('base64');
  let fee = 0, tax = 0, payments = 0;
  for (let skip = 0, guard = 0; guard < 200; skip += 100, guard++) {
    const res = await f(`${cfg.razorpay.apiUrl}/v1/payments?from=${from}&to=${to}&count=100&skip=${skip}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new HttpError(502, 'BILLING_SOURCE', `Razorpay answered ${res.status}. Check the key.`);
    const j = await res.json() as { items?: { status?: string; fee?: number | null; tax?: number | null }[] };
    const items = j.items ?? [];
    for (const p of items) if (p.status === 'captured' || p.status === 'refunded') { fee += Number(p.fee) || 0; tax += Number(p.tax) || 0; payments++; }
    if (items.length < 100) break;
  }
  return { fee, tax, payments };
}

export interface FetchResult { service: string; source: string; months: { month: string; result: string }[]; error: string | null }

/** Pulls the last three months for every service that has an API and the keys to use it. One service failing never stops the others. */
export async function fetchAutoInvoices(cfg: Config, actor: Actor, f: Fetcher = fetch): Promise<FetchResult[]> {
  const out: FetchResult[] = [];
  const anthropic = setting('anthropicAdminKey'), awsId = setting('awsAccessKeyId'), awsSecret = setting('awsSecretAccessKey');
  for (const s of many<{ id: string; name: string; source: string; source_ref: string | null; currency: 'INR' | 'USD' }>(`SELECT id, name, source, source_ref, currency FROM sw_services WHERE deleted_at IS NULL AND active = 1 AND source <> 'manual'`)) {
    const r: FetchResult = { service: s.name, source: s.source, months: [], error: null };
    try {
      if (s.source === 'anthropic' && !anthropic) throw new HttpError(409, 'NO_KEY', 'Add the Anthropic Admin key first.');
      if (s.source === 'aws' && !(awsId && awsSecret)) throw new HttpError(409, 'NO_KEY', 'Add the AWS access key first.');
      if (s.source === 'razorpay' && !(cfg.razorpay.keyId && cfg.razorpay.keySecret)) throw new HttpError(409, 'NO_KEY', 'Razorpay is not set up on this server.');
      for (const month of lastMonths(3)) {
        let res: ReturnType<typeof upsertAuto>;
        if (s.source === 'anthropic') res = upsertAuto(s.id, month, 'USD', await fetchAnthropicMonth(anthropic, month, f), 0, 'Anthropic cost report');
        else if (s.source === 'aws') res = upsertAuto(s.id, month, 'USD', await fetchAwsMonth({ id: awsId, secret: awsSecret }, month, s.source_ref, f), 0, `AWS Cost Explorer${s.source_ref ? ': ' + s.source_ref : ''}`);
        else { const rz = await fetchRazorpayMonth(cfg, month, f); res = upsertAuto(s.id, month, 'INR', rz.fee - rz.tax, rz.tax, `Razorpay fees on ${rz.payments} payments`); }
        r.months.push({ month, result: res });
      }
    } catch (e) { r.error = (e as Error).message.slice(0, 200); }
    out.push(r);
  }
  audit(actor, 'billing.fetch', 'sw_service', null, { services: out.length, failed: out.filter((x) => x.error).length });
  return out;
}

/** Daily: make expected invoices for fixed fees, and pull the automatic ones. Quiet when nothing is set up. */
export async function billingDaily(cfg: Config, actor: Actor): Promise<void> {
  const today = istDate(now());
  if (one<{ value: string }>("SELECT value FROM sw_settings WHERE name = 'lastDaily'")?.value === today) return;
  run("INSERT INTO sw_settings(name, value, updated_at) VALUES('lastDaily', ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", today, now());
  makeExpectedInvoices(today);
  if (one('SELECT 1 FROM sw_services WHERE deleted_at IS NULL AND active = 1 AND source <> ?', 'manual')) await fetchAutoInvoices(cfg, actor);
}
