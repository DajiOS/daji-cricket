import type { BallType, Booking, HoldResponse, PaymentInstructions, PayMethod, RepeatFrequency } from '@daji/shared';
import { many, one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId, newRef } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator, normalizePhone } from './input.ts';
import { getSettings } from './settings.ts';
import { MIN, DAY, addDays, istMidnight, timeOfDay } from './time.ts';
import { accessBooking, blockOf, advanceFor, bookingOr404, confirmBooking, loadBooking, releaseSiblings, releaseSlots, viewBooking, type BookingRow } from './bookings.ts';
import { getGroundOr404, slotPrice, slotStarts, type GroundRow } from './grounds.ts';
import { createUser, requirePermission, scopeOwnerId, type UserRow } from './auth.ts';
import { insertPayment, logEvent, recordOffline, type PaymentRow } from './payments.ts';
import { getGateway } from './gateway.ts';
import { findFormat, formatPrice, formatWindows, groundFormats } from './formats.ts';
import { findRule, fixedShare, groundRates, hourlySlotPrice, isClosedOn, ruleWindow } from './rates.ts';
import { dayOfWeek } from './time.ts';
import * as credits from './credits.ts';
import type { Config } from './config.ts';
import { evaluatePromo, normCode } from './promo.ts';
import { isClosedDate } from './closures.ts';
import { expandDates, parseRepeat } from './recurring.ts';

export const MAX_DAYS_AHEAD = 365; // customers can book up to a year ahead
export const MAX_ACTIVE_HOLDS = 3;

interface Plan { ground: GroundRow; date: string; starts: number[]; totalPaise: number; format?: { label: string; ball: BallType } }

/** Checks the requested slots are real, consecutive, in the future and within limits; prices them. */
export function planSlots(ground: GroundRow, date: string, startTime: string, slots: number, at = now(), opts: { ignoreMaxSlots?: boolean } = {}): Plan {
  if (!ground.active) throw new HttpError(409, 'GROUND_INACTIVE', 'This ground is not taking bookings right now');
  if (istMidnight(date) > at + MAX_DAYS_AHEAD * DAY) throw new HttpError(400, 'TOO_FAR_AHEAD', `Bookings open ${MAX_DAYS_AHEAD} days ahead`);
  if (slots > ground.max_slots && !opts.ignoreMaxSlots) throw new HttpError(400, 'TOO_MANY_SLOTS', `At most ${ground.max_slots} slots can be booked together here`);
  const all = slotStarts(ground, date);
  const first = all.findIndex((s) => timeOfDay(s) === startTime);
  if (first < 0 || first + slots > all.length) throw new HttpError(400, 'INVALID_SLOT', 'Those slots are outside the ground\'s opening hours', { open: ground.open_time, close: ground.close_time, slotMinutes: ground.slot_minutes });
  const starts = all.slice(first, first + slots);
  if (starts[0]! <= at || starts[0]! < at + ground.min_notice_minutes * MIN) throw new HttpError(409, 'SLOT_IN_PAST', ground.min_notice_minutes ? `Bookings need at least ${ground.min_notice_minutes} minutes notice` : 'That time has already started or passed');
  const totalPaise = starts.reduce((sum, s) => sum + slotPrice(ground, date, s), 0);
  return { ground, date, starts, totalPaise };
}

/** A session of a chosen way to play (ball and length): the whole window is taken as one booking at the format's price. */
export function planFormat(ground: GroundRow, date: string, formatId: string, startTime: string, at = now()): Plan {
  if (!ground.active) throw new HttpError(409, 'GROUND_INACTIVE', 'This ground is not taking bookings right now');
  if (istMidnight(date) > at + MAX_DAYS_AHEAD * DAY) throw new HttpError(400, 'TOO_FAR_AHEAD', `Bookings open ${MAX_DAYS_AHEAD} days ahead`);
  const f = findFormat(ground, formatId);
  const w = formatWindows(ground, date, f).find((x) => timeOfDay(x.start) === startTime);
  if (!w) throw new HttpError(400, 'INVALID_SLOT', `A ${f.label} session starts at ${formatWindows(ground, date, f).map((x) => timeOfDay(x.start)).join(', ')}`, { starts: formatWindows(ground, date, f).map((x) => timeOfDay(x.start)) });
  if (w.start <= at || w.start < at + ground.min_notice_minutes * MIN) throw new HttpError(409, 'SLOT_IN_PAST', ground.min_notice_minutes ? `Bookings need at least ${ground.min_notice_minutes} minutes notice` : 'That time has already started or passed');
  return { ground, date, starts: w.slotStarts, totalPaise: w.pricePaise ?? formatPrice(f, date), format: { label: f.label, ball: f.ball } };
}

