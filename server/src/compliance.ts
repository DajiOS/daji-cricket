import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { addDays, istDate } from './time.ts';
import { CASH_LIMITS, LIMIT_DEFAULTS, limitOf, type LimitCode } from './taxrules.ts';
import { MAX_INVOICE_NO, DEFAULT_SAC } from './invoices.ts';
import { PF, ESI, GUJARAT_PT, STATUTORY_RULES_CHECKED } from './accounting/statutory.ts';

// The compliance register: every legal rule the software enforces, where it is enforced, when it was last looked at and when
// it must be looked at next. The law-change log records each time a rule changed and what we changed in response. The
// twice-monthly check (1st and 16th, IST) marks anything past its review date as due, so a stale rule is visible, not silent.

registerSchema('compliance-1', `
CREATE TABLE compliance_items (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authority TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  current_value TEXT NOT NULL,
  enforced_in TEXT NOT NULL,
  review_every_days INTEGER NOT NULL,
  last_reviewed_on TEXT NOT NULL,
  next_review_on TEXT NOT NULL,
  reviewed_by TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE compliance_changes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES compliance_items(code),
  changed_on TEXT NOT NULL,
  summary TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT,
  recorded_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_compliance_changes ON compliance_changes(code, changed_on);
CREATE TABLE compliance_checks (
  id TEXT PRIMARY KEY,
  ran_on TEXT NOT NULL UNIQUE,
  due_count INTEGER NOT NULL,
  due_codes TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const inr = (p: number) => `Rs ${(p / 100).toLocaleString('en-IN')}`;
interface Seed { code: string; title: string; authority: string; rule: string; value: string; where: string; days: number }
const SEEDS = (): Seed[] => [
  { code: 'CASH_269ST', title: 'No cash receipt of Rs 2 lakh or more', authority: 'Income-tax Act, 2025 (formerly section 269ST of the 1961 Act)', rule: 'A business may not receive Rs 2,00,000 or more in cash from one person in a day, for one transaction, or for one event.', value: `${inr(CASH_LIMITS.receiptPaise)} (refused at or above)`, where: 'taxrules.checkCashReceipt, used when staff record a cash payment on a booking', days: 180 },
  { code: 'CASH_40A3', title: 'Cash payments to one person up to Rs 10,000 a day', authority: 'Income-tax Act, 2025 (formerly section 40A(3) and Rule 6DD)', rule: 'A cash payment to one person above Rs 10,000 in a day is not an allowed business expense unless an exception applies, so the software asks for the reason.', value: `${inr(CASH_LIMITS.expensePaise)} per person per day, reason needed above`, where: 'taxrules.checkCashExpense (written reason needed above the limit), used for cash bills and manual cash entries', days: 180 },
  { code: 'CASH_269SS', title: 'No cash loans or deposits of Rs 20,000 or more', authority: 'Income-tax Act, 2025 (formerly sections 269SS and 269T)', rule: 'Loans, deposits and their repayment of Rs 20,000 or more must go by account payee cheque, bank transfer or UPI.', value: `${inr(CASH_LIMITS.loanDepositPaise)} (refused at or above)`, where: 'taxrules.checkCashLoanDeposit, used for cash entries categorised as a loan', days: 180 },
  { code: 'GST_INV_NO', title: 'GST invoice number of 16 characters or fewer', authority: 'CGST Rules 2017, rule 46', rule: 'The invoice number is unique in the financial year, up to 16 characters, using only letters, digits, "/" and "-".', value: `${MAX_INVOICE_NO} characters, format PREFIX/26-27/000001`, where: 'invoices.invoiceNumber', days: 180 },
  { code: 'GST_SAC', title: 'SAC code and tax split on the invoice', authority: 'CGST Rules 2017, rule 46; GST rate notifications', rule: 'A tax invoice shows the SAC code, taxable value, rate and CGST + SGST (IGST between states). The SAC and rate for ground hire should be confirmed by the owner\'s accountant.', value: `Default SAC ${DEFAULT_SAC}; rate set in the books (GST percent)`, where: 'invoices.invoiceForBooking, GST profile', days: 90 },
  { code: 'GST_RCM', title: 'Reverse-charge line on every invoice', authority: 'CGST Rules 2017, rule 46(p)', rule: 'The invoice states whether tax is payable on reverse charge.', value: '"Tax payable on reverse charge: No"', where: 'invoices.toInvoice', days: 180 },
  { code: 'PF_EPF', title: 'Provident Fund contributions', authority: 'EPF and Miscellaneous Provisions Act, 1952', rule: 'Employee and employer pay 12% each of PF wages (ceiling Rs 15,000 a month). Due by the 15th of the next month.', value: `${PF.employeeRate * 100}% / ${PF.employerRate * 100}% up to ${inr(PF.wageCeilingPaise)}`, where: 'accounting/statutory.ts, payroll runs', days: 90 },
  { code: 'ESI', title: 'Employees\' State Insurance', authority: 'ESI Act, 1948', rule: 'Covered while monthly wages are Rs 21,000 or less. Employee 0.75%, employer 3.25%. Due by the 15th of the next month.', value: `${ESI.employeeRate * 100}% / ${ESI.employerRate * 100}% up to ${inr(ESI.coverageCeilingPaise)}`, where: 'accounting/statutory.ts, payroll runs', days: 90 },
  { code: 'PT_GUJARAT', title: 'Gujarat Professional Tax', authority: 'Gujarat State Tax on Professions, Trades, Callings and Employments Act, 1976', rule: 'Employees earning above Rs 12,000 a month pay Rs 200 a month, deducted by the employer.', value: `Nil up to ${inr(GUJARAT_PT.freeUpToPaise)}, ${inr(GUJARAT_PT.monthlyPaise)} a month above`, where: 'accounting/statutory.ts, payroll runs', days: 90 },
  { code: 'TDS_SALARY', title: 'TDS on salary', authority: 'Income-tax Act (section 192; section 392 of the Income-tax Act, 2025 from 1 April 2026)', rule: 'Tax is deducted from salary on the employee\'s estimated yearly tax. The software uses the new regime slabs; TDS is due by the 7th of the next month.', value: 'New regime slabs, standard deduction Rs 75,000, rebate up to Rs 12 lakh', where: 'accounting/statutory.ts, payroll runs', days: 90 },
  { code: 'DPDP', title: 'Digital personal data: notice and consent', authority: 'Digital Personal Data Protection Act, 2023 and Rules', rule: 'Tell people what data is used and why, take consent, honour deletion, and report breaches.', value: 'Privacy page, consent switches, account deletion', where: 'privacy.html, customer consent settings, accountDeletion.ts', days: 180 },
  { code: 'STAFF_TERMS', title: 'Team terms accepted with evidence', authority: 'Indian Contract Act, 1872; Information Technology Act, 2000 (electronic records)', rule: 'Each team member accepts the current terms before using the system; the acceptance stores the wording hash, time and IP address.', value: 'staff_terms version 1', where: 'legal.ts, enforced for every team login', days: 180 },
];

function ensureSeeded(): void {
  const today = istDate(now());
  SEEDS().forEach((s, i) => {
    // The values and wording are refreshed from code on every start, so the register can never disagree with what is enforced.
    const have = one<{ code: string }>('SELECT code FROM compliance_items WHERE code = ?', s.code);
    if (!have) run('INSERT INTO compliance_items(code, title, authority, rule_text, current_value, enforced_in, review_every_days, last_reviewed_on, next_review_on, sort) VALUES(?,?,?,?,?,?,?,?,?,?)',
      s.code, s.title, s.authority, s.rule, s.value, s.where, s.days, STATUTORY_RULES_CHECKED, addDays(STATUTORY_RULES_CHECKED, s.days), i);
    else run('UPDATE compliance_items SET title = ?, authority = ?, rule_text = ?, current_value = ?, enforced_in = ?, review_every_days = ?, sort = ? WHERE code = ?', s.title, s.authority, s.rule, s.value, s.where, s.days, i, s.code);
  });
  void today;
}

export interface RegisterItem { code: string; title: string; authority: string; rule: string; currentValue: string; enforcedIn: string; reviewEveryDays: number; lastReviewedOn: string; nextReviewOn: string; reviewedBy: string | null; status: 'ok' | 'due' | 'soon'; daysToReview: number }
interface ItemRow { code: string; title: string; authority: string; rule_text: string; current_value: string; enforced_in: string; review_every_days: number; last_reviewed_on: string; next_review_on: string; reviewed_by: string | null }

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function register(): RegisterItem[] {
  ensureSeeded();
  const today = istDate(now());
  return many<ItemRow>('SELECT * FROM compliance_items ORDER BY sort').map((r) => {
    const left = daysBetween(today, r.next_review_on);
    return { code: r.code, title: r.title, authority: r.authority, rule: r.rule_text, currentValue: r.current_value, enforcedIn: r.enforced_in, reviewEveryDays: r.review_every_days, lastReviewedOn: r.last_reviewed_on, nextReviewOn: r.next_review_on, reviewedBy: r.reviewed_by, status: left < 0 ? 'due' : left <= 30 ? 'soon' : 'ok', daysToReview: left };
  });
}

export function markReviewed(actor: Actor, code: string, body: unknown): RegisterItem {
  ensureSeeded();
  const v = new Validator(body);
  const note = v.str('note', { max: 300 });
  v.done();
  const cur = one<ItemRow>('SELECT * FROM compliance_items WHERE code = ?', code);
  if (!cur) throw notFound('No such rule in the register');
  const today = istDate(now());
  run('UPDATE compliance_items SET last_reviewed_on = ?, next_review_on = ?, reviewed_by = ? WHERE code = ?', today, addDays(today, cur.review_every_days), actor.id, code);
  audit(actor, 'compliance.review', 'compliance_item', code, { note: note ?? null });
  return register().find((x) => x.code === code)!;
}

export interface ChangeEntry { id: string; code: string; changedOn: string; summary: string; oldValue: string | null; newValue: string | null; source: string | null; recordedBy: string | null; createdAt: number }

/** Records that a rule changed in law. It also counts as a review of that rule (the person recording it has just checked it). */
export function logChange(actor: Actor, body: unknown): ChangeEntry {
  ensureSeeded();
  const v = new Validator(body);
  const code = v.str('code', { required: true, max: 40 }), summary = v.str('summary', { required: true, min: 5, max: 500 });
  const changedOn = v.date('changedOn') ?? istDate(now());
  const oldValue = v.str('oldValue', { max: 200 }), newValue = v.str('newValue', { max: 200 }), source = v.str('source', { max: 300 });
  v.done();
  if (!one('SELECT 1 FROM compliance_items WHERE code = ?', code)) throw new HttpError(400, 'VALIDATION_FAILED', 'No such rule in the register', { fields: [{ field: 'code', message: 'Unknown rule code' }] });
  const id = newId('lcl');
  run('INSERT INTO compliance_changes(id, code, changed_on, summary, old_value, new_value, source, recorded_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, code!, changedOn, summary!, oldValue ?? null, newValue ?? null, source ?? null, actor.id, now());
  audit(actor, 'compliance.change', 'compliance_item', code!, { summary, oldValue: oldValue ?? null, newValue: newValue ?? null });
  markReviewed(actor, code!, {});
  return changes().find((c) => c.id === id)!;
}

/** Changes one of the cash limits after a change in the law. It is applied at once and written to the law-change log. */
export function setLimit(actor: Actor, code: string, body: unknown): RegisterItem {
  ensureSeeded();
  if (!(code in LIMIT_DEFAULTS)) throw new HttpError(400, 'VALIDATION_FAILED', 'That rule has a fixed value', { fields: [{ field: 'code', message: 'Only the cash limits can be changed' }] });
  const v = new Validator(body);
  const value = v.int('valuePaise', { required: true, min: 100, max: 100_000_000_00 }), source = v.str('source', { required: true, min: 3, max: 300 });
  v.done();
  const old = limitOf(code as LimitCode);
  run('INSERT INTO compliance_values(code, value_paise, set_by, set_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET value_paise = excluded.value_paise, set_by = excluded.set_by, set_at = excluded.set_at', code, value!, actor.id, now());
  logChange(actor, { code, summary: 'Limit changed in the software', oldValue: inr(old), newValue: inr(value!), source });
  return register().find((x) => x.code === code)!;
}

export function changes(): ChangeEntry[] {
  return many<{ id: string; code: string; changed_on: string; summary: string; old_value: string | null; new_value: string | null; source: string | null; recorded_by: string | null; created_at: number }>('SELECT * FROM compliance_changes ORDER BY changed_on DESC, created_at DESC LIMIT 200')
    .map((r) => ({ id: r.id, code: r.code, changedOn: r.changed_on, summary: r.summary, oldValue: r.old_value, newValue: r.new_value, source: r.source, recordedBy: r.recorded_by, createdAt: r.created_at }));
}

/** True on the 1st and 16th of the month (India time): the two days a month the check runs. */
export const isCheckDay = (date: string): boolean => date.endsWith('-01') || date.endsWith('-16');

/** The twice-monthly check. Runs at most once per check day; `force` runs it any day (for the "Run the check now" button). */
export function runCheck(opts: { force?: boolean } = {}): { ran: boolean; ranOn: string; dueCount: number; due: string[] } {
  const ranOn = istDate(now());
  if (!opts.force && !isCheckDay(ranOn)) return { ran: false, ranOn, dueCount: 0, due: [] };
  if (!opts.force && one('SELECT 1 FROM compliance_checks WHERE ran_on = ?', ranOn)) return { ran: false, ranOn, dueCount: 0, due: [] };
  const due = register().filter((r) => r.status === 'due').map((r) => r.code);
  run('INSERT INTO compliance_checks(id, ran_on, due_count, due_codes, created_at) VALUES(?,?,?,?,?) ON CONFLICT(ran_on) DO UPDATE SET due_count = excluded.due_count, due_codes = excluded.due_codes, created_at = excluded.created_at', newId('ccx'), ranOn, due.length, due.join(','), now());
  audit(SYSTEM, 'compliance.check', 'compliance', ranOn, { due });
  return { ran: true, ranOn, dueCount: due.length, due };
}

export function lastChecks(limit = 12) {
  return many<{ ran_on: string; due_count: number; due_codes: string }>('SELECT ran_on, due_count, due_codes FROM compliance_checks ORDER BY ran_on DESC LIMIT ?', limit)
    .map((r) => ({ ranOn: r.ran_on, dueCount: r.due_count, due: r.due_codes ? r.due_codes.split(',') : [] }));
}
