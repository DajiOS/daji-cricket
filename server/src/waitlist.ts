import type { HoldResponse, RateRule, WaitlistTier } from '@daji/shared';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { getSettings } from './settings.ts';
import { DAY, HOUR, MIN, addDays, dayOfWeek, fmtDateTime, istDate, timeOfDay } from './time.ts';
import { getGroundOr404, groundRow, type GroundRow } from './grounds.ts';
import { groundRates, ruleWindow } from './rates.ts';
import { isClosedDate } from './closures.ts';
import { linkedBusy } from './groundLinks.ts';
import { hasPermission, requirePermission, scopeOwnerId, type UserRow } from './auth.ts';
import { notify, pushNotify, venueData, whatsappIfAgreed } from './notifications.ts';
import { findOrCreateCustomer, holdSlots, paymentInstructionsFor } from './hold.ts';
import { bookingOr404, viewBooking } from './bookings.ts';
import { createEnquiry } from './enquiries.ts';
import { pricesHidden } from './priceOnEnquiry.ts';
import type { Config } from './config.ts';
import { gamesPlayed } from './players.ts';

// The weekly waitlist (the owner's deal for Sunday leather ball, 28 Oct 2026). A customer asks for a session on the waitlist day and keeps
// rolling to the next week, for up to a year, until one is free for them. Normal bookings come first: a session still free
// waitlistConfirmHours before it starts is offered to everyone waiting for that day, and the first to accept takes it.
// With tier priority on, players who have played most hear first, one wave at a time.
//
// Nothing here decides availability, price or payment on its own. A free session is one the booking tables say is free;
// accepting goes through the normal online hold (hold.ts holdSlots: same price, advance, payment and final double-booking guard), or,
// while prices are on enquiry, through a normal pricing enquiry that staff convert from the desk. The offer row only makes sure
// one waitlist person at a time can take a session.

registerSchema('waitlist-1', `
CREATE TABLE waitlist_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT NOT NULL REFERENCES grounds(id),
  rule_id TEXT,
  rule_label TEXT,
  every_week INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('waiting','won','booked','withdrawn','ended')),
  next_date TEXT NOT NULL,
  until_date TEXT NOT NULL,
  rollovers INTEGER NOT NULL DEFAULT 0,
  games_booked INTEGER NOT NULL DEFAULT 0,
  booking_id TEXT REFERENCES bookings(id),
  enquiry_id TEXT,
  players INTEGER,
  notes TEXT,
  ended_reason TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_waitlist_entry_live ON waitlist_entries(customer_id, ground_id, COALESCE(rule_id, '')) WHERE status IN ('waiting','won');
CREATE INDEX ix_waitlist_entries_due ON waitlist_entries(status, next_date);
CREATE INDEX ix_waitlist_entries_owner ON waitlist_entries(owner_id, status);

CREATE TABLE waitlist_offers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT NOT NULL REFERENCES grounds(id),
  rule_id TEXT NOT NULL,
  rule_label TEXT NOT NULL,
  date TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','taken','closed')),
  wave INTEGER NOT NULL DEFAULT 1,
  wave_ms INTEGER NOT NULL DEFAULT 0,
  next_wave_at INTEGER,
  taken_entry_id TEXT REFERENCES waitlist_entries(id),
  booking_id TEXT REFERENCES bookings(id),
  enquiry_id TEXT,
  closed_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_waitlist_offer_live ON waitlist_offers(ground_id, rule_id, date) WHERE status IN ('open','taken');
CREATE INDEX ix_waitlist_offers_status ON waitlist_offers(status);

CREATE TABLE waitlist_offer_people (
  offer_id TEXT NOT NULL REFERENCES waitlist_offers(id),
  entry_id TEXT NOT NULL REFERENCES waitlist_entries(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  wave INTEGER NOT NULL,
  tier TEXT,
  games INTEGER NOT NULL DEFAULT 0,
  notified_at INTEGER,
  lapsed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, entry_id)
);
CREATE INDEX ix_waitlist_offer_people_customer ON waitlist_offer_people(customer_id);
`);

/** A request lasts for this many weeks of the waitlist day (the owner's "whole year"). */
export const WAITLIST_WEEKS = 52;
/** A customer may wait for this many sessions at once. */
export const MAX_ENTRIES_PER_CUSTOMER = 3;