/** One line of the ground's price list: a fixed session (the whole window) or some hours of an hourly price. */
export function planRate(ground: GroundRow, date: string, ruleId: string, startTime: string, slots: number | undefined, at = now()): Plan {
  if (!ground.active) throw new HttpError(409, 'GROUND_INACTIVE', 'This ground is not taking bookings right now');
  if (istMidnight(date) > at + MAX_DAYS_AHEAD * DAY) throw new HttpError(400, 'TOO_FAR_AHEAD', `Bookings open ${MAX_DAYS_AHEAD} days ahead`);
  const rule = findRule(ground, ruleId);
  if (isClosedOn(ground, date)) throw new HttpError(409, 'CLOSED_DAY', 'The ground is closed that day. Please pick another day.');
  if (!rule.days.includes(dayOfWeek(date))) throw new HttpError(400, 'RATE_NOT_ON_DAY', `${rule.label} is not offered on that day`);
  const w = ruleWindow(ground, date, rule);
  if (!w) throw new HttpError(409, 'CLOSED_DAY', `${rule.label} runs over a day the ground is closed`);
  let starts: number[], total: number;
  if (rule.mode === 'fixed') {
    const share = fixedShare(ground, w, rule, at);
    if (share.proRated) { starts = share.starts; total = share.pricePaise; if (startTime !== timeOfDay(starts[0]!) && startTime !== rule.from) throw new HttpError(400, 'INVALID_SLOT', `${rule.label} can now be booked from ${timeOfDay(starts[0]!)}`); }
    else { if (startTime !== rule.from && startTime !== timeOfDay(w.start)) throw new HttpError(400, 'INVALID_SLOT', `${rule.label} starts at ${timeOfDay(w.start)}`); starts = w.slotStarts; total = rule.pricePaise; }
  } else {
    const n = slots ?? 1;
    if (n > ground.max_slots) throw new HttpError(400, 'TOO_MANY_SLOTS', `At most ${ground.max_slots} hours can be booked together here`);
    const first = w.slotStarts.findIndex((x) => timeOfDay(x) === startTime);
    if (first < 0 || first + n > w.slotStarts.length) throw new HttpError(400, 'INVALID_SLOT', `${rule.label} runs from ${rule.from} to ${timeOfDay(w.end)}`);
    starts = w.slotStarts.slice(first, first + n); total = n * hourlySlotPrice(rule, ground.slot_minutes);
  }
  if (starts[0]! <= at || starts[0]! < at + ground.min_notice_minutes * MIN) throw new HttpError(409, 'SLOT_IN_PAST', ground.min_notice_minutes ? `Bookings need at least ${ground.min_notice_minutes} minutes notice` : 'That time has already started');
  return { ground, date, starts, totalPaise: total, format: { label: rule.label, ball: rule.ball } };
}

/** Customers on a ground with formats must pick one; staff may still book raw slots. */
export function planFor(ground: GroundRow, req: { date: string; startTime: string; slots?: number; formatId?: string; ruleId?: string }, customerFacing: boolean): Plan {
  if (req.ruleId) return planRate(ground, req.date, req.ruleId, req.startTime, req.slots);
  if (customerFacing && groundRates(ground).length) throw new HttpError(400, 'RATE_REQUIRED', 'Choose a session or hours from the price list first');
  if (req.formatId) return planFormat(ground, req.date, req.formatId, req.startTime);
  if (customerFacing && groundFormats(ground).length) throw new HttpError(400, 'FORMAT_REQUIRED', 'Choose the ball and the match length first');
  if (!req.slots) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the number of slots', { fields: [{ field: 'slots', message: 'Required' }] });
  return planSlots(ground, req.date, req.startTime, req.slots);
}

/** Inserts the slot rows. The (ground, slot) primary key is the final guard against double booking. */
function takeSlots(bookingId: string, ground: GroundRow, starts: number[]): void {
  for (const s of starts) {
    const hit = one<{ kind: string }>('SELECT kind FROM booking_slots WHERE ground_id = ? AND slot_start = ?', ground.id, s);
    if (hit) throw new HttpError(409, 'SLOT_TAKEN', hit.kind === 'block' ? `The ${timeOfDay(s)} slot is not available` : `The ${timeOfDay(s)} slot has just been booked by someone else`, { slot: s });
    try {
      run("INSERT INTO booking_slots(ground_id, slot_start, kind, booking_id) VALUES(?,?,'booking',?)", ground.id, s, bookingId);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE') || String((e as Error).message).includes('PRIMARY')) throw new HttpError(409, 'SLOT_TAKEN', `The ${timeOfDay(s)} slot has just been booked by someone else`, { slot: s });
      throw e;
    }
  }
}

