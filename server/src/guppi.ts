import type { HoldResponse } from '@daji/shared';
import type { Config } from './config.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import { Validator } from './input.ts';
import { getSettings, requireFeature } from './settings.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { holdFromOption, parseOptionRequest, resolveOption, searchOptions, type OptionsResult } from './options.ts';
import { rescheduleBooking, type RescheduleResult } from './reschedule.ts';
import { accessBooking } from './bookings.ts';
import { LABELS } from './guppiText.ts';

// Guppi, the assistant, helps a person through the same booking steps they could do themselves. It decides nothing: it asks the booking system for options and passes back the
// option the person picks. Every number it shows (availability, price, deposit) comes from an option this server issued to that person a few minutes ago. It acts with the
// signed-in person's own rights and the record they have selected, repeats safely (every action carries an action id), and stops at the secure payment screen: it never
// sees a card, a UPI reference or a payment result, and it cannot confirm, refund, waive, approve or change an amount. If Guppi is off or fails, the normal screens are unchanged.

export const GUPPI_ACTIONS = ['options', 'hold', 'reschedule'] as const;

interface Selected { groundId?: string; bookingId?: string }

/** Guppi's requests are exact: a field it is not meant to send (an amount, a price, a payment result, an approval) is refused, not ignored. */
export function strict(body: unknown, allowed: readonly string[]): void {
  const extra = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).filter((k) => !allowed.includes(k)) : [];
  if (extra.length) throw new HttpError(400, 'UNKNOWN_FIELDS', `Guppi cannot send: ${extra.join(', ')}`, { fields: extra.map((field) => ({ field, message: 'Not allowed here' })) });
}

export function guppiOn(): void { requireFeature('guppiAssistEnabled', 'The assistant'); }

/** The record the person has selected on their screen. Guppi may only act on this record. */
function parseContext(v: Validator, body: unknown): Selected {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).context : undefined;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { v.fail('context', 'Must be an object'); return {}; }
  const cv = new Validator(raw);
  const groundId = cv.str('groundId', { max: 60 }), bookingId = cv.str('bookingId', { max: 60 });
  for (const f of cv.fields) v.fail(`context.${f.field}`, f.message);
  return { groundId, bookingId };
}

/** The action id is the Idempotency-Key the client sent: the same id is the same action, so a retry cannot repeat it. */
function actionIdOf(headerKey: string | null, bodyId: string | undefined): string {
  if (!bodyId) throw new HttpError(400, 'VALIDATION_FAILED', 'actionId is required', { fields: [{ field: 'actionId', message: 'Required' }] });
  if (headerKey !== bodyId) throw new HttpError(400, 'ACTION_ID_MISMATCH', 'Send the actionId as the Idempotency-Key header too, with the same value.');
  return bodyId;
}

export function guppiContext(user: UserRow) {
  const s = getSettings();
  return {
    enabled: s.guppiAssistEnabled,
    authoritative: false,
    user: { role: user.role, canBook: user.role === 'customer', canSeeRevenue: hasPermission(user, 'view_revenue') },
    actions: user.role === 'customer' ? [...GUPPI_ACTIONS.filter((a) => a !== 'reschedule' || (s.customerRescheduleEnabled && s.rescheduleCutoffHours !== null && s.rescheduleMaxMoves !== null)), 'understand'] : ['options'],
    languages: ['en', 'gu', 'hi', 'gu-Latn', 'hi-Latn'],
    labels: LABELS,
    note: 'Guppi shows only options issued by the booking system and hands over to the secure payment screen. Prices, availability, payments and approvals are decided by the system, not by Guppi.',
  };
}

export function guppiOptions(cfg: Config, user: UserRow, body: unknown): OptionsResult & { source: 'booking-system'; selected: Selected } {
  guppiOn();
  strict(body, ['groundId', 'date', 'startTime', 'slots', 'formatId', 'ruleId', 'max', 'context']);
  const b = (body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const v = new Validator(body);
  const selected = parseContext(v, body);
  v.done();
  delete b.context;
  const q = parseOptionRequest(b);
  if (selected.groundId && selected.groundId !== q.groundId) throw new HttpError(400, 'CONTEXT_MISMATCH', 'Guppi can only look at the ground that is selected on your screen.');
  const res = searchOptions(cfg, user, q, q.max);
  audit({ id: user.id, role: user.role }, 'guppi.options', 'ground', q.groundId, { date: q.date, startTime: q.startTime, offered: (res.exact ? 1 : 0) + res.alternatives.length });
  return { ...res, source: 'booking-system', selected };
}

export interface GuppiHold { hold: HoldResponse['booking']; creditAppliedPaise: number; handoff: { kind: 'secure_payment' | 'none'; bookingId: string; amountPaise: number; expiresAt: number | null; open: string } }

/** Starts the hold for the option the person picked. The reply carries no payment details: the app opens its own payment screen for the booking. */
export async function guppiHold(cfg: Config, user: UserRow, headerKey: string | null, body: unknown): Promise<GuppiHold> {
  guppiOn();
  strict(body, ['optionId', 'actionId', 'useCredit', 'players', 'notes', 'promoCode', 'context']);
  const v = new Validator(body);
  const optionId = v.str('optionId', { required: true, max: 2000 });
  const actionId = v.str('actionId', { required: true, min: 8, max: 128 });
  const useCredit = v.bool('useCredit');
  const players = v.int('players', { min: 1, max: 60 });
  const notes = v.str('notes', { max: 300 });
  const promoCode = v.str('promoCode', { max: 30 });
  const selected = parseContext(v, body);
  v.done();
  const id = actionIdOf(headerKey, actionId);
  if (selected.groundId) {
    if (resolveOption(cfg, user.id, optionId!).request.groundId !== selected.groundId) throw new HttpError(400, 'CONTEXT_MISMATCH', 'That option is for a different ground than the one selected on your screen.');
  }
  const r = await holdFromOption(cfg, user, { optionId, ...(useCredit !== undefined ? { useCredit } : {}), ...(players !== undefined ? { players } : {}), ...(notes ? { notes } : {}), ...(promoCode ? { promoCode } : {}) }, { channel: 'guppi', actionId: id });
  const due = r.payment.amountPaise;
  return {
    hold: r.booking, creditAppliedPaise: r.creditAppliedPaise,
    handoff: { kind: r.payment.mode === 'none' ? 'none' : 'secure_payment', bookingId: r.booking.id, amountPaise: due, expiresAt: r.booking.holdExpiresAt, open: `/bookings/${r.booking.id}/pay` },
  };
}

/** Moves the selected booking to an issued option. */
export function guppiReschedule(cfg: Config, user: UserRow, headerKey: string | null, body: unknown): RescheduleResult {
  guppiOn();
  strict(body, ['bookingId', 'optionId', 'actionId', 'reason', 'context']);
  const v = new Validator(body);
  const bookingId = v.str('bookingId', { required: true, max: 60 });
  const optionId = v.str('optionId', { required: true, max: 2000 });
  const actionId = v.str('actionId', { required: true, min: 8, max: 128 });
  const reason = v.str('reason', { max: 300 });
  const selected = parseContext(v, body);
  v.done();
  const id = actionIdOf(headerKey, actionId);
  if (selected.bookingId !== bookingId) throw new HttpError(400, 'CONTEXT_MISMATCH', 'Guppi can only change the booking that is selected on your screen.');
  accessBooking(user, bookingId!); // the same 404 as anywhere else when it is not theirs
  return rescheduleBooking(cfg, user, bookingId!, { optionId, ...(reason ? { reason } : {}) }, { channel: 'guppi', actionId: id });
}