export interface EntryRow {
  id: string; owner_id: string; customer_id: string; ground_id: string; rule_id: string | null; rule_label: string | null; every_week: number;
  status: 'waiting' | 'won' | 'booked' | 'withdrawn' | 'ended'; next_date: string; until_date: string; rollovers: number; games_booked: number;
  booking_id: string | null; enquiry_id: string | null; players: number | null; notes: string | null; ended_reason: string | null; created_by: string | null; created_at: number; updated_at: number;
}
export interface OfferRow {
  id: string; owner_id: string; ground_id: string; rule_id: string; rule_label: string; date: string; start_at: number; end_at: number;
  status: 'open' | 'taken' | 'closed'; wave: number; wave_ms: number; next_wave_at: number | null; taken_entry_id: string | null;
  booking_id: string | null; enquiry_id: string | null; closed_reason: string | null; created_at: number; updated_at: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BALL_WORDS: Record<string, string> = { leather: 'leather ball', combo: 'red and white ball', tennis: 'tennis ball' };
const entryRow = (id: string) => one<EntryRow>('SELECT * FROM waitlist_entries WHERE id = ?', id);
const offerRow = (id: string) => one<OfferRow>('SELECT * FROM waitlist_offers WHERE id = ?', id);

/** "Sunday leather ball", from the settings. */
export function waitlistName(): string { const s = getSettings(); return `${DAY_NAMES[s.waitlistDay]} ${BALL_WORDS[s.waitlistBall] ?? s.waitlistBall}`; }

function requireOn(): void {
  if (!getSettings().waitlistEnabled) throw new HttpError(503, 'FEATURE_OFF', 'The waitlist is switched off for now. Please book a free slot or call the ground.');
}

/** The whole sessions on a ground's price list the waitlist is for: the waitlist ball, offered on the waitlist day. */
export function waitlistSessions(g: Pick<GroundRow, 'rates'>): RateRule[] {
  const s = getSettings();
  return groundRates(g).filter((r) => r.mode === 'fixed' && (r.bundleDays ?? 1) === 1 && r.days.includes(s.waitlistDay) && r.ball === s.waitlistBall);
}

/** The first waitlist day on or after `from`. */
export function waitlistDayFrom(from: string): string { return addDays(from, (getSettings().waitlistDay - dayOfWeek(from) + 7) % 7); }

/** Games played here in the last 12 months by every player who checked in, not only the booker (players.ts). */
export { gamesPlayed };

/** Which wave someone is in: 1 for the top tier, then each tier in turn, and everyone below every tier last. All 1 when tier priority is off. */
export function tierFor(games: number, s = getSettings()): { wave: number; tier: string | null } {
  const tiers: WaitlistTier[] = [...s.waitlistTiers].sort((a, b) => b.minGames - a.minGames);
  const at = tiers.findIndex((x) => games >= x.minGames);
  if (!s.waitlistTierPriority) return { wave: 1, tier: at >= 0 ? tiers[at]!.name : null };
  return at >= 0 ? { wave: at + 1, tier: tiers[at]!.name } : { wave: tiers.length + 1, tier: null };
}

function sessionWords(label: string | null, date: string): string {
  return `${label ?? waitlistName() + ' session'} on ${DAY_NAMES[dayOfWeek(date)]} ${Number(date.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(date.slice(5, 7)) - 1]}`;
}
const groundName = (id: string): string => groundRow(id)?.name ?? 'the ground';

/** The window of a session on a date, or null when it does not run that day (the ground is shut, or the session is not on the price list that day). */
function windowOf(g: GroundRow, rule: RateRule, date: string): { start: number; end: number; slotStarts: number[] } | null {
  if (!rule.days.includes(dayOfWeek(date))) return null;
  return ruleWindow(g, date, rule);
}

/** Free means what the booking tables say: no booking or block on any slot, nothing on a linked ground, the day open for online booking. */
function sessionFree(g: GroundRow, w: { slotStarts: number[] }, date: string): boolean {
  const s = getSettings();
  if (!g.active || isClosedDate(date, 'ground')) return false;
  if ((s.bookingsOpenFrom && date < s.bookingsOpenFrom) || (s.bookingsCloseFrom && date >= s.bookingsCloseFrom)) return false;
  if (w.slotStarts.some((x) => one('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, x))) return false;
  return linkedBusy(g, w.slotStarts).size === 0;
}

/** The last moment a session can be taken: its start, less the ground's minimum notice. */
const lastCall = (g: GroundRow, o: { start_at: number }): number => o.start_at - g.min_notice_minutes * MIN;

// ---------------------------------------------------------------- joining and leaving

export interface JoinInput { groundId: string; ruleId?: string; everyWeek: boolean; players?: number; notes?: string }

export function parseJoin(body: unknown): JoinInput {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true, max: 60 });
  const ruleId = v.str('ruleId', { max: 40 });
  const everyWeek = v.bool('everyWeek');
  const players = v.int('players', { min: 1, max: 60 });
  const notes = v.str('notes', { max: 300 });
  v.done();
  return { groundId: groundId!, ruleId: ruleId || undefined, everyWeek: !!everyWeek, players, notes };
}

/** Puts a customer on the waitlist. Asking again for the same thing returns the request already there (a second tap, a lost answer). */
export function joinWaitlist(actor: Actor, customer: UserRow, input: JoinInput): { entry: EntryView; created: boolean } {
  requireOn();
  const g = getGroundOr404(input.groundId);
  if (!g.active) throw new HttpError(409, 'GROUND_INACTIVE', 'This ground is not taking bookings right now');
  const sessions = waitlistSessions(g);
  if (!sessions.length) throw new HttpError(409, 'NO_WAITLIST_SESSIONS', `${g.name} has no ${waitlistName()} session on its price list, so there is nothing to wait for.`);
  const rule = input.ruleId ? sessions.find((r) => r.id === input.ruleId) : undefined;
  if (input.ruleId && !rule) throw new HttpError(400, 'VALIDATION_FAILED', `That is not a ${waitlistName()} session`, { fields: [{ field: 'ruleId', message: `One of ${sessions.map((r) => r.id).join(', ')}, or leave it out for any of them` }] });
  const t = now();
  const s = getSettings();
  // the first waitlist day still to come: today counts while a session that day has not started; never before online bookings open
  let first = waitlistDayFrom(istDate(t));
  const today = (rule ? [rule] : sessions).map((r) => windowOf(g, r, first)).filter(Boolean).some((w) => w!.start > t);
  if (!today && first === istDate(t)) first = addDays(first, 7);
  if (s.bookingsOpenFrom && first < s.bookingsOpenFrom) first = waitlistDayFrom(s.bookingsOpenFrom);
  const until = addDays(first, 7 * (WAITLIST_WEEKS - 1));
  const out = tx(() => {
    const same = one<EntryRow>("SELECT * FROM waitlist_entries WHERE customer_id = ? AND ground_id = ? AND COALESCE(rule_id, '') = ? AND status IN ('waiting','won')", customer.id, g.id, rule?.id ?? '');
    if (same) return { id: same.id, created: false };
    const live = one<{ n: number }>("SELECT COUNT(*) n FROM waitlist_entries WHERE customer_id = ? AND status IN ('waiting','won')", customer.id)!.n;
    if (live >= MAX_ENTRIES_PER_CUSTOMER) throw new HttpError(409, 'TOO_MANY_WAITLIST', `You are already waiting for ${live} sessions. Leave one first.`);
    const id = newId('wle');
    run(`INSERT INTO waitlist_entries(id, owner_id, customer_id, ground_id, rule_id, rule_label, every_week, status, next_date, until_date, players, notes, created_by, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,'waiting',?,?,?,?,?,?,?)`, id, g.owner_id, customer.id, g.id, rule?.id ?? null, rule?.label ?? null, input.everyWeek ? 1 : 0, first, until, input.players ?? null, input.notes ?? null, actor.id, t, t);
    audit(actor, 'waitlist.join', 'waitlist', id, { customerId: customer.id, groundId: g.id, ruleId: rule?.id ?? null, everyWeek: input.everyWeek, firstDate: first, untilDate: until }, g.owner_id);
    return { id, created: true };
  });
  if (out.created) {
    const e = entryRow(out.id)!;
    notify(customer.id, 'waitlist_joined', { ground: g.name, extra: e.rule_label ?? `a ${waitlistName()} session`, name: `${s.waitlistConfirmHours} hours before it starts` });
    // a session already offered for that day takes them in straight away
    for (const o of many<OfferRow>("SELECT * FROM waitlist_offers WHERE ground_id = ? AND date = ? AND status IN ('open','taken')", g.id, e.next_date)) {
      if (!e.rule_id || e.rule_id === o.rule_id) addPerson(o, e, t);
    }
  }
  return { entry: entryView(entryRow(out.id)!, t), created: out.created };
}

/** Leaves the waitlist. A customer leaves their own; staff need manage_bookings and a reason. */
export function withdrawEntry(user: UserRow, id: string, body: unknown): EntryView {
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { max: 200 });
  v.done();
  const e = entryRow(id);
  if (!e) throw notFound('Waitlist request not found');
  if (user.role === 'customer') { if (e.customer_id !== user.id) throw notFound('Waitlist request not found'); }
  else {
    if (user.role !== 'super_admin' && scopeOwnerId(user) !== e.owner_id) throw notFound('Waitlist request not found');
    requirePermission(user, 'manage_bookings');
    if (!reason || reason.length < 3) throw new HttpError(400, 'VALIDATION_FAILED', 'Say why you are taking them off the waitlist', { fields: [{ field: 'reason', message: 'At least 3 characters' }] });
  }
  if (e.status !== 'waiting' && e.status !== 'won') return entryView(e, now());
  tx(() => {
    run("UPDATE waitlist_entries SET status = 'withdrawn', ended_reason = ?, updated_at = ? WHERE id = ? AND status IN ('waiting','won')", reason ?? (user.role === 'customer' ? 'left the waitlist' : 'taken off by staff'), now(), id);
    run('UPDATE waitlist_offer_people SET lapsed = 1 WHERE entry_id = ?', id);
    audit({ id: user.id, role: user.role }, 'waitlist.withdraw', 'waitlist', id, { by: user.role === 'customer' ? 'customer' : 'staff', reason: reason ?? null }, e.owner_id);
  });
  if (user.role !== 'customer') notify(e.customer_id, 'waitlist_ended', { ground: groundName(e.ground_id), extra: e.rule_label ?? `a ${waitlistName()} session`, reason: reason });
  return entryView(entryRow(id)!, now());
}

// ---------------------------------------------------------------- offers

/** Adds one waiting person to an offer, and tells them now when their wave is already out. */
function addPerson(o: OfferRow, e: EntryRow, t: number): void {
  if (one('SELECT 1 FROM waitlist_offer_people WHERE offer_id = ? AND entry_id = ?', o.id, e.id)) return;
  const games = gamesPlayed(e.customer_id, e.owner_id, t);
  const { wave, tier } = tierFor(games);
  run('INSERT INTO waitlist_offer_people(offer_id, entry_id, customer_id, wave, tier, games) VALUES(?,?,?,?,?,?)', o.id, e.id, e.customer_id, wave, tier, games);
  if (o.status === 'open' && wave <= o.wave) tell(o, [e.customer_id], 'waitlist_offer', t);
}

/** App and email (the normal booking messages) and WhatsApp for those who agreed to it. Marks them told. */
function tell(o: OfferRow, customerIds: string[], template: 'waitlist_offer' | 'waitlist_free_again', t: number): void {
  const data = { ground: groundName(o.ground_id), extra: `${sessionWords(o.rule_label, o.date)}, ${timeOfDay(o.start_at)} to ${timeOfDay(o.end_at)}`, ...venueData(o.ground_id) };
  for (const c of customerIds) {
    run('UPDATE waitlist_offer_people SET notified_at = ? WHERE offer_id = ? AND customer_id = ? AND notified_at IS NULL', t, o.id, c);
    notify(c, template, data);
    whatsappIfAgreed(c, template, data);
  }
}

/** The waves still to come on an offer: the people not yet told, by wave. */
const nextWaveOf = (o: OfferRow): number | null => one<{ w: number | null }>('SELECT MIN(wave) w FROM waitlist_offer_people WHERE offer_id = ? AND wave > ? AND lapsed = 0', o.id, o.wave)?.w ?? null;

/** A session free inside the waitlist window becomes an offer for everyone waiting for that day. */
function openOffer(g: GroundRow, rule: RateRule, date: string, w: { start: number; end: number }, waiting: EntryRow[], t: number): void {
  const s = getSettings();
  const id = newId('wlo');
  run(`INSERT INTO waitlist_offers(id, owner_id, ground_id, rule_id, rule_label, date, start_at, end_at, status, wave, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,'open',0,?,?)`,
    id, g.owner_id, g.id, rule.id, rule.label, date, w.start, w.end, t, t);
  for (const e of waiting) {
    const games = gamesPlayed(e.customer_id, e.owner_id, t);
    const { wave, tier } = tierFor(games, s);
    run('INSERT INTO waitlist_offer_people(offer_id, entry_id, customer_id, wave, tier, games) VALUES(?,?,?,?,?,?)', id, e.id, e.customer_id, wave, tier, games);
  }
  const waves = many<{ wave: number }>('SELECT DISTINCT wave FROM waitlist_offer_people WHERE offer_id = ? ORDER BY wave', id).map((r) => r.wave);
  // each wave gets the set minutes to itself, squeezed so the last wave is still told well before the session (half the time left, shared out)
  const left = Math.max(0, lastCall(g, { start_at: w.start }) - t);
  const waveMs = waves.length > 1 ? Math.min(s.waitlistWaveMinutes * MIN, Math.floor(left / 2 / (waves.length - 1))) : 0;
  const firstWave = waves[0]!;
  run('UPDATE waitlist_offers SET wave = ?, wave_ms = ?, next_wave_at = ? WHERE id = ?', firstWave, waveMs, waves.length > 1 ? t + waveMs : null, id);
  audit(SYSTEM, 'waitlist.offer', 'waitlist_offer', id, { groundId: g.id, ruleId: rule.id, date, people: waiting.length, waves: waves.length, waveMinutes: Math.round(waveMs / MIN), tierPriority: s.waitlistTierPriority }, g.owner_id);
  const o = offerRow(id)!;
  tell(o, many<{ customer_id: string }>('SELECT customer_id FROM waitlist_offer_people WHERE offer_id = ? AND wave <= ?', id, firstWave).map((r) => r.customer_id), 'waitlist_offer', t);
}

export interface AcceptResult { offerId: string; via: 'booking' | 'enquiry'; hold?: HoldResponse; enquiryId?: string; already?: boolean }

/**
 * The customer takes an offered session. One waitlist person wins: the offer is claimed in one statement, and the slots are then
 * held through the normal online hold, whose slot table refuses a second booking. Accepting twice returns what the first accept made.
 */
export async function acceptOffer(cfg: Config, user: UserRow, offerId: string): Promise<AcceptResult> {
  requireOn();
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the customer on the waitlist can accept');
  const o = offerRow(offerId);
  const me = o ? one<{ entry_id: string; notified_at: number | null; lapsed: number }>('SELECT entry_id, notified_at, lapsed FROM waitlist_offer_people WHERE offer_id = ? AND customer_id = ?', o.id, user.id) : undefined;
  if (!o || !me) throw notFound('Waitlist offer not found');
  const e = entryRow(me.entry_id)!;
  if (o.status === 'taken' && o.taken_entry_id === e.id) {
    // the same person again: hand back what they already have
    if (o.booking_id) {
      const payment = bookingOr404(o.booking_id).status === 'held' ? paymentInstructionsFor(cfg, user, o.booking_id) : { mode: 'none' as const, amountPaise: 0, paymentId: null };
      return { offerId: o.id, via: 'booking', already: true, hold: { booking: viewBooking(o.booking_id), payment, creditAppliedPaise: 0 } };
    }
    return { offerId: o.id, via: 'enquiry', enquiryId: o.enquiry_id ?? undefined, already: true };
  }
  if (o.status !== 'open') throw new HttpError(409, 'OFFER_GONE', o.status === 'taken' ? 'Someone on the waitlist accepted this session first. You stay on the waitlist.' : 'This session is no longer free. You stay on the waitlist.');
  if (me.lapsed || e.status !== 'waiting' || e.next_date !== o.date) throw new HttpError(409, 'OFFER_NOT_FOR_YOU', 'This offer is no longer open to you.');
  if (!me.notified_at) throw new HttpError(409, 'NOT_YOUR_WAVE_YET', 'Players with priority are being offered this session first. We will message you if it is still free.');
  const g = getGroundOr404(o.ground_id);
  const t = now();
  if (t >= lastCall(g, o)) throw new HttpError(409, 'OFFER_GONE', 'This session has already started.');
  // the claim: only one accept can move the offer from open to taken
  const claimed = run("UPDATE waitlist_offers SET status = 'taken', taken_entry_id = ?, updated_at = ? WHERE id = ? AND status = 'open'", e.id, t, o.id).changes;
  if (!claimed) throw new HttpError(409, 'OFFER_GONE', 'Someone on the waitlist accepted this session first. You stay on the waitlist.');
  const giveBack = (why: 'reopen' | 'close', reason?: string) => run(`UPDATE waitlist_offers SET status = ?, taken_entry_id = NULL, closed_reason = ?, updated_at = ? WHERE id = ? AND status = 'taken' AND taken_entry_id = ?`, why === 'reopen' ? 'open' : 'closed', reason ?? null, now(), o.id, e.id);

  if (pricesHidden(user)) {
    // prices are on enquiry: the ground prices the slot and confirms it from the desk (enquiries.ts convertEnquiry), as for any slot
    let enquiryId: string;
    try {
      enquiryId = createEnquiry(user, { groundId: g.id, preferredDate: o.date, preferredTime: timeOfDay(o.start_at), preferredLabel: o.rule_label, players: e.players ?? undefined,
        message: `Waitlist: ${sessionWords(o.rule_label, o.date)}, ${timeOfDay(o.start_at)} to ${timeOfDay(o.end_at)}. Accepted from the ${waitlistName()} waitlist; please confirm the price and the booking.` }).id;
    } catch (err) { giveBack('reopen'); throw err; }
    tx(() => {
      run('UPDATE waitlist_offers SET enquiry_id = ?, updated_at = ? WHERE id = ?', enquiryId, now(), o.id);
      run("UPDATE waitlist_entries SET status = 'won', enquiry_id = ?, booking_id = NULL, updated_at = ? WHERE id = ?", enquiryId, now(), e.id);
      audit({ id: user.id, role: user.role }, 'waitlist.accept', 'waitlist_offer', o.id, { entryId: e.id, via: 'enquiry', enquiryId }, o.owner_id);
    });
    tellOthersTaken(o, user.id);
    return { offerId: o.id, via: 'enquiry', enquiryId };
  }

  let hold: HoldResponse;
  try {
    hold = await holdSlots(cfg, user, { groundId: g.id, date: o.date, startTime: timeOfDay(o.start_at), ruleId: o.rule_id, players: e.players ?? undefined, notes: e.notes ?? undefined });
  } catch (err) {
    const code = err instanceof HttpError ? err.code : '';
    if (code === 'SLOT_TAKEN' || code === 'SLOT_IN_PAST' || code === 'DATE_CLOSED' || code === 'CLOSED_DAY' || code === 'BOOKINGS_CLOSED' || code === 'NOT_OPEN_YET' || code === 'INVALID_SLOT') {
      giveBack('close', 'no longer free');
      throw new HttpError(409, 'OFFER_GONE', 'This session is no longer free. You stay on the waitlist.');
    }
    giveBack('reopen');
    throw err;
  }
  tx(() => {
    run('UPDATE waitlist_offers SET booking_id = ?, updated_at = ? WHERE id = ?', hold.booking.id, now(), o.id);
    run("UPDATE waitlist_entries SET status = 'won', booking_id = ?, enquiry_id = NULL, updated_at = ? WHERE id = ?", hold.booking.id, now(), e.id);
    run("UPDATE bookings SET notes = TRIM(COALESCE(notes, '') || ' ' || ?) WHERE id = ?", `[waitlist ${o.id}]`, hold.booking.id);
    audit({ id: user.id, role: user.role }, 'waitlist.accept', 'waitlist_offer', o.id, { entryId: e.id, via: 'booking', bookingId: hold.booking.id }, o.owner_id);
  });
  tellOthersTaken(o, user.id);
  return { offerId: o.id, via: 'booking', hold };
}

function tellOthersTaken(o: OfferRow, winner: string): void {
  const data = { ground: groundName(o.ground_id), extra: sessionWords(o.rule_label, o.date) };
  for (const r of many<{ customer_id: string }>('SELECT customer_id FROM waitlist_offer_people WHERE offer_id = ? AND customer_id <> ? AND notified_at IS NOT NULL AND lapsed = 0', o.id, winner)) {
    pushNotify(r.customer_id, 'waitlist_taken', 'The waitlist slot has gone', `Someone else accepted ${data.extra} at ${data.ground} first. You stay on the waitlist.`);
  }
}

// ---------------------------------------------------------------- the sweep

export interface WaitlistSweep { offered: number; waves: number; reopened: number; closed: number; rolled: number; ended: number; played: number }

/**
 * Runs every minute with the other booking sweeps. Safe to run any number of times:
 *  1. a taken offer whose hold lapsed (not paid, cancelled) or whose enquiry was closed goes back to the others;
 *  2. an open offer closes when its session starts or someone books it the normal way;
 *  3. the next priority wave is told when its turn comes;
 *  4. a session free inside the waitlist window is offered to everyone waiting for that day;
 *  5. when the day is over, everyone still waiting moves to the next week (or the request ends after a year).
 */
export function sweepWaitlist(t = now()): WaitlistSweep {
  const res: WaitlistSweep = { offered: 0, waves: 0, reopened: 0, closed: 0, rolled: 0, ended: 0, played: 0 };
  const s = getSettings();

  for (const o of many<OfferRow>("SELECT * FROM waitlist_offers WHERE status = 'taken'")) {
    tx(() => {
      const cur = offerRow(o.id)!;
      if (cur.status !== 'taken') return;
      if (cur.enquiry_id && !cur.booking_id) {
        const q = one<{ status: string; booking_id: string | null }>('SELECT status, booking_id FROM enquiries WHERE id = ?', cur.enquiry_id);
        if (q?.status === 'converted' && q.booking_id) {
          run('UPDATE waitlist_offers SET booking_id = ?, updated_at = ? WHERE id = ?', q.booking_id, t, cur.id);
          run('UPDATE waitlist_entries SET booking_id = ?, updated_at = ? WHERE id = ?', q.booking_id, t, cur.taken_entry_id);
          return;
        }
        if (q && q.status !== 'closed') return;
      } else if (cur.booking_id) {
        const b = one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', cur.booking_id);
        if (b && b.status !== 'expired' && b.status !== 'cancelled') return;
      } else return; // the hold is still being made
      // the winner let it go: they stay on the waitlist, and the session goes back to the others
      run('UPDATE waitlist_offer_people SET lapsed = 1 WHERE offer_id = ? AND entry_id = ?', cur.id, cur.taken_entry_id);
      run("UPDATE waitlist_entries SET status = 'waiting', booking_id = NULL, enquiry_id = NULL, updated_at = ? WHERE id = ? AND status = 'won'", t, cur.taken_entry_id);
      run("UPDATE waitlist_offers SET status = 'open', taken_entry_id = NULL, booking_id = NULL, enquiry_id = NULL, updated_at = ? WHERE id = ?", t, cur.id);
      audit(SYSTEM, 'waitlist.reopen', 'waitlist_offer', cur.id, { lapsedEntryId: cur.taken_entry_id }, cur.owner_id);
      const again = offerRow(cur.id)!;
      for (const r of many<{ customer_id: string }>('SELECT customer_id FROM waitlist_offer_people WHERE offer_id = ? AND notified_at IS NOT NULL AND lapsed = 0', cur.id)) {
        notify(r.customer_id, 'waitlist_free_again', { ground: groundName(again.ground_id), extra: `${sessionWords(again.rule_label, again.date)}, ${timeOfDay(again.start_at)} to ${timeOfDay(again.end_at)}` });
        whatsappIfAgreed(r.customer_id, 'waitlist_free_again', { ground: groundName(again.ground_id), extra: `${sessionWords(again.rule_label, again.date)}, ${timeOfDay(again.start_at)} to ${timeOfDay(again.end_at)}` });
      }
      res.reopened++;
    });
  }

  for (const o of many<OfferRow>("SELECT * FROM waitlist_offers WHERE status = 'open'")) {
    const g = groundRow(o.ground_id) as GroundRow | undefined;
    const rule = g ? groundRates(g).find((r) => r.id === o.rule_id) : undefined;
    const w = g && rule ? windowOf(g, rule, o.date) : null;
    const reason = !g || !rule || !w ? 'session no longer on the price list' : t >= lastCall(g, o) ? 'session started' : !sessionFree(g, w, o.date) ? 'booked by someone else' : null;
    if (reason) {
      run("UPDATE waitlist_offers SET status = 'closed', closed_reason = ?, next_wave_at = NULL, updated_at = ? WHERE id = ? AND status = 'open'", reason, t, o.id);
      audit(SYSTEM, 'waitlist.offer_close', 'waitlist_offer', o.id, { reason }, o.owner_id);
      res.closed++;
      continue;
    }
    if (o.next_wave_at !== null && o.next_wave_at <= t) {
      tx(() => {
        const cur = offerRow(o.id)!;
        if (cur.status !== 'open' || cur.next_wave_at === null || cur.next_wave_at > t) return;
        const wave = nextWaveOf(cur);
        if (wave === null) { run('UPDATE waitlist_offers SET next_wave_at = NULL WHERE id = ?', cur.id); return; }
        const after = one<{ w: number | null }>('SELECT MIN(wave) w FROM waitlist_offer_people WHERE offer_id = ? AND wave > ? AND lapsed = 0', cur.id, wave)?.w ?? null;
        run('UPDATE waitlist_offers SET wave = ?, next_wave_at = ?, updated_at = ? WHERE id = ?', wave, after === null ? null : t + cur.wave_ms, t, cur.id);
        audit(SYSTEM, 'waitlist.wave', 'waitlist_offer', cur.id, { wave }, cur.owner_id);
        tell(offerRow(cur.id)!, many<{ customer_id: string }>('SELECT customer_id FROM waitlist_offer_people WHERE offer_id = ? AND wave <= ? AND notified_at IS NULL AND lapsed = 0', cur.id, wave).map((r) => r.customer_id), 'waitlist_offer', t);
        res.waves++;
      });
    }
  }

  if (s.waitlistEnabled) {
    // 4. sessions inside the window, for each ground and day someone is waiting for
    const groups = many<{ ground_id: string; next_date: string }>("SELECT DISTINCT ground_id, next_date FROM waitlist_entries WHERE status = 'waiting' AND next_date <= ?", istDate(t + s.waitlistConfirmHours * HOUR + DAY));
    for (const grp of groups) {
      const g = groundRow(grp.ground_id) as GroundRow | undefined;
      if (!g) continue;
      for (const rule of waitlistSessions(g)) {
        const w = windowOf(g, rule, grp.next_date);
        if (!w || t < w.start - s.waitlistConfirmHours * HOUR || t >= lastCall(g, { start_at: w.start })) continue;
        if (one("SELECT 1 FROM waitlist_offers WHERE ground_id = ? AND rule_id = ? AND date = ? AND status IN ('open','taken')", g.id, rule.id, grp.next_date)) continue;
        // a session closed once (booked, then cancelled late) can be offered again: the closed row stays as history
        if (!sessionFree(g, w, grp.next_date)) continue;
        const waiting = many<EntryRow>("SELECT * FROM waitlist_entries WHERE status = 'waiting' AND ground_id = ? AND next_date = ? AND (rule_id IS NULL OR rule_id = ?) ORDER BY created_at, id", g.id, grp.next_date, rule.id);
        if (!waiting.length) continue;
        tx(() => openOffer(g, rule, grp.next_date, w, waiting, t));
        res.offered++;
      }
    }
  }

  // 5. the day is over: a win that was played counts; everyone else moves on a week
  const today = istDate(t);
  for (const e of many<EntryRow>("SELECT * FROM waitlist_entries WHERE status IN ('waiting','won') AND next_date < ?", today)) {
    tx(() => {
      const cur = entryRow(e.id)!;
      if ((cur.status !== 'waiting' && cur.status !== 'won') || cur.next_date >= today) return;
      const b = cur.booking_id ? one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', cur.booking_id) : undefined;
      const played = cur.status === 'won' && !!b && (b.status === 'confirmed' || b.status === 'completed' || b.status === 'no_show');
      let next = addDays(cur.next_date, 7);
      while (next < today) next = addDays(next, 7); // the server was off for a while
      const words = { ground: groundName(cur.ground_id), extra: cur.rule_label ?? `a ${waitlistName()} session`, reason: sessionWords(null, cur.next_date).replace(/^.* on /, '') };
      if (played) res.played++;
      if (played && !cur.every_week) {
        run("UPDATE waitlist_entries SET status = 'booked', games_booked = games_booked + 1, updated_at = ? WHERE id = ?", t, cur.id);
        audit(SYSTEM, 'waitlist.played', 'waitlist', cur.id, { date: cur.next_date, bookingId: cur.booking_id }, cur.owner_id);
        return;
      }
      if (next > cur.until_date) {
        run("UPDATE waitlist_entries SET status = 'ended', ended_reason = 'a year has passed', games_booked = games_booked + ?, booking_id = NULL, enquiry_id = NULL, updated_at = ? WHERE id = ?", played ? 1 : 0, t, cur.id);
        audit(SYSTEM, 'waitlist.end', 'waitlist', cur.id, { lastDate: cur.next_date }, cur.owner_id);
        notify(cur.customer_id, 'waitlist_ended', { ...words, reason: 'it ran for a year' });
        res.ended++;
        return;
      }
      run("UPDATE waitlist_entries SET status = 'waiting', next_date = ?, rollovers = rollovers + ?, games_booked = games_booked + ?, booking_id = NULL, enquiry_id = NULL, updated_at = ? WHERE id = ?", next, played ? 0 : 1, played ? 1 : 0, t, cur.id);
      audit(SYSTEM, played ? 'waitlist.played' : 'waitlist.rollover', 'waitlist', cur.id, { from: cur.next_date, to: next }, cur.owner_id);
      if (!played) { pushNotify(cur.customer_id, 'waitlist_rolled', 'Waitlist: moved to next week', `There was no free slot for you on ${words.reason}. You are on the waitlist for ${sessionWords(cur.rule_label, next)} now.`); res.rolled++; }
    });
  }
  return res;
}

// ---------------------------------------------------------------- views

export interface EntryView {
  id: string; groundId: string; groundName: string; ruleId: string | null; session: string; everyWeek: boolean;
  status: EntryRow['status']; nextDate: string; untilDate: string; rollovers: number; gamesBooked: number; bookingId: string | null; enquiryId: string | null;
  players: number | null; notes: string | null; endedReason: string | null; createdAt: number;
}
export function entryView(e: EntryRow, _t: number): EntryView {
  return { id: e.id, groundId: e.ground_id, groundName: groundName(e.ground_id), ruleId: e.rule_id, session: e.rule_label ?? `Any ${waitlistName()} session`, everyWeek: !!e.every_week,
    status: e.status, nextDate: e.next_date, untilDate: e.until_date, rollovers: e.rollovers, gamesBooked: e.games_booked, bookingId: e.booking_id, enquiryId: e.enquiry_id,
    players: e.players, notes: e.notes, endedReason: e.ended_reason, createdAt: e.created_at };
}

export interface OfferView { id: string; groundId: string; groundName: string; ruleId: string; session: string; date: string; startAt: number; endAt: number; time: string; endTime: string; status: OfferRow['status']; wave: number; nextWaveAt: number | null; closedReason: string | null }
const offerView = (o: OfferRow): OfferView => ({ id: o.id, groundId: o.ground_id, groundName: groundName(o.ground_id), ruleId: o.rule_id, session: o.rule_label, date: o.date, startAt: o.start_at, endAt: o.end_at,
  time: timeOfDay(o.start_at), endTime: timeOfDay(o.end_at), status: o.status, wave: o.wave, nextWaveAt: o.next_wave_at, closedReason: o.closed_reason });

function settingsView() {
  const s = getSettings();
  return { enabled: s.waitlistEnabled, name: waitlistName(), day: s.waitlistDay, ball: s.waitlistBall, confirmHours: s.waitlistConfirmHours, tierPriority: s.waitlistTierPriority, waveMinutes: s.waitlistWaveMinutes, tiers: s.waitlistTiers, weeks: WAITLIST_WEEKS };
}

/** The customer's side: their requests, the offers open to them now, the sessions they can wait for, and their games and tier. */
export function myWaitlist(user: UserRow) {
  const t = now();
  const s = getSettings();
  const entries = many<EntryRow>("SELECT * FROM waitlist_entries WHERE customer_id = ? ORDER BY CASE WHEN status IN ('waiting','won') THEN 0 ELSE 1 END, updated_at DESC LIMIT 50", user.id).map((e) => entryView(e, t));
  const offers = many<OfferRow & { notified_at: number | null; lapsed: number; entry_id: string }>(
    `SELECT o.*, p.notified_at, p.lapsed, p.entry_id FROM waitlist_offers o JOIN waitlist_offer_people p ON p.offer_id = o.id
      WHERE p.customer_id = ? AND (o.status = 'open' OR (o.status = 'taken' AND o.taken_entry_id = p.entry_id)) AND o.start_at > ? ORDER BY o.start_at`, user.id, t)
    .filter((o) => o.notified_at !== null && (!o.lapsed || o.taken_entry_id === o.entry_id))
    .map((o) => ({ ...offerView(o), yours: o.status === 'taken', bookingId: o.status === 'taken' ? o.booking_id : null, enquiryId: o.status === 'taken' ? o.enquiry_id : null }));
  const hide = pricesHidden(user);
  const sessions = many<GroundRow>('SELECT * FROM grounds WHERE active = 1 ORDER BY name').flatMap((g) => waitlistSessions(g).map((r) => ({ groundId: g.id, groundName: g.name, ruleId: r.id, label: r.label, from: r.from, to: r.to, pricePaise: hide ? null : r.pricePaise })));
  const owners = [...new Set(many<{ owner_id: string }>('SELECT DISTINCT owner_id FROM grounds WHERE active = 1').map((r) => r.owner_id))];
  const games = owners.reduce((n, o) => n + gamesPlayed(user.id, o, t), 0);
  const tier = tierFor(games, s);
  return { settings: settingsView(), entries, offers, sessions, games, tier: s.waitlistTierPriority ? tier.tier : null, wave: s.waitlistTierPriority ? tier.wave : null };
}

/** The desk's side: who is waiting (with their games and tier), the offers now and lately, for one owner. */
export function staffWaitlist(user: UserRow, ownerId: string) {
  requirePermission(user, 'manage_bookings');
  const t = now();
  const s = getSettings();
  const names = hasPermission(user, 'view_customers');
  const entries = many<EntryRow & { name: string; phone: string | null }>(
    `SELECT e.*, u.name, u.phone FROM waitlist_entries e JOIN users u ON u.id = e.customer_id WHERE e.owner_id = ?
      ORDER BY CASE WHEN e.status IN ('waiting','won') THEN 0 ELSE 1 END, e.next_date, e.created_at LIMIT 500`, ownerId).map((e) => {
    const games = gamesPlayed(e.customer_id, ownerId, t);
    const tier = tierFor(games, s);
    return { ...entryView(e, t), customerId: e.customer_id, customerName: e.name, customerPhone: names ? e.phone : null, games, tier: tier.tier, wave: s.waitlistTierPriority ? tier.wave : 1 };
  });
  const offers = many<OfferRow>("SELECT * FROM waitlist_offers WHERE owner_id = ? AND (status IN ('open','taken') OR updated_at >= ?) ORDER BY start_at DESC LIMIT 100", ownerId, t - 14 * DAY).map((o) => {
    const people = many<{ wave: number; notified_at: number | null; lapsed: number }>('SELECT wave, notified_at, lapsed FROM waitlist_offer_people WHERE offer_id = ?', o.id);
    const taker = o.taken_entry_id ? one<{ name: string }>('SELECT u.name FROM waitlist_entries e JOIN users u ON u.id = e.customer_id WHERE e.id = ?', o.taken_entry_id) : undefined;
    return { ...offerView(o), people: people.length, told: people.filter((p) => p.notified_at !== null).length, lapsed: people.filter((p) => p.lapsed).length, takenBy: taker?.name ?? null, bookingId: o.booking_id, enquiryId: o.enquiry_id };
  });
  const waiting = entries.filter((e) => e.status === 'waiting' || e.status === 'won').length;
  return { settings: settingsView(), waiting, entries, offers, at: fmtDateTime(t) };
}

/** Staff put a customer on the waitlist (found by phone, or a new record without a login, like a walk-in). */
export function staffJoin(staff: UserRow, ownerId: string, body: unknown) {
  requirePermission(staff, 'manage_bookings');
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { customer: c, ...rest } = raw;
  const input = parseJoin(rest);
  const g = getGroundOr404(input.groundId);
  if (g.owner_id !== ownerId) throw notFound('Ground not found');
  const cv = new Validator(c ?? {});
  const name = cv.str('name', { required: true, min: 2, max: 80 });
  const phone = cv.phone('phone', true);
  const email = cv.email('email');
  cv.done();
  const customer = findOrCreateCustomer({ name: name!, phone: phone!, email: email ?? undefined });
  return joinWaitlist({ id: staff.id, role: staff.role }, customer, input);
}