function insertBooking(o: { ground: GroundRow; customerId: string; date: string; starts: number[]; totalPaise: number; advancePaise: number; status: 'held' | 'confirmed'; source: 'online' | 'walk_in' | 'enquiry'; payMethod: 'razorpay' | 'upi' | null; holdExpiresAt: number | null; players?: number | null; notes?: string | null; createdBy: string | null; enquiryId?: string | null; format?: Plan['format'] }): string {
  const id = newId('bkg');
  const t = now();
  const endAt = o.starts[o.starts.length - 1]! + o.ground.slot_minutes * MIN;
  for (let attempt = 0; ; attempt++) {
    try {
      run(
        `INSERT INTO bookings(id, ref, ground_id, owner_id, customer_id, date, start_at, end_at, slot_count, status, source, total_paise, advance_paise, pay_method, hold_expires_at, players, notes, enquiry_id, created_by, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, newRef(), o.ground.id, o.ground.owner_id, o.customerId, o.date, o.starts[0]!, endAt, o.starts.length, o.status, o.source, o.totalPaise, o.advancePaise,
        o.payMethod, o.holdExpiresAt, o.players ?? null, o.notes ?? null, o.enquiryId ?? null, o.createdBy, t, t);
      if (o.format) run('UPDATE bookings SET format_label = ?, ball = ? WHERE id = ?', o.format.label, o.format.ball, id);
      return id;
    } catch (e) {
      if (attempt < 5 && String((e as Error).message).includes('bookings.ref')) continue; // reference collision: pick another
      throw e;
    }
  }
}

export function upiDetails(ownerId: string): { upiId: string; payee: string } | null {
  const s = getSettings();
  const o = one<{ upi_id: string | null; business_name: string | null; name: string }>('SELECT upi_id, business_name, name FROM users WHERE id = ?', ownerId);
  const upiId = o?.upi_id || s.upiId;
  if (!upiId) return null;
  return { upiId, payee: o?.upi_id ? (o.business_name || o.name) : s.upiPayee };
}

function upiInstructions(b: BookingRow, amountPaise: number, paymentId: string): PaymentInstructions {
  const d = upiDetails(b.owner_id)!;
  const uri = `upi://pay?pa=${encodeURIComponent(d.upiId)}&pn=${encodeURIComponent(d.payee)}&am=${(amountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(b.ref)}`;
  return { mode: 'upi', amountPaise, paymentId, upi: { upiId: d.upiId, payee: d.payee, uri, note: `Put ${b.ref} in the payment remarks`, deadline: b.hold_expires_at! } };
}

export function parseHold(body: unknown) {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true });
  const date = v.date('date', true);
  const startTime = v.time('startTime', true);
  const formatId = v.str('formatId', { max: 40 });
  const ruleId = v.str('ruleId', { max: 40 });
  const slots = v.int('slots', { required: !formatId && !ruleId, min: 1, max: 24 });
  const useCredit = v.bool('useCredit');
  const players = v.int('players', { min: 1, max: 60 });
  const notes = v.str('notes', { max: 300 });
  const promoCode = v.str('promoCode', { max: 30 });
  v.done();
  return { groundId: groundId!, date: date!, startTime: startTime!, slots, formatId, useCredit: !!useCredit, players, notes, ruleId, promoCode: promoCode ? normCode(promoCode) : undefined };
}

/** Customer step 1: hold the slots, apply credit if asked, and say how to pay. */
export async function holdSlots(cfg: Config, customer: UserRow, body: unknown): Promise<HoldResponse> {
  const req = parseHold(body);
  const repeat = parseRepeat(body);
  const openFrom = getSettings().bookingsOpenFrom;
  if (openFrom && req.date < openFrom) throw new HttpError(409, 'NOT_OPEN_YET', `Online bookings open on ${openFrom.slice(8, 10).replace(/^0/, '')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(openFrom.slice(5, 7)) - 1]} ${openFrom.slice(0, 4)}. Please pick that day or later.`, { openFrom });
  const closeFrom = getSettings().bookingsCloseFrom;
  if (closeFrom && req.date >= closeFrom) throw new HttpError(409, 'BOOKINGS_CLOSED', 'Bookings are closed from that date for now. Please pick an earlier day, or call us.', { closeFrom });
  const ground = getGroundOr404(req.groundId);
  const plan = planFor(ground, req, true);
  if (isClosedDate(req.date, plan.format?.ball === 'practice' ? 'practice' : 'ground')) throw new HttpError(409, 'DATE_CLOSED', `Online booking for ${plan.format?.ball === 'practice' ? 'practice sessions' : 'the ground'} is switched off for that day. Please pick another day, or call us.`);
  const promo = req.promoCode ? evaluatePromo(req.promoCode, ground, customer.id, plan.totalPaise) : null;
  if (promo) plan.totalPaise -= promo.discountPaise;
  const s = getSettings();
  const method: 'razorpay' | 'upi' = s.razorpayEnabled ? 'razorpay' : 'upi';
  const gw = method === 'razorpay' ? getGateway(cfg) : null;
  if (method === 'razorpay' && !gw) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not set up yet. Please try again later.');
  if (method === 'upi' && !upiDetails(ground.owner_id)) throw new HttpError(503, 'UPI_NOT_CONFIGURED', 'This ground has no UPI ID set up yet. Please contact the ground.');

  let seriesOut: HoldResponse['series'];
  const result = tx(() => {
    const active = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE customer_id = ? AND status = 'held' AND COALESCE(series_index, 0) = 0", customer.id)!.n;
    if (active >= MAX_ACTIVE_HOLDS) throw new HttpError(409, 'TOO_MANY_HOLDS', `You already have ${active} unpaid bookings. Pay for or cancel one first.`);
    const t = now();
    const advance = advanceFor(ground, plan.totalPaise, plan.starts[0]!, t);
    const holdMin = method === 'razorpay' ? s.holdMinutesOnline : s.holdMinutesUpi;
    const id = insertBooking({ ground, customerId: customer.id, date: plan.date, starts: plan.starts, totalPaise: plan.totalPaise, advancePaise: advance, status: 'held', source: 'online', payMethod: method, holdExpiresAt: t + holdMin * MIN, players: req.players, notes: req.notes ?? null, createdBy: customer.id, format: plan.format });
    takeSlots(id, ground, plan.starts);
    if (promo) run('UPDATE bookings SET promo_code = ?, discount_paise = ? WHERE id = ?', promo.promo.code, promo.discountPaise, id);
    if (repeat) seriesOut = reserveSeries(ground, customer, id, req, repeat, method, plan.format?.ball === 'practice' ? 'practice' : 'ground');
    audit({ id: customer.id, role: customer.role }, 'booking.hold', 'booking', id, { promo: promo?.promo.code ?? null, discountPaise: promo?.discountPaise ?? 0, slots: plan.starts.length, totalPaise: plan.totalPaise, advancePaise: advance, method }, ground.owner_id);

    let creditApplied = 0;
    if (req.useCredit) {
      creditApplied = Math.min(credits.balance(customer.id, ground.owner_id), advance);
      if (creditApplied > 0) {
        credits.redeem(customer.id, ground.owner_id, creditApplied, id);
        insertPayment(bookingOr404(id), { method: 'credit', status: 'captured', purpose: advance === plan.totalPaise ? 'full' : 'advance', amountPaise: creditApplied, verifiedBy: customer.id });
        run('UPDATE bookings SET paid_paise = ? WHERE id = ?', creditApplied, id);
        audit({ id: customer.id, role: customer.role }, 'credit.redeem', 'booking', id, { amountPaise: creditApplied }, ground.owner_id);
      }
    }
    const due = advance - creditApplied;
    if (due <= 0) {
      confirmBooking(id, { id: customer.id, role: customer.role }, { via: 'credit' });
      return { id, due: 0, creditApplied, payId: null as string | null };
    }
    const payId = insertPayment(bookingOr404(id), { method, status: 'created', purpose: advance === plan.totalPaise ? 'full' : 'advance', amountPaise: due });
    return { id, due, creditApplied, payId };
  });

  let payment: PaymentInstructions = { mode: 'none', amountPaise: 0, paymentId: null };
  const b = bookingOr404(result.id);
  if (result.payId) {
    if (method === 'razorpay') {
      try {
        const order = await gw!.createOrder(result.due, b.ref, { booking: b.id, ref: b.ref });
        run('UPDATE payments SET rp_order_id = ?, updated_at = ? WHERE id = ?', order.id, now(), result.payId);
        logEvent(result.payId, null, 'order.created', { orderId: order.id });
        payment = { mode: 'razorpay', amountPaise: result.due, paymentId: result.payId, razorpay: { keyId: gw!.keyId, orderId: order.id, demo: gw!.demo } };
      } catch (e) {
        // No way to pay: do not leave the slots stuck. Give back any credit and release.
        undoHold(b.id, customer);
        throw e;
      }
    } else {
      payment = upiInstructions(b, result.due, result.payId);
    }
  }
  return { booking: viewBooking(result.id), payment, creditAppliedPaise: result.creditApplied, ...(seriesOut ? { series: seriesOut } : {}) };
}

/**
 * Reserves the later dates of a repeating booking beside the first one. A date that cannot be booked (closed day, outside the booking window,
 * not on the price list that day, or already taken) is left out and reported, never failing the whole series. Runs inside the hold's transaction.
 */
function reserveSeries(ground: GroundRow, customer: UserRow, firstId: string, req: ReturnType<typeof parseHold>, repeat: { frequency: RepeatFrequency; count: number }, method: 'razorpay' | 'upi', scope: 'ground' | 'practice'): NonNullable<HoldResponse['series']> {
  const seriesId = newId('ser');
  run('INSERT INTO booking_series(id, owner_id, customer_id, ground_id, frequency, requested, first_booking_id, created_at) VALUES(?,?,?,?,?,?,?,?)', seriesId, ground.owner_id, customer.id, ground.id, repeat.frequency, repeat.count, firstId, now());
  run('UPDATE bookings SET series_id = ?, series_index = 0 WHERE id = ?', seriesId, firstId);
  const st = getSettings();
  const skipped: { date: string; reason: string }[] = [];
  let created = 1, index = 0;
  for (const date of expandDates(req.date, repeat.frequency, repeat.count).slice(1)) {
    index++;
    try {
      if (st.bookingsOpenFrom && date < st.bookingsOpenFrom) throw new HttpError(409, 'NOT_OPEN_YET', 'Bookings are not open for that date yet');
      if (st.bookingsCloseFrom && date >= st.bookingsCloseFrom) throw new HttpError(409, 'BOOKINGS_CLOSED', 'Bookings are closed from that date');
      const p = planFor(ground, { ...req, date }, true);
      if (isClosedDate(date, scope)) throw new HttpError(409, 'DATE_CLOSED', 'Online booking is switched off that day');
      const busy = p.starts.some((x) => one('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', ground.id, x));
      if (busy) throw new HttpError(409, 'SLOT_TAKEN', 'That time is already booked');
      const sid = insertBooking({ ground, customerId: customer.id, date, starts: p.starts, totalPaise: p.totalPaise, advancePaise: 0, status: 'held', source: 'online', payMethod: method, holdExpiresAt: null, players: req.players, notes: req.notes ?? null, createdBy: customer.id, format: p.format });
      takeSlots(sid, ground, p.starts);
      run('UPDATE bookings SET series_id = ?, series_index = ? WHERE id = ?', seriesId, index, sid);
      created++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      skipped.push({ date, reason: e.message });
    }
  }
  audit({ id: customer.id, role: customer.role }, 'series.create', 'booking', firstId, { frequency: repeat.frequency, requested: repeat.count, created, skipped: skipped.length }, ground.owner_id);
  return { id: seriesId, frequency: repeat.frequency, created, skipped };
}

/** Gives up a hold that could not be completed (gateway down): slots freed, credit restored, booking marked expired. */
function undoHold(bookingId: string, customer: UserRow): void {
  tx(() => {
    const b = bookingOr404(bookingId);
    if (b.status !== 'held') return;
    const pays = many<PaymentRow>('SELECT * FROM payments WHERE booking_id = ?', b.id);
    for (const p of pays) {
      if (p.method === 'credit' && p.status === 'captured') {
        credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: p.amount_paise, source: 'restore', bookingId: b.id, note: 'Booking could not be completed', silent: true });
        run("UPDATE payments SET status = 'refunded', refunded_paise = amount_paise WHERE id = ?", p.id);
      } else if (p.status === 'created') run("UPDATE payments SET status = 'failed', reject_reason = 'could not start payment' WHERE id = ?", p.id);
    }
    releaseSlots(b.id);
    releaseSiblings(b);
    run("UPDATE bookings SET status = 'expired', hold_expires_at = NULL, updated_at = ? WHERE id = ?", now(), b.id);
    audit({ id: customer.id, role: customer.role }, 'booking.expire', 'booking', b.id, { reason: 'payment could not be started' }, b.owner_id);
  });
}

