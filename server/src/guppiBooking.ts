import type { Config } from './config.ts';
import { aiConfigured } from './config.ts';
import { now } from './clock.ts';
import { many, one } from './db.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import { Validator } from './input.ts';
import { redact } from './ask/claude.ts';
import { addDays, dayOfWeek, isValidDate, istDate, MIN } from './time.ts';
import type { UserRow } from './auth.ts';
import { accessBooking, blockOf, loadBooking } from './bookings.ts';
import { getGroundOr404, listGrounds } from './grounds.ts';
import { groundFormats } from './formats.ts';
import { groundRates } from './rates.ts';
import { resolveOption, searchOptions, type BookingOption } from './options.ts';
import { guppiOn, strict } from './guppi.ts';
import { groundKind, matchGrounds, parseBooking, settleClock, wantsKind, type Choice, type Lang, type RawClock } from './guppiLang.ts';
import { dateText, durText, inr, LABELS, say, time12, whenText, type Key, type Labels } from './guppiText.ts';

// Guppi booking conversation. The customer writes in English, Gujarati, Hindi, romanized Gujarati or Hindi, or a mix; Guppi reads it (guppiLang.ts) into one of a few plain
// commands and runs it through the booking system's own commands: the option search (searchOptions, the same call the normal screens use), the issued option ids, and the hold
// (/api/guppi/hold). Nothing here knows a price, an availability or a payment: every figure in a reply is copied from what the booking system returned. This module cannot
// create a booking, mark anything paid, waive anything or change an amount. The most it does is name the option to hold (CREATE_HOLD); the hold itself is a separate call
// made by the app with the customer's own sign-in and an action id.

export type Command = 'BOOK_GROUND' | 'SEARCH_AVAILABILITY' | 'SELECT_OPTION' | 'CREATE_HOLD' | 'SHOW_PRICE' | 'SHOW_DEPOSIT' | 'CHECK_PAYMENT_STATUS' | 'SHOW_BALANCE';
export type Status = 'clarify' | 'options' | 'selected' | 'ready_to_hold' | 'rejected' | 'info' | 'refused' | 'normal_flow';

export interface Draft {
  groundId?: string; anyGround?: boolean; date?: string; startTime?: string; durationMinutes?: number; minDurationMinutes?: number;
  pendingStart?: string; pendingEnd?: string; mode?: 'book' | 'search'; lang?: Lang; selectedOptionId?: string; holdBookingId?: string;
}
export interface Criteria {
  groundId: string | null; groundName: string | null; anyGround: boolean; date: string | null; weekday: string | null; startTime: string | null; endTime: string | null;
  durationMinutes: number | null; minDurationMinutes: number | null; slots: number | null;
}
export interface Offer extends BookingOption { tag: 'exact' | 'alternative' | 'shorter' | 'other_ground'; weekday: string; text: string }
export interface Need { field: 'date' | 'startTime' | 'durationMinutes' | 'groundId' | 'option'; reason: 'missing' | 'ambiguous' | 'invalid'; choices?: { label: string; patch: Record<string, unknown> }[] }
export interface Understood {
  source: 'booking-system'; command: Command | null; status: Status; language: Lang; inputKind: string; interpretedBy: 'builtin' | 'builtin+model';
  criteria: Criteria; draft: Draft; message: string; labels: Labels; needs?: Need[]; offers?: Offer[]; option?: Offer; next?: { command: 'CREATE_HOLD'; optionId: string; groundId: string };
  figures?: { totalPaise: number; advancePaise: number }[]; bookings?: BookingView[]; previousHold?: { bookingId: string; ref: string; expiresAt: number | null }; refusal?: { code: string };
}
export interface BookingView { id: string; ref: string; status: string; date: string; totalPaise: number; paidPaise: number; balancePaise: number; advancePaise: number }

// ---- a small limit on model-assisted reading so it cannot run up a bill
const modelCalls = new Map<string, number[]>();
export function resetGuppiModelLimits(): void { modelCalls.clear(); }
function modelAllowed(cfg: Config, userId: string): boolean {
  const t = now();
  const recent = (modelCalls.get(userId) ?? []).filter((x) => x > t - 3_600_000);
  if (recent.length >= cfg.ai.limitPerHour) return false;
  recent.push(t); modelCalls.set(userId, recent);
  return true;
}

interface ModelRead { date?: string; startTime?: string; durationMinutes?: number }
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The optional AI reader. It is told to return the date, start and length it can read and nothing else; whatever it returns is validated like any other input, and is
 * used only to fill a gap the built-in reader left. Where the built-in reader found a value, the built-in value stays. A failure or a bad reply means no help, never an error. */
