import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError } from './errors.ts';
import { Validator } from './input.ts';
import { istDate } from './time.ts';
import { gstInside, gstPercent } from './accounting/ledger.ts';

// GST tax invoices for ground bookings. The rules this enforces (CGST Rules, rule 46):
//   - the invoice number is at most 16 characters, made only of letters, digits, "/" and "-", and unique in the financial year;
//   - it carries the SAC code of the service, the supplier's GSTIN, the tax split (CGST + SGST within Gujarat) and a reverse-charge line.
// A business with no GSTIN is not allowed to charge GST, so it gets a plain receipt that says so and carries no tax at all.

export const DEFAULT_SAC = '997212'; // renting of non-residential property; the owner's accountant can change it in the GST profile

registerSchema('gst-1', `
CREATE TABLE gst_profile (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  legal_name TEXT,
  gstin TEXT,
  address TEXT,
  state_code TEXT NOT NULL DEFAULT '24',
  prefix TEXT NOT NULL DEFAULT 'DCG',
  sac TEXT NOT NULL DEFAULT '${DEFAULT_SAC}',
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE gst_invoices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  fy TEXT NOT NULL,
  seq INTEGER NOT NULL,
  number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tax_invoice','receipt')),
  issued_on TEXT NOT NULL,
  sac TEXT NOT NULL,
  gst_percent INTEGER NOT NULL,
  taxable_paise INTEGER NOT NULL,
  cgst_paise INTEGER NOT NULL,
  sgst_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  supplier_name TEXT NOT NULL,
  supplier_gstin TEXT,
  supplier_address TEXT,
  buyer_name TEXT NOT NULL,
  description TEXT NOT NULL,
  place_of_supply TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_gst_invoice_booking ON gst_invoices(booking_id);
CREATE UNIQUE INDEX ux_gst_invoice_number ON gst_invoices(owner_id, number);
CREATE UNIQUE INDEX ux_gst_invoice_seq ON gst_invoices(owner_id, fy, seq);
`);

export const MAX_INVOICE_NO = 16;
const NO_RE = /^[A-Za-z0-9/-]{1,16}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The financial year an Indian date falls in, as "26-27" (April to March). */
export function financialYear(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** PREFIX/26-27/000123. The prefix is shortened-by-validation, never the number silently cut, so it can never exceed 16 characters. */
export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  const width = Math.max(1, MAX_INVOICE_NO - prefix.length - fy.length - 2);
  const n = `${prefix}/${fy}/${String(seq).padStart(width, '0')}`;
  if (!NO_RE.test(n)) throw new HttpError(500, 'INVOICE_NUMBER_INVALID', 'The invoice number would not meet GST rules. Shorten the invoice prefix in the GST profile.');
  return n;
}

export interface GstProfile { legalName: string | null; gstin: string | null; address: string | null; stateCode: string; prefix: string; sac: string }
interface ProfRow { legal_name: string | null; gstin: string | null; address: string | null; state_code: string; prefix: string; sac: string }

export function getProfile(ownerId: string): GstProfile {
  const r = one<ProfRow>('SELECT * FROM gst_profile WHERE owner_id = ?', ownerId);
  return { legalName: r?.legal_name ?? null, gstin: r?.gstin ?? null, address: r?.address ?? null, stateCode: r?.state_code ?? '24', prefix: r?.prefix ?? 'DCG', sac: r?.sac ?? DEFAULT_SAC };
}