// ---------------------------------------------------------------- walk-in and manual bookings

export interface WalkInInput {
  groundId: string; date: string; startTime: string; slots?: number; formatId?: string; ruleId?: string;
  customer: { name: string; phone: string; email?: string; firstName?: string; lastName?: string };
  payment: { method: Exclude<PayMethod, 'razorpay' | 'credit'>; amountPaise: number; reference?: string };
  players?: number; notes?: string; source?: 'walk_in' | 'enquiry'; enquiryId?: string; totalPaiseOverride?: number; customerId?: string;
}

export function parseWalkIn(body: unknown): WalkInInput {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true });
  const date = v.date('date', true);
  const startTime = v.time('startTime', true);
  const formatId = v.str('formatId', { max: 40 });
  const ruleId = v.str('ruleId', { max: 40 });
  const slots = v.int('slots', { required: !formatId && !ruleId, min: 1, max: 24 });
  const players = v.int('players', { min: 1, max: 60 });
  const notes = v.str('notes', { max: 300 });
  const cust = body && typeof body === 'object' ? (body as any).customer : undefined;
  const pay = body && typeof body === 'object' ? (body as any).payment : undefined;
  let customer: WalkInInput['customer'] | undefined;
  let payment: WalkInInput['payment'] | undefined;
  if (!cust || typeof cust !== 'object') v.fail('customer', 'Required');
  else {
    const cv = new Validator(cust);
    const nm = readName(cv, true);
    const phone = cv.phone('phone', true);
    const email = cv.email('email');
    for (const f of cv.fields) v.fail(`customer.${f.field}`, f.message);
    if (nm.name && phone) customer = { name: nm.name, ...(nm.firstName ? { firstName: nm.firstName, lastName: nm.lastName } : {}), phone, email };
  }
  if (!pay || typeof pay !== 'object') v.fail('payment', 'Required');
  else {
    const pv = new Validator(pay);
    const method = pv.oneOf('method', ['cash', 'card', 'upi', 'bank_transfer'] as const, true);
    const amountPaise = pv.int('amountPaise', { required: true, min: 0 });
    const reference = pv.str('reference', { max: 60 });
    for (const f of pv.fields) v.fail(`payment.${f.field}`, f.message);
    if (method && amountPaise !== undefined) payment = { method, amountPaise, reference }; // 0 is allowed: booked with nothing received yet
  }
  v.done();
  return { groundId: groundId!, date: date!, startTime: startTime!, slots, formatId, ruleId, customer: customer!, payment: payment!, players, notes };
}