async function modelRead(cfg: Config, userId: string, text: string, today: string, fetchImpl: typeof fetch): Promise<ModelRead | null> {
  if (!aiConfigured(cfg) || cfg.ai.mode === 'builtin' || !modelAllowed(cfg, userId)) return null;
  const system = [
    'You read a cricket ground booking message written in English, Gujarati, Hindi, romanized Gujarati or Hindi, or a mix.',
    `Today is ${today} (Indian time). Reply with one JSON object only: {"date":"YYYY-MM-DD"|null,"startTime":"HH:MM"|null,"durationMinutes":integer|null}.`,
    'Use 24-hour time. Return null for anything that is not clearly stated; never guess a morning or evening, and never guess a date. Do not return prices, availability or anything else.',
  ].join('\n');
  try {
    const res = await fetchImpl(`${cfg.ai.apiUrl}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.ai.model, max_tokens: 200, system, messages: [{ role: 'user', content: redact(text) }] }),
      signal: AbortSignal.timeout(Math.min(cfg.ai.timeoutMs, 6000)),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>;
    const out: ModelRead = {};
    if (typeof j.date === 'string' && isValidDate(j.date) && j.date >= today) out.date = j.date;
    if (typeof j.startTime === 'string' && TIME_RE.test(j.startTime)) out.startTime = j.startTime;
    if (typeof j.durationMinutes === 'number' && Number.isInteger(j.durationMinutes) && j.durationMinutes >= 15 && j.durationMinutes <= 1440) out.durationMinutes = j.durationMinutes;
    return out;
  } catch { return null; }
}

// ---- reading the request body
function draftOf(raw: unknown, field: string, v: Validator): Draft {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) { v.fail(field, 'Must be an object'); return {}; }
  const known = ['groundId', 'anyGround', 'date', 'startTime', 'durationMinutes', 'minDurationMinutes', 'pendingStart', 'pendingEnd', 'mode', 'lang', 'selectedOptionId', 'holdBookingId'];
  for (const k of Object.keys(raw)) if (!known.includes(k)) v.fail(`${field}.${k}`, 'Not allowed here');
  const d = new Validator(raw);
  const out: Draft = {};
  const set = <K extends keyof Draft>(k: K, val: Draft[K] | undefined): void => { if (val !== undefined) out[k] = val; };
  set('groundId', d.str('groundId', { max: 60 })); set('anyGround', d.bool('anyGround')); set('date', d.date('date')); set('startTime', d.time('startTime'));
  set('durationMinutes', d.int('durationMinutes', { min: 15, max: 1440 })); set('minDurationMinutes', d.int('minDurationMinutes', { min: 15, max: 1440 }));
  set('pendingStart', d.time('pendingStart')); set('pendingEnd', d.time('pendingEnd'));
  set('mode', d.oneOf('mode', ['book', 'search'] as const)); set('lang', d.oneOf('lang', ['en', 'gu', 'hi', 'gu-Latn', 'hi-Latn'] as const));
  set('selectedOptionId', d.str('selectedOptionId', { max: 2000 })); set('holdBookingId', d.str('holdBookingId', { max: 60 }));
  for (const f of d.fields) v.fail(`${field}.${f.field}`, f.message);
  return out;
}

const weekdayName = (date: string): string => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek(date)]!;
const slotsFor = (slotMinutes: number, minutes: number): number | null => (minutes % slotMinutes === 0 ? minutes / slotMinutes : null);
const hhmmOf = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type GroundLite = { id: string; name: string; city: string };

function offerText(lang: Lang, o: BookingOption): string {
  const wd = dayOfWeek(o.date);
  return `${o.groundName} · ${whenText(lang, o.date, wd, o.startTime, o.endTime)} · ${inr(o.totalPaise)} · ${LABELS[lang].advance} ${inr(o.advancePaise)}`;
}
const decorate = (lang: Lang, o: BookingOption, tag: Offer['tag']): Offer => ({ ...o, tag, weekday: weekdayName(o.date), text: offerText(lang, o) });

function bookingView(id: string): BookingView | null {
  const b = loadBooking(id);
  if (!b) return null;
  const k = b.seriesId ? blockOf(b.seriesId, false) : null;
  if (!k) return { id: b.id, ref: b.ref, status: b.status, date: b.date, totalPaise: b.totalPaise, paidPaise: b.paidPaise, balancePaise: b.balancePaise, advancePaise: b.advancePaise };
  // a multi-day booking is one booking: its first day's ref, and the money across every day
  const first = one<{ id: string; ref: string; status: string; advance_paise: number }>('SELECT id, ref, status, advance_paise FROM bookings WHERE series_id = ? ORDER BY series_index LIMIT 1', k.seriesId)!;
  const live = one<{ status: string }>("SELECT status FROM bookings WHERE series_id = ? AND status IN ('held','confirmed') ORDER BY series_index LIMIT 1", k.seriesId);
  return { id: first.id, ref: first.ref, status: live?.status ?? first.status, date: k.fromDate, totalPaise: k.totalPaise, paidPaise: k.paidPaise, balancePaise: k.balancePaise, advancePaise: first.advance_paise };
}
/** The bookings a balance or payment question is about, each multi-day booking once, at most five. */
function viewsOf(user: UserRow, ids: string[]): BookingView[] {
  const views: BookingView[] = [];
  for (const id of ids) { accessBooking(user, id); const bv = bookingView(id); if (bv && !views.some((v) => v.id === bv.id)) views.push(bv); }
  return views.slice(0, 5);
}
const statusKey = (s: string): Key => (({ held: 'sHeld', confirmed: 'sConfirmed', cancelled: 'sCancelled', expired: 'sExpired', no_show: 'sNoShow', completed: 'sCompleted' }) as Record<string, Key>)[s] ?? 'sConfirmed';

export interface Deps { fetchImpl?: typeof fetch }

/**
 * One turn of the conversation. Stateless: the app sends back the `draft` it was given, the ids of the offers it is showing (in the order shown), and what the person typed.
 * Everything in `draft` is only a request; it is checked and searched afresh every turn, so it cannot carry a price or an availability.
 */
export async function guppiUnderstand(cfg: Config, user: UserRow, body: unknown, deps: Deps = {}): Promise<Understood> {
  guppiOn();
  strict(body, ['text', 'draft', 'offers', 'patch', 'context']);
  const v = new Validator(body);
  const textRaw = v.str('text', { max: 400 }) ?? '';
  const draft = draftOf((body as Record<string, unknown>).draft, 'draft', v);
  const patch = draftOf((body as Record<string, unknown>).patch, 'patch', v);
  const offerIds = v.strArray('offers', { max: 10, itemMax: 2000 }) ?? [];
  const ctxRaw = (body as Record<string, unknown>).context;
  let ctxGround: string | undefined, ctxBooking: string | undefined;
  if (ctxRaw !== undefined) {
    if (!ctxRaw || typeof ctxRaw !== 'object' || Array.isArray(ctxRaw)) v.fail('context', 'Must be an object');
    else { const cv = new Validator(ctxRaw); ctxGround = cv.str('groundId', { max: 60 }); ctxBooking = cv.str('bookingId', { max: 60 }); for (const f of cv.fields) v.fail(`context.${f.field}`, f.message); }
  }
  // eslint-disable-next-line no-control-regex
  const text = textRaw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text && !Object.keys(patch).length) v.fail('text', 'Required');
  v.done();

  const today = istDate(now());
  let interpretedBy: Understood['interpretedBy'] = 'builtin';
  const parsed = parseBooking(text, today, { startTime: patch.startTime ?? draft.startTime, ...(draft.lang ? { lang: draft.lang as Lang } : {}) });
  const lang: Lang = text ? parsed.language : draft.lang ?? 'en';
  const labels = LABELS[lang];

  // ---- optional AI help for gaps the built-in reader could not fill
  if (text && parsed.date === undefined && parsed.dateIssue === undefined && parsed.anotherWeekday === undefined || text && parsed.startTime === undefined && parsed.timeIssue === undefined || text && parsed.durationMinutes === undefined && parsed.durationIssue === undefined) {
    const pf = parsed.flags;
    const nothingElse = !(pf.reject || pf.waiver || pf.payClaim || pf.payStatus || pf.askPrice || pf.askDeposit || pf.payAct || pf.refund || pf.change) && !parsed.select.index && !parsed.select.relative && !parsed.select.confirm;
    if (nothingElse && (cfg.ai.mode === 'claude' || (cfg.ai.mode === 'auto'))) {
      const m = await modelRead(cfg, user.id, text, today, deps.fetchImpl ?? fetch);
      if (m) {
        if (m.date && parsed.date === undefined && !parsed.dateIssue && parsed.anotherWeekday === undefined) { parsed.date = m.date; interpretedBy = 'builtin+model'; }
        if (m.startTime && parsed.startTime === undefined && !parsed.timeIssue) { parsed.startTime = m.startTime; interpretedBy = 'builtin+model'; }
        if (m.durationMinutes && parsed.durationMinutes === undefined && !parsed.durationIssue) { parsed.durationMinutes = m.durationMinutes; interpretedBy = 'builtin+model'; }
      }
    }
  }

  const finish = (u: Omit<Understood, 'source' | 'language' | 'inputKind' | 'interpretedBy' | 'labels' | 'draft'> & { draft?: Draft }): Understood => {
    const dr: Draft = { ...(u.draft ?? draft), lang };
    const out: Understood = { source: 'booking-system', language: lang, inputKind: parsed.inputKind, interpretedBy, labels, ...u, draft: dr };
    audit({ id: user.id, role: user.role }, 'guppi.understand', 'ground', out.criteria.groundId, { command: out.command, status: out.status, language: lang, interpretedBy });
    return out;
  };
  const emptyCriteria = (): Criteria => ({ groundId: draft.groundId ?? null, groundName: null, anyGround: !!draft.anyGround, date: draft.date ?? null, weekday: draft.date ? weekdayName(draft.date) : null, startTime: draft.startTime ?? null, endTime: null, durationMinutes: draft.durationMinutes ?? null, minDurationMinutes: draft.minDurationMinutes ?? null, slots: null });

  const grounds: GroundLite[] = listGrounds().map((g) => ({ id: g.id, name: g.name, city: g.city }));

  // ---- things that are never a booking: waivers, payment statements, balance, price
  const f = parsed.flags;
  const hasBookingFields = parsed.date !== undefined || parsed.dateIssue !== undefined || parsed.startTime !== undefined || parsed.timeIssue !== undefined || parsed.durationMinutes !== undefined || parsed.anotherWeekday !== undefined;
  if (text && f.waiver) {
    audit({ id: user.id, role: user.role }, 'guppi.refused', 'guppi', null, { code: 'WAIVER_NOT_ALLOWED', language: lang });
    return finish({ command: null, status: 'refused', criteria: emptyCriteria(), message: say(lang, 'waiver'), refusal: { code: 'WAIVER_NOT_ALLOWED' } });
  }
  if (text && (f.payAct || f.refund || f.change)) {
    // Asked to move money, confirm or record a payment, approve a refund, or cancel or change a booking: the same refusal in every language. Nothing is called that could change a row.
    const code = f.refund ? 'REFUND_NOT_ALLOWED' : f.change ? 'BOOKING_CHANGE_NOT_ALLOWED' : 'PAYMENT_ACTION_NOT_ALLOWED';
    audit({ id: user.id, role: user.role }, 'guppi.refused', 'guppi', null, { code, language: lang });
    let message = say(lang, f.refund ? 'refund' : f.change ? 'changeAsk' : 'payAct');
    let views: BookingView[] | undefined;
    if (f.payAct) {
      // what is owed is read from the booking system, never worked out here
      const ids = ctxBooking ? [ctxBooking] : draft.holdBookingId ? [draft.holdBookingId] : many<{ id: string }>("SELECT id FROM bookings WHERE customer_id = ? AND status IN ('held','confirmed') ORDER BY start_at DESC LIMIT 50", user.id).map((r) => r.id);
      views = viewsOf(user, ids);
      const one = views[0];
      if (views.length === 1 && one) message += ' ' + say(lang, 'balance', { ref: one.ref, status: say(lang, statusKey(one.status)), balance: inr(one.balancePaise), total: inr(one.totalPaise), paid: inr(one.paidPaise) });
      else if (views.length > 1) { const total = views.reduce((n, b) => n + b.balancePaise, 0); message += ' ' + (total > 0 ? say(lang, 'balanceMany', { n: views.length, balance: inr(total) }) : say(lang, 'balanceNone')); }
    }
    return finish({ command: null, status: 'refused', criteria: emptyCriteria(), message, refusal: { code }, ...(views ? { bookings: views } : {}) });
  }
  if (text && (f.payClaim || f.payStatus)) {
    const ids = ctxBooking ? [ctxBooking] : draft.holdBookingId ? [draft.holdBookingId] : many<{ id: string }>("SELECT id FROM bookings WHERE customer_id = ? AND status IN ('held','confirmed') ORDER BY start_at DESC LIMIT 50", user.id).map((r) => r.id);
    const views = viewsOf(user, ids);
    const wantsStatus = f.payClaim || /status|સ્ટેટસ|स्टेटस/.test(text.toLowerCase());
    const command: Command = wantsStatus ? 'CHECK_PAYMENT_STATUS' : 'SHOW_BALANCE';
    let message: string;
    const one = views[0];
    if (!views.length) message = say(lang, wantsStatus ? 'claimNone' : 'balanceNone');
    else if (wantsStatus && one) message = say(lang, 'claim', { ref: one.ref, status: say(lang, statusKey(one.status)), paid: inr(one.paidPaise), total: inr(one.totalPaise), balance: inr(one.balancePaise) });
    else if (views.length === 1 && one) message = say(lang, 'balance', { ref: one.ref, status: say(lang, statusKey(one.status)), balance: inr(one.balancePaise), total: inr(one.totalPaise), paid: inr(one.paidPaise) });
    else { const total = views.reduce((n, b) => n + b.balancePaise, 0); message = total > 0 ? say(lang, 'balanceMany', { n: views.length, balance: inr(total) }) : say(lang, 'balanceNone'); }
    return finish({ command, status: 'info', criteria: emptyCriteria(), message, bookings: views });
  }

  // ---- the offers on screen
  interface Shown { optionId: string; request: ReturnType<typeof resolveOption>['request']; totalPaise: number }
  const shown: Shown[] = [];
  let expiredShown = false;
  for (const id of offerIds) {
    try { const r = resolveOption(cfg, user.id, id); shown.push({ optionId: id, request: r.request, totalPaise: r.totalPaise }); } catch (e) { if (e instanceof HttpError && (e.code === 'OPTION_EXPIRED' || e.code === 'OPTION_INVALID')) expiredShown = true; else throw e; }
  }

  const previous = ((): Understood['previousHold'] | undefined => {
    if (!draft.holdBookingId) return undefined;
    try { accessBooking(user, draft.holdBookingId); } catch { return undefined; }
    const b = loadBooking(draft.holdBookingId);
    return b && b.status === 'held' ? { bookingId: b.id, ref: b.ref, expiresAt: b.holdExpiresAt } : undefined;
  })();
  const withPrevious = (u: Understood): Understood => {
    if (!previous) return u;
    const until = previous.expiresAt ? time12(lang, `${String(new Date(previous.expiresAt + 330 * MIN).getUTCHours()).padStart(2, '0')}:${String(new Date(previous.expiresAt + 330 * MIN).getUTCMinutes()).padStart(2, '0')}`) : '';
    return { ...u, previousHold: previous, message: `${u.message} ${say(lang, 'prevHold', { ref: previous.ref, until })}` };
  };

  const refreshOffer = (r: Shown['request']): { exact: Offer | null; res: ReturnType<typeof searchOptions> } => {
    const res = searchOptions(cfg, user, r, 5);
    return { exact: res.exact ? decorate(lang, res.exact, 'exact') : null, res };
  };
  /** The options the customer is looking at, asked for again so each carries today's price and a fresh id (an option that is no longer free drops out). */
  const echo = (): Offer[] => shown.map((x) => refreshOffer(x.request).exact).filter((o): o is Offer => !!o);
  const criteriaOf = (r: Shown['request'], g: { name: string }, slotMinutes: number, endTime?: string): Criteria => ({
    groundId: r.groundId, groundName: g.name, anyGround: !!draft.anyGround, date: r.date, weekday: weekdayName(r.date), startTime: r.startTime, endTime: endTime ?? null,
    durationMinutes: (r.slots ?? 1) * slotMinutes, minDurationMinutes: draft.minDurationMinutes ?? null, slots: r.slots ?? null,
  });

  // ---- a message that is about the options on screen: pick one, reject, confirm, ask the price
  const sel = parsed.select;
  const onlySelecting = text !== '' && !hasBookingFields && !parsed.anyGround && !f.sameDay;
  const candidateShown = shown.length ? shown : [];
  const chosen = ((): Shown | 'none' | null => {
    if (!onlySelecting || !candidateShown.length) return null;
    if (sel.index !== undefined) { const i = sel.index === -1 ? candidateShown.length - 1 : sel.index - 1; return candidateShown[i] ?? 'none'; }
    if (sel.relative === 'cheapest') return [...candidateShown].sort((a, b) => a.totalPaise - b.totalPaise)[0] ?? 'none';
    if (sel.relative === 'later' || sel.relative === 'earlier') {
      const key = (s: Shown): string => `${s.request.date} ${s.request.startTime}`;
      const ref = draft.date && draft.startTime ? `${draft.date} ${draft.startTime}` : key(candidateShown[0]!);
      const pool = candidateShown.filter((s) => (sel.relative === 'later' ? key(s) > ref : key(s) < ref)).sort((a, b) => (key(a) < key(b) ? -1 : 1));
      return (sel.relative === 'later' ? pool[0] : pool[pool.length - 1]) ?? 'none';
    }
    return null;
  })();

  if (text && f.reject && !hasBookingFields) {
    const dr: Draft = { ...draft }; delete dr.selectedOptionId;
    return finish({ command: null, status: 'rejected', criteria: emptyCriteria(), message: say(lang, 'rejected'), draft: dr, offers: echo() });
  }

  const confirmWanted = onlySelecting && (sel.confirm || (f.bookWord && !sel.relative && sel.index === undefined && !f.asksAvailability && (shown.length > 0 || !!draft.selectedOptionId))) && chosen === null;
  if (confirmWanted) {
    let target: Shown | null = null;
    if (draft.selectedOptionId) { try { const r = resolveOption(cfg, user.id, draft.selectedOptionId); target = { optionId: draft.selectedOptionId, request: r.request, totalPaise: r.totalPaise }; } catch { target = null; } }
    if (!target && shown.length === 1) target = shown[0]!;
    if (target) {
      const { exact, res } = refreshOffer(target.request);
      const g = getGroundOr404(target.request.groundId);
      if (exact?.optionId) {
        const cr = criteriaOf(target.request, g, g.slot_minutes, exact.endTime);
        return withPrevious(finish({
          command: 'CREATE_HOLD', status: 'ready_to_hold', criteria: cr, option: exact, offers: [exact], figures: [{ totalPaise: exact.totalPaise, advancePaise: exact.advancePaise }],
          next: { command: 'CREATE_HOLD', optionId: exact.optionId, groundId: g.id }, message: say(lang, 'hold', { when: whenText(lang, exact.date, dayOfWeek(exact.date), exact.startTime, exact.endTime) }),
          draft: { ...draft, selectedOptionId: exact.optionId },
        }));
      }
      const alts = res.alternatives.map((o) => decorate(lang, o, 'alternative'));
      return finish({ command: 'SELECT_OPTION', status: 'options', criteria: criteriaOf(target.request, g, g.slot_minutes), offers: alts, message: alts.length ? say(lang, 'foundMany', { ground: g.name }) : say(lang, 'none'), draft: { ...draft, selectedOptionId: undefined } });
    }
    return finish({ command: 'SELECT_OPTION', status: 'clarify', criteria: emptyCriteria(), needs: [{ field: 'option', reason: 'missing' }], message: shown.length || offerIds.length ? say(lang, 'pickOption') : say(lang, 'unknown'), offers: echo() });
  }

  if (chosen !== null) {
    if (chosen === 'none') return finish({ command: 'SELECT_OPTION', status: 'clarify', criteria: emptyCriteria(), needs: [{ field: 'option', reason: 'missing' }], message: say(lang, 'pickOption'), offers: echo() });
    const g = getGroundOr404(chosen.request.groundId);
    const { exact, res } = refreshOffer(chosen.request);
    if (exact) {
      const cr = criteriaOf(chosen.request, g, g.slot_minutes, exact.endTime);
      const dr: Draft = { ...draft, groundId: g.id, date: exact.date, startTime: exact.startTime, durationMinutes: exact.slots * g.slot_minutes, selectedOptionId: exact.optionId };
      return withPrevious(finish({
        command: 'SELECT_OPTION', status: 'selected', criteria: cr, option: exact, offers: echo(), figures: [{ totalPaise: exact.totalPaise, advancePaise: exact.advancePaise }], draft: dr,
        message: say(lang, 'selected', { ground: g.name, when: whenText(lang, exact.date, dayOfWeek(exact.date), exact.startTime, exact.endTime), dur: durText(lang, exact.slots * g.slot_minutes), total: inr(exact.totalPaise), advance: inr(exact.advancePaise) }),
      }));
    }
    const alts = res.alternatives.map((o) => decorate(lang, o, 'alternative'));
    return finish({ command: 'SELECT_OPTION', status: 'options', criteria: criteriaOf(chosen.request, g, g.slot_minutes), offers: alts, message: alts.length ? say(lang, 'foundMany', { ground: g.name }) : say(lang, 'none') });
  }

  // ---- price and deposit questions, answered from the option on screen
  if (onlySelecting && (f.askPrice || f.askDeposit)) {
    let list: Shown[] = shown;
    if (draft.selectedOptionId) { try { const r = resolveOption(cfg, user.id, draft.selectedOptionId); list = [{ optionId: draft.selectedOptionId, request: r.request, totalPaise: r.totalPaise }]; } catch { /* use what is shown */ } }
    if (!list.length) return finish({ command: f.askDeposit ? 'SHOW_DEPOSIT' : 'SHOW_PRICE', status: 'clarify', criteria: emptyCriteria(), message: say(lang, 'needOffer') });
    const fresh = list.map((s) => refreshOffer(s.request).exact).filter((o): o is Offer => !!o);
    const first = fresh[0];
    return finish({
      command: f.askDeposit ? 'SHOW_DEPOSIT' : 'SHOW_PRICE', status: 'info', criteria: emptyCriteria(), offers: fresh, figures: fresh.map((o) => ({ totalPaise: o.totalPaise, advancePaise: o.advancePaise })),
      message: !first ? say(lang, 'none') : f.askDeposit ? say(lang, 'deposit', { advance: inr(first.advancePaise), total: inr(first.totalPaise) }) : say(lang, 'price', { total: inr(first.totalPaise), when: whenText(lang, first.date, dayOfWeek(first.date), first.startTime, first.endTime) }),
    });
  }

  // ---- a booking request (or a correction to one): merge what was said into the draft
  void expiredShown;
  let groundId = patch.groundId ?? draft.groundId ?? ctxGround;
  let anyGround = patch.anyGround ?? (parsed.anyGround ? true : draft.anyGround);
  if (text) {
    const named = matchGrounds(parsed.words, grounds);
    if (parsed.anyGround) { /* "any ground will do" beats a ground word in the same sentence */ }
    else if (named.length === 1) { groundId = named[0]!.id; anyGround = false; }
    else if (named.length > 1) { groundId = named.find((g) => g.id === groundId)?.id ?? undefined; if (!groundId) groundId = undefined; }
  }
  if (!groundId && !anyGround && grounds.length === 1) groundId = grounds[0]!.id;

  let date = patch.date ?? parsed.date ?? draft.date;
  let dateIssue = patch.date ? undefined : parsed.dateIssue;
  if (!patch.date && parsed.anotherWeekday !== undefined) {
    if (draft.date) { let d = addDays(draft.date, 1); while (dayOfWeek(d) !== parsed.anotherWeekday) d = addDays(d, 1); date = d; } // the next such day after the one being discussed
    else dateIssue = { reason: 'ambiguous' };
  }
  if (dateIssue) date = patch.date ?? (dateIssue.reason === 'ambiguous' ? parsed.date ?? undefined : draft.date);
  if (dateIssue && !patch.date && parsed.date === undefined) date = undefined;

  let startTime = patch.startTime ?? parsed.startTime ?? draft.startTime;
  let timeIssue = patch.startTime ? undefined : parsed.timeIssue;
  let pendingStart = draft.pendingStart, pendingEnd = draft.pendingEnd;
  let durationMinutes = patch.durationMinutes ?? parsed.durationMinutes ?? draft.durationMinutes;
  let durationIssue = patch.durationMinutes ? undefined : parsed.durationIssue;
  if (patch.startTime || (parsed.startTime && !parsed.timeIssue)) { pendingStart = undefined; pendingEnd = undefined; }
  // a one-word answer ("evening", "સવારે") settles an hour that was left open
  if (!patch.startTime && parsed.startTime === undefined && parsed.period && pendingStart) {
    const mk = (t: string): RawClock => ({ h: Number(t.slice(0, 2)), minute: Number(t.slice(3, 5)), mark: null });
    const r = settleClock(mk(pendingStart), pendingEnd ? mk(pendingEnd) : undefined, parsed.period);
    if (r.startTime) { startTime = r.startTime; timeIssue = undefined; pendingStart = undefined; pendingEnd = undefined; if (r.durationMinutes) durationMinutes = r.durationMinutes; }
  }
  if (timeIssue?.reason === 'ambiguous' && parsed.pending) {
    const p = parsed.pending, hh = (c: RawClock): string => `${String(c.h).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    pendingStart = hh(p.start); pendingEnd = p.end ? hh(p.end) : undefined;
  }
  if (timeIssue && !patch.startTime && parsed.startTime === undefined) startTime = pendingStart && timeIssue.reason === 'ambiguous' ? undefined : draft.startTime;
  if (sel.relative === 'shorter' || sel.relative === 'longer') {
    if (parsed.durationMinutes === undefined && durationMinutes && groundId) {
      const sm = getGroundOr404(groundId).slot_minutes;
      durationMinutes = Math.max(sm, durationMinutes + (sel.relative === 'longer' ? sm : -sm));
    }
  }
  let minDurationMinutes = parsed.minDurationMinutes ?? draft.minDurationMinutes;
  if (minDurationMinutes && durationMinutes && minDurationMinutes >= durationMinutes) minDurationMinutes = undefined;
  const mode: 'book' | 'search' = !text ? draft.mode ?? 'book' : f.asksAvailability ? 'search' : f.bookWord ? 'book' : draft.mode ?? 'book';

  const newDraft: Draft = {
    ...(groundId ? { groundId } : {}), ...(anyGround ? { anyGround } : {}), ...(date ? { date } : {}), ...(startTime ? { startTime } : {}),
    ...(durationMinutes ? { durationMinutes } : {}), ...(minDurationMinutes ? { minDurationMinutes } : {}), ...(pendingStart ? { pendingStart } : {}), ...(pendingEnd ? { pendingEnd } : {}),
    mode, ...(draft.holdBookingId ? { holdBookingId: draft.holdBookingId } : {}),
  };
  const command: Command = mode === 'search' ? 'SEARCH_AVAILABILITY' : 'BOOK_GROUND';

  // ---- which grounds to search
  const visible = grounds;
  let searchGrounds: GroundLite[] = [];
  if (anyGround) {
    const kind = wantsKind(parsed.words) ?? (groundId ? groundKind(visible.find((g) => g.id === groundId)?.name ?? '') : 'ground');
    const pref = groundId ? visible.find((g) => g.id === groundId) : undefined;
    const same = visible.filter((g) => groundKind(g.name) === kind);
    searchGrounds = pref ? [pref, ...same.filter((g) => g.id !== pref.id)] : same;
  } else if (groundId) {
    const g = visible.find((x) => x.id === groundId);
    if (g) searchGrounds = [g]; else groundId = undefined;
  }

  // ---- what is still needed
  const needs: Need[] = [];
  const dateText12 = (d: string): string => dateText(lang, d, dayOfWeek(d));
  if (dateIssue) {
    needs.push({ field: 'date', reason: dateIssue.reason === 'ambiguous' ? 'ambiguous' : 'invalid', choices: (dateIssue.reason === 'ambiguous' ? (dateIssue as { choices?: Choice[] }).choices ?? (dateIssue.candidates ?? []).map((d) => ({ date: d })) : []).map((c) => ({ label: dateText12(c.date!), patch: { date: c.date } })) });
  } else if (!date) needs.push({ field: 'date', reason: 'missing' });
  if (timeIssue && timeIssue.reason === 'ambiguous') {
    const choices = (timeIssue.choices ?? (timeIssue.candidates ?? []).map((t) => ({ startTime: t }))) as Choice[];
    needs.push({ field: 'startTime', reason: 'ambiguous', choices: choices.map((c) => ({ label: `${time12(lang, c.startTime!)}${c.endTime ? ` – ${time12(lang, c.endTime)}` : ''}`, patch: { startTime: c.startTime, ...(c.durationMinutes ? { durationMinutes: c.durationMinutes } : {}) } })) });
  } else if (timeIssue) needs.push({ field: 'startTime', reason: 'invalid' });
  else if (!startTime) needs.push({ field: 'startTime', reason: 'missing' });
  if (durationIssue) needs.push({ field: 'durationMinutes', reason: 'ambiguous', choices: (durationIssue.candidates ?? []).map(Number).filter((n) => n > 0).map((m) => ({ label: durText(lang, m), patch: { durationMinutes: m } })) });
  else if (!durationMinutes) needs.push({ field: 'durationMinutes', reason: 'missing' });
  if (!searchGrounds.length) needs.push({ field: 'groundId', reason: 'missing', choices: visible.map((g) => ({ label: g.name, patch: { groundId: g.id } })) });
  if (!needs.length && durationMinutes) {
    const bad = searchGrounds.find((g) => slotsFor(getGroundOr404(g.id).slot_minutes, durationMinutes!) === null);
    if (bad) {
      const sm = getGroundOr404(bad.id).slot_minutes, lo = Math.max(sm, Math.floor(durationMinutes / sm) * sm), hi = Math.ceil(durationMinutes / sm) * sm;
      needs.push({ field: 'durationMinutes', reason: 'ambiguous', choices: [...new Set([lo, hi])].map((m) => ({ label: durText(lang, m), patch: { durationMinutes: m } })) });
    }
  }

  const partial = (): Criteria => ({
    groundId: searchGrounds.length === 1 ? searchGrounds[0]!.id : groundId ?? null, groundName: searchGrounds.length === 1 ? searchGrounds[0]!.name : null, anyGround: !!anyGround, date: date ?? null, weekday: date ? weekdayName(date) : null,
    startTime: startTime ?? null, endTime: startTime && durationMinutes ? hhmmOf((Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)) + durationMinutes) % 1440) : null,
    durationMinutes: durationMinutes ?? null, minDurationMinutes: minDurationMinutes ?? null, slots: null,
  });

  if (needs.length) {
    const ask = needs.find((n) => n.reason !== 'missing');
    let message: string;
    if (ask?.field === 'date') message = ask.reason === 'ambiguous' && ask.choices?.length === 2 ? say(lang, 'askDate2', { a: ask.choices[0]!.label, b: ask.choices[1]!.label }) : say(lang, 'askDateBad');
    else if (ask?.field === 'startTime') message = ask.choices?.length === 2 ? say(lang, 'askAmPm', { a: ask.choices[0]!.label, b: ask.choices[1]!.label }) : say(lang, 'unknown');
    else if (ask?.field === 'durationMinutes') {
      const sm = searchGrounds[0] ? getGroundOr404(searchGrounds[0].id).slot_minutes : 60;
      message = ask.choices?.length === 2 ? say(lang, 'askDuration2', { n: sm, a: ask.choices[0]!.label, b: ask.choices[1]!.label }) : say(lang, 'need', { list: say(lang, 'fDuration') });
    } else {
      const names: Record<Need['field'], Key> = { date: 'fDate', startTime: 'fTime', durationMinutes: 'fDuration', groundId: 'fGround', option: 'fOption' };
      const list = needs.map((n) => say(lang, names[n.field])).join(', ');
      message = needs.length === 1 && needs[0]!.field === 'groundId' ? say(lang, 'askGround', { list: visible.map((g) => g.name).join(' / ') }) : say(lang, 'need', { list });
    }
    return finish({ command, status: 'clarify', criteria: partial(), needs, message, draft: newDraft });
  }

  // ---- everything needed is known: ask the booking system
  const offers: Offer[] = [];
  let exactFound = false, normal = 0, firstExact: Offer | null = null;
  const reqEnd = hhmmOf((Number(startTime!.slice(0, 2)) * 60 + Number(startTime!.slice(3, 5)) + durationMinutes!) % 1440);
  for (const sg of searchGrounds) {
    const g = getGroundOr404(sg.id);
    if (groundRates(g).length || groundFormats(g).length) { normal++; continue; }
    const want = durationMinutes! / g.slot_minutes;
    const res = searchOptions(cfg, user, { groundId: g.id, date: date!, startTime: startTime!, slots: want }, anyGround ? 3 : 5);
    const tagFor = (def: Offer['tag']): Offer['tag'] => (g.id !== searchGrounds[0]!.id ? 'other_ground' : def);
    if (res.exact) { const o = decorate(lang, res.exact, tagFor('exact')); offers.push(o); exactFound = true; firstExact ??= o; }
    else for (const a of res.alternatives) offers.push(decorate(lang, a, tagFor('alternative')));
    if (!res.exact && minDurationMinutes) {
      const minSlots = minDurationMinutes / g.slot_minutes;
      if (Number.isInteger(minSlots) && minSlots >= 1 && minSlots < want) {
        const r2 = searchOptions(cfg, user, { groundId: g.id, date: date!, startTime: startTime!, slots: minSlots }, 3);
        if (r2.exact) offers.push(decorate(lang, r2.exact, 'shorter'));
        else for (const a of r2.alternatives.filter((x) => x.date === date).slice(0, 2)) offers.push(decorate(lang, a, 'shorter'));
      }
    }
  }
  let shownOffers = offers;
  const laterOnly = f.sameDay && sel.relative === 'later';
  if (laterOnly) shownOffers = offers.filter((o) => o.tag === 'exact' || (o.date === date && o.startTime > startTime!));
  const cr: Criteria = { ...partial(), endTime: reqEnd, slots: searchGrounds.length === 1 ? durationMinutes! / getGroundOr404(searchGrounds[0]!.id).slot_minutes : null };
  if (!shownOffers.length) {
    if (normal === searchGrounds.length) return finish({ command, status: 'normal_flow', criteria: cr, message: say(lang, 'normalFlow'), draft: newDraft });
    return finish({ command, status: 'options', criteria: cr, offers: [], message: say(lang, laterOnly ? 'noneLater' : 'none'), draft: { ...newDraft } });
  }
  const only = shownOffers[0]!;
  const message = shownOffers.length === 1 && exactFound && firstExact
    ? say(lang, 'found', { ground: only.groundName, when: whenText(lang, only.date, dayOfWeek(only.date), only.startTime, only.endTime), total: inr(only.totalPaise), advance: inr(only.advancePaise) })
    : exactFound || anyGround ? say(lang, 'foundOthers') : say(lang, 'foundMany', { ground: searchGrounds[0]!.name });
  const dr: Draft = { ...newDraft };
  if (shownOffers.length === 1 && exactFound) dr.selectedOptionId = only.optionId;
  return withPrevious(finish({ command, status: 'options', criteria: cr, offers: shownOffers, message, draft: dr, figures: shownOffers.map((o) => ({ totalPaise: o.totalPaise, advancePaise: o.advancePaise })) }));
}