export function saveProfile(ownerId: string, actor: Actor, body: unknown): GstProfile {
  const v = new Validator(body);
  const legalName = v.str('legalName', { max: 120 }), address = v.str('address', { max: 300 });
  const gstinIn = v.str('gstin', { max: 15 }), prefix = v.str('prefix', { max: 6 }), sac = v.str('sac', { max: 8 }), stateCode = v.str('stateCode', { max: 2 });
  const gstin = gstinIn ? gstinIn.toUpperCase() : gstinIn;
  if (gstin && !GSTIN_RE.test(gstin)) v.fail('gstin', 'A GSTIN is 15 characters, for example 24ABCDE1234F1Z5');
  if (prefix && !/^[A-Za-z0-9]{1,6}$/.test(prefix)) v.fail('prefix', 'Letters and digits only, up to 6');
  if (prefix && prefix.length > 4) v.fail('prefix', 'Use at most 4 characters so numbers stay within 16');
  if (sac && !/^\d{4,8}$/.test(sac)) v.fail('sac', 'A SAC code is 4 to 8 digits');
  if (stateCode && !/^\d{2}$/.test(stateCode)) v.fail('stateCode', 'Two digits, 24 for Gujarat');
  v.done();
  const cur = getProfile(ownerId), b = body as Record<string, unknown>;
  const pick = <T,>(k: string, next: T | undefined, old: T): T => (k in b ? (next as T) : old);
  const n = {
    legalName: pick('legalName', legalName, cur.legalName), gstin: pick('gstin', gstin, cur.gstin), address: pick('address', address, cur.address),
    stateCode: stateCode ?? cur.stateCode, prefix: prefix ?? cur.prefix, sac: sac ?? cur.sac,
  };
  run(`INSERT INTO gst_profile(owner_id, legal_name, gstin, address, state_code, prefix, sac, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(owner_id) DO UPDATE SET legal_name = excluded.legal_name, gstin = excluded.gstin, address = excluded.address, state_code = excluded.state_code, prefix = excluded.prefix, sac = excluded.sac, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ownerId, n.legalName ?? null, n.gstin ?? null, n.address ?? null, n.stateCode, n.prefix, n.sac, now(), actor.id);
  audit(actor, 'gst.profile.save', 'gst_profile', ownerId, { gstin: n.gstin ?? null, prefix: n.prefix, sac: n.sac }, ownerId);
  return getProfile(ownerId);
}

export interface Invoice {
  id: string; number: string; kind: 'tax_invoice' | 'receipt'; issuedOn: string; sac: string; gstPercent: number;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number; reverseCharge: boolean;
  supplierName: string; supplierGstin: string | null; supplierAddress: string | null; buyerName: string; description: string; placeOfSupply: string; reverseChargeLine: string; title: string;
}
interface InvRow { id: string; number: string; kind: 'tax_invoice' | 'receipt'; issued_on: string; sac: string; gst_percent: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; total_paise: number; reverse_charge: number; supplier_name: string; supplier_gstin: string | null; supplier_address: string | null; buyer_name: string; description: string; place_of_supply: string }
const toInvoice = (r: InvRow): Invoice => ({
  id: r.id, number: r.number, kind: r.kind, issuedOn: r.issued_on, sac: r.sac, gstPercent: r.gst_percent, taxablePaise: r.taxable_paise, cgstPaise: r.cgst_paise, sgstPaise: r.sgst_paise, totalPaise: r.total_paise,
  reverseCharge: !!r.reverse_charge, supplierName: r.supplier_name, supplierGstin: r.supplier_gstin, supplierAddress: r.supplier_address, buyerName: r.buyer_name, description: r.description, placeOfSupply: r.place_of_supply,
  reverseChargeLine: `Tax payable on reverse charge: ${r.reverse_charge ? 'Yes' : 'No'}`,
  title: r.kind === 'tax_invoice' ? 'Tax Invoice' : 'Receipt (supplier not registered under GST, no tax charged)',
});

const STATES: Record<string, string> = { '24': 'Gujarat (24)', '27': 'Maharashtra (27)', '07': 'Delhi (07)', '29': 'Karnataka (29)' };

/** The invoice for a booking, issued once (the same booking always gives the same invoice and number). */
export function invoiceForBooking(ownerId: string, actor: Actor, bookingId: string): Invoice {
  const have = one<InvRow>('SELECT * FROM gst_invoices WHERE booking_id = ? AND owner_id = ?', bookingId, ownerId);
  if (have) return toInvoice(have);
  return tx(() => {
    const again = one<InvRow>('SELECT * FROM gst_invoices WHERE booking_id = ? AND owner_id = ?', bookingId, ownerId);
    if (again) return toInvoice(again);
    const b = one<{ id: string; owner_id: string; total_paise: number; paid_paise: number; status: string; date: string; ref: string; customer_name: string; ground_name: string; format_label: string | null }>(
      `SELECT b.id, b.owner_id, b.total_paise, b.paid_paise, b.status, b.date, b.ref, u.name customer_name, g.name ground_name, b.format_label FROM bookings b JOIN users u ON u.id = b.customer_id JOIN grounds g ON g.id = b.ground_id WHERE b.id = ?`, bookingId);
    if (!b || b.owner_id !== ownerId) throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    if (!['confirmed', 'completed'].includes(b.status) || b.paid_paise <= 0) throw new HttpError(409, 'NOT_INVOICEABLE', 'An invoice can be issued once the booking is confirmed and a payment has been received');
    const p = getProfile(ownerId);
    const registered = !!p.gstin;
    const pct = registered ? gstPercent(ownerId) : 0;
    const total = b.total_paise, gst = registered ? gstInside(total, pct) : 0;
    const half = Math.round(gst / 2), cgst = half, sgst = half; // equal halves; the odd paise goes to the taxable value so the lines still add up
    const taxable = total - 2 * half;
    const issuedOn = istDate(now()), fy = financialYear(issuedOn);
    const seq = (one<{ m: number | null }>('SELECT MAX(seq) m FROM gst_invoices WHERE owner_id = ? AND fy = ?', ownerId, fy)?.m ?? 0) + 1;
    const number = invoiceNumber(p.prefix, fy, seq);
    const supplier = p.legalName || one<{ business_name: string | null; name: string }>('SELECT business_name, name FROM users WHERE id = ?', ownerId)?.business_name || 'Daji Cricket Ground';
    const id = newId('inv');
    run(`INSERT INTO gst_invoices(id, owner_id, booking_id, fy, seq, number, kind, issued_on, sac, gst_percent, taxable_paise, cgst_paise, sgst_paise, total_paise, reverse_charge, supplier_name, supplier_gstin, supplier_address, buyer_name, description, place_of_supply, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
      id, ownerId, bookingId, fy, seq, number, registered ? 'tax_invoice' : 'receipt', issuedOn, p.sac, pct, taxable, cgst, sgst, total, supplier, p.gstin ?? null, p.address ?? null, b.customer_name,
      `Ground hire, ${b.ground_name}${b.format_label ? `, ${b.format_label}` : ''}, session on ${b.date} (booking ${b.ref})`, STATES[p.stateCode] ?? p.stateCode, now());
    audit(actor, 'gst.invoice.issue', 'gst_invoice', id, { bookingId, number }, ownerId);
    return toInvoice(one<InvRow>('SELECT * FROM gst_invoices WHERE id = ?', id)!);
  });
}

export function listInvoices(ownerId: string, fy?: string): Invoice[] {
  return many<InvRow>('SELECT * FROM gst_invoices WHERE owner_id = ? AND (? IS NULL OR fy = ?) ORDER BY fy DESC, seq DESC LIMIT 1000', ownerId, fy ?? null, fy ?? null).map(toInvoice);
}