/** Reads a person's name from `firstName` and `lastName` (preferred) or a single `name`. */
export function readName(cv: Validator, required: boolean): { name?: string; firstName?: string; lastName?: string } {
  const first = cv.str('firstName', { min: 1, max: 40 });
  const last = cv.str('lastName', { max: 40 });
  if (first) return { name: `${first} ${last ?? ''}`.trim(), firstName: first, lastName: last ?? '' };
  const name = cv.str('name', { required, min: 2, max: 80 });
  return { name };
}

/** Finds the customer by phone (or email) within what staff may see, or creates a walk-in record without a login. */
export function findOrCreateCustomer(c: { name: string; phone: string; email?: string; firstName?: string; lastName?: string }): UserRow {
  const phone = normalizePhone(c.phone)!;
  if (c.email) {
    const byEmail = one<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?) AND role = 'customer'", c.email);
    if (byEmail) return byEmail;
  }
  const byPhone = one<UserRow>("SELECT * FROM users WHERE phone = ? AND role = 'customer' ORDER BY (password_hash IS NOT NULL) DESC, created_at LIMIT 1", phone);
  if (byPhone) return byPhone;
  return createUser({ role: 'customer', name: c.name, ...(c.firstName ? { firstName: c.firstName, lastName: c.lastName ?? '' } : {}), phone, email: c.email ?? null });
}

export interface CustomerMatch {
  found: boolean; hasAccount: boolean; known: boolean; id?: string; name?: string; phone?: string | null; email?: string | null;
  matchedOn: ('phone' | 'email')[]; conflict: boolean;
}
/**
 * Looks for an existing customer by phone and email, the same way a booking will. `hasAccount` means they can already sign in
 * (so they should reset their password, not get a second account). Details are only returned for someone this owner has booked before.
 * `conflict` means the phone and the email belong to two different people.
 */
export function lookupCustomer(ownerId: string | null, q: { phone?: string | null; email?: string | null }): CustomerMatch {
  const phone = q.phone ? normalizePhone(q.phone) : null;
  const email = q.email?.trim() || null;
  const byEmail = email ? one<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?) AND role = 'customer'", email) : undefined;
  const byPhone = phone ? one<UserRow>("SELECT * FROM users WHERE phone = ? AND role = 'customer' ORDER BY (password_hash IS NOT NULL) DESC, created_at LIMIT 1", phone) : undefined;
  const row = byEmail ?? byPhone;
  const matchedOn: ('phone' | 'email')[] = [];
  if (byPhone) matchedOn.push('phone');
  if (byEmail) matchedOn.push('email');
  if (!row) return { found: false, hasAccount: false, known: false, matchedOn, conflict: false };
  const known = !ownerId || !!one('SELECT 1 FROM bookings WHERE customer_id = ? AND owner_id = ? LIMIT 1', row.id, ownerId);
  const conflict = !!(byEmail && byPhone && byEmail.id !== byPhone.id);
  const hasAccount = !!(byEmail?.password_hash || byPhone?.password_hash);
  return known
    ? { found: true, hasAccount, known, id: row.id, name: row.name, phone: row.phone, email: row.email, matchedOn, conflict }
    : { found: true, hasAccount, known, matchedOn, conflict };
}

/**
 * Staff step: pick slots, record the customer and the payment, confirm. Nothing is held unless the advance is recorded.
 */
export function createStaffBooking(staff: UserRow, input: WalkInInput): Booking {
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const ground = getGroundOr404(input.groundId);
  const ownerScope = scopeOwnerId(staff);
  if (staff.role !== 'super_admin' && ownerScope !== ground.owner_id) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
  requirePermission(staff, 'manage_bookings');
  if (input.payment.method === 'upi' || input.payment.method === 'cash' || input.payment.method === 'card' || input.payment.method === 'bank_transfer') requirePermission(staff, 'record_payments');
  const plan = planFor(ground, input, false);
  const total = input.totalPaiseOverride ?? plan.totalPaise;
  if (input.payment.amountPaise > total) throw new HttpError(409, 'OVERPAYMENT', `The booking total is ${total} paise; the payment is more than that`);
  const actor: Actor = { id: staff.id, role: staff.role };
  const source = input.source ?? 'walk_in';

  return tx(() => {
    const t = now();
    const noMoney = input.payment.amountPaise === 0; // staff may book with nothing received; the whole amount stays due
    const advance = noMoney ? 0 : Math.min(advanceFor(ground, total, plan.starts[0]!, t), total);
    if (input.payment.amountPaise < advance) {
      throw new HttpError(409, 'ADVANCE_NOT_MET', `At least the advance of ${advance} paise must be recorded to confirm this booking`, { advancePaise: advance, totalPaise: total });
    }
    const customer = input.customerId ? one<UserRow>('SELECT * FROM users WHERE id = ?', input.customerId)! : findOrCreateCustomer(input.customer);
    const id = insertBooking({ ground, customerId: customer.id, date: plan.date, starts: plan.starts, totalPaise: total, advancePaise: advance, status: 'held', source, payMethod: null, holdExpiresAt: t + 5 * MIN, players: input.players, notes: input.notes ?? null, createdBy: staff.id, enquiryId: input.enquiryId ?? null, format: plan.format });
    takeSlots(id, ground, plan.starts);
    audit(actor, source === 'enquiry' ? 'booking.from_enquiry' : 'booking.walk_in', 'booking', id, { totalPaise: total, advancePaise: advance, customerId: customer.id }, ground.owner_id);
    if (noMoney) { confirmBooking(id, actor, { via: 'offline', noAdvance: true }); return viewBooking(id); }
    const r = recordOffline(staff, id, { method: input.payment.method, amountPaise: input.payment.amountPaise, reference: input.payment.reference });
    if (r.outcome !== 'confirmed') throw new HttpError(409, 'ADVANCE_NOT_MET', 'The recorded payment did not reach the advance');
    return viewBooking(id);
  });
}

// ---------------------------------------------------------------- multi-day block (owner and staff)

export interface BlockInput {
  groundId: string; fromDate: string; toDate: string; startTime: string; endTime: string; totalPaise: number;
  customer: { name: string; phone: string; email?: string; firstName?: string; lastName?: string };
  payment: { method: Exclude<PayMethod, 'razorpay' | 'credit'>; amountPaise: number; reference?: string };
  notes?: string; enquiryId?: string; customerId?: string;
}
export const MAX_BLOCK_DAYS = 31;

export function parseBlock(body: unknown): BlockInput {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true });
  const fromDate = v.date('fromDate', true), toDate = v.date('toDate', true);
  const startTime = v.time('startTime', true), endTime = v.time('endTime', true);
  const totalPaise = v.int('totalPaise', { required: true, min: 100, max: 100_000_000_00 });
  const notes = v.str('notes', { max: 300 });
  const cust = (body as any)?.customer, pay = (body as any)?.payment;
  let customer: BlockInput['customer'] | undefined, payment: BlockInput['payment'] | undefined;
  if (!cust || typeof cust !== 'object') v.fail('customer', 'Required');
  else {
    const cv = new Validator(cust);
    const nm = readName(cv, true), phone = cv.phone('phone', true), email = cv.email('email');
    for (const f of cv.fields) v.fail(`customer.${f.field}`, f.message);
    if (nm.name && phone) customer = { name: nm.name, ...(nm.firstName ? { firstName: nm.firstName, lastName: nm.lastName } : {}), phone, email };
  }
  if (!pay || typeof pay !== 'object') v.fail('payment', 'Required');
  else {
    const pv = new Validator(pay);
    const method = pv.oneOf('method', ['cash', 'card', 'upi', 'bank_transfer'] as const, true), amountPaise = pv.int('amountPaise', { required: true, min: 0 }), reference = pv.str('reference', { max: 60 });
    for (const f of pv.fields) v.fail(`payment.${f.field}`, f.message);
    if (method && amountPaise !== undefined) payment = { method, amountPaise, reference }; // 0 is allowed: booked with nothing received yet
  }
  if (fromDate && toDate && toDate < fromDate) v.fail('toDate', 'Cannot be before the first day');
  if (startTime && endTime && endTime === startTime) v.fail('endTime', 'Must be different from the start time'); // an earlier end, like 02:00 after 18:00, is the next morning
  v.done();
  return { groundId: groundId!, fromDate: fromDate!, toDate: toDate!, startTime: startTime!, endTime: endTime!, totalPaise: totalPaise!, customer: customer!, payment: payment!, notes };
}

/**
 * One booking per day for the same hours across a run of days, for one agreed total (a camp, a tournament, a shoot).
 * The total is split across the days (any odd paise go to the first days). The payment is applied from the first day onward;
 * the first day's advance must be met and the rest are confirmed with it, their balance due later. Everything is booked
 * or nothing is: a day that is already taken stops the whole block and says which. The ground's usual hour limit and closed
 * weekdays do not apply, because the owner or staff are choosing this deliberately.
 */
export function createStaffBlock(staff: UserRow, input: BlockInput): { series: { id: string; days: number }; bookings: Booking[] } {
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const ground = getGroundOr404(input.groundId);
  if (staff.role !== 'super_admin' && scopeOwnerId(staff) !== ground.owner_id) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
  requirePermission(staff, 'manage_bookings');
  requirePermission(staff, 'record_payments');
  const dates: string[] = [];
  for (let d = input.fromDate; d <= input.toDate; d = addDays(d, 1)) { dates.push(d); if (dates.length > MAX_BLOCK_DAYS) throw new HttpError(400, 'BLOCK_TOO_LONG', `A block can cover at most ${MAX_BLOCK_DAYS} days`); }
  const n = dates.length;
  if (input.payment.amountPaise > input.totalPaise) throw new HttpError(409, 'OVERPAYMENT', 'The payment is more than the agreed total');
  const share = Math.floor(input.totalPaise / n), extra = input.totalPaise - share * n;
  const dayTotal = (i: number) => share + (i < extra ? 1 : 0);
  const actor: Actor = { id: staff.id, role: staff.role };

  return tx(() => {
    const t = now();
    const customer = input.customerId ? one<UserRow>('SELECT * FROM users WHERE id = ?', input.customerId)! : findOrCreateCustomer(input.customer);
    const open = { ...ground, closed_days: '[]' }; // the owner is choosing these days on purpose, so the weekly closed day does not stop it
    const plans = dates.map((date) => {
      const all = slotStarts(open, date);
      const first = all.findIndex((s) => timeOfDay(s) === input.startTime);
      if (first < 0) throw new HttpError(400, 'INVALID_SLOT', `${date}: the ground has no slot starting at ${input.startTime}`);
      // measured from midnight, so a ground that stays open past midnight does not count its 12 am to 2 am slots as "before 7 pm"
      const base = istMidnight(date), toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
      const startMin = (all[first]! - base) / MIN;
      let endMin = toMin(input.endTime);
      if (endMin <= startMin) endMin += 24 * 60;                                   // an end like 02:00 means the next morning
      const count = all.slice(first).filter((s) => (s - base) / MIN < endMin).length;
      if (count < 1) throw new HttpError(400, 'INVALID_SLOT', `${date}: nothing falls between ${input.startTime} and ${input.endTime}`);
      return planSlots(open, date, input.startTime, count, t, { ignoreMaxSlots: true });
    });
    for (const p of plans) {
      const hit = p.starts.find((x) => one('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', ground.id, x));
      if (hit) throw new HttpError(409, 'SLOT_TAKEN', `${p.date} is not free for those hours (${timeOfDay(hit)} is taken or blocked). Pick other dates or hours.`, { date: p.date });
    }
    const noMoney = input.payment.amountPaise === 0; // staff may book with nothing received; the whole amount stays due
    const advance = noMoney ? 0 : Math.min(advanceFor(ground, dayTotal(0), plans[0]!.starts[0]!, t), dayTotal(0));
    if (input.payment.amountPaise < advance) throw new HttpError(409, 'ADVANCE_NOT_MET', `At least ${advance} paise must be recorded for the first day to confirm the block`, { advancePaise: advance, totalPaise: dayTotal(0) });

    const seriesId = newId('ser');
    const ids: string[] = [];
    plans.forEach((p, i) => {
      const id = insertBooking({ ground, customerId: customer.id, date: p.date, starts: p.starts, totalPaise: dayTotal(i), advancePaise: i === 0 ? advance : 0, status: 'held', source: input.enquiryId ? 'enquiry' : 'walk_in', payMethod: null, holdExpiresAt: i === 0 ? t + 5 * MIN : null, players: undefined, notes: input.notes ?? null, createdBy: staff.id, enquiryId: input.enquiryId ?? null });
      if (i === 0) run('INSERT INTO booking_series(id, owner_id, customer_id, ground_id, frequency, requested, first_booking_id, created_at, kind) VALUES(?,?,?,?,?,?,?,?,?)', seriesId, ground.owner_id, customer.id, ground.id, 'daily', n, id, t, 'block');
      takeSlots(id, ground, p.starts);
      run('UPDATE bookings SET series_id = ?, series_index = ? WHERE id = ?', seriesId, i, id);
      ids.push(id);
    });
    audit(actor, 'booking.block', 'booking', ids[0]!, { days: n, from: input.fromDate, to: input.toDate, totalPaise: input.totalPaise, customerId: customer.id }, ground.owner_id);
    // The payment goes to the first day up to what it costs, then onward. The first day confirms the whole block.
    let left = input.payment.amountPaise;
    if (noMoney) confirmBooking(ids[0]!, actor, { via: 'offline', noAdvance: true });
    for (let i = 0; i < ids.length && left > 0; i++) {
      const put = Math.min(left, dayTotal(i));
      const r = recordOffline(staff, ids[i]!, { method: input.payment.method, amountPaise: put, reference: i === 0 ? input.payment.reference : undefined });
      if (i === 0 && r.outcome !== 'confirmed') throw new HttpError(409, 'ADVANCE_NOT_MET', 'The recorded payment did not reach the advance');
      left -= put;
    }
    return { series: { id: seriesId, days: n }, bookings: ids.map((id) => viewBooking(id)) };
  });
}

// ---------------------------------------------------------------- views used by routes

export function bookingDetail(id: string) {
  const b = loadBooking(id)!;
  const payments = many<any>('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at, rowid', id);
  return { booking: b, paymentRows: payments };
}


/** One payment against a whole block: it goes to the earliest day that still owes money, then the next, and so on. */
export function recordBlockPayment(staff: UserRow, seriesId: string, input: { method: 'cash' | 'card' | 'upi' | 'bank_transfer'; amountPaise: number; reference?: string; note?: string }) {
  const days = many<{ id: string; total_paise: number; paid_paise: number }>("SELECT id, total_paise, paid_paise FROM bookings WHERE series_id = ? AND status IN ('held','confirmed') ORDER BY series_index", seriesId);
  if (!days.length || !one("SELECT 1 FROM booking_series WHERE id = ? AND kind = 'block'", seriesId)) throw new HttpError(404, 'NOT_FOUND', 'Multi-day booking not found');
  accessBooking(staff, days[0]!.id, 'record_payments');
  const owing = days.reduce((a, d) => a + (d.total_paise - d.paid_paise), 0);
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Amount must be a positive whole number of paise');
  if (input.amountPaise > owing) throw new HttpError(409, 'OVERPAYMENT', `Only ${owing} paise is outstanding on this multi-day booking`);
  return tx(() => {
    let left = input.amountPaise, first = true;
    for (const d of days) {
      if (left <= 0) break;
      const put = Math.min(left, d.total_paise - d.paid_paise);
      if (put <= 0) continue;
      // a payment reference (UTR) can be used once, so it is kept on the first day and noted on the rest
      const note = first ? input.note : [input.note, input.reference ? `Part of payment ${input.reference}` : 'Part of one multi-day payment'].filter(Boolean).join(' · ').slice(0, 200);
      recordOffline(staff, d.id, { method: input.method, amountPaise: put, reference: first ? input.reference : undefined, note });
      first = false;
      left -= put;
    }
    return blockOf(seriesId)!;
  });
}
