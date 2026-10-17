import type { Notification } from '@daji/shared';
import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { formatPaise } from '@daji/shared';
import { fmtDateTime } from './time.ts';
import { getSettings } from './settings.ts';
import { directionsUrl, groundRow } from './grounds.ts';

registerSchema('push-1', `CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);`);

export type Channel = 'email' | 'sms' | 'whatsapp' | 'push';
export interface Outgoing { id: string; userId: string; channel: Channel; category: 'transactional' | 'marketing'; template: string; subject: string | null; body: string; to: string | null; bookingId?: string | null }
export type Provider = (m: Outgoing) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };

// Real providers (email/SMS/WhatsApp/push) are registered here by deployment code. Until one is, messages stay 'queued'.
const providers = new Map<Channel, Provider>();
export function registerProvider(channel: Channel, p: Provider | null): void {
  if (p) providers.set(channel, p); else providers.delete(channel);
}

/** Sends a sign-in code to a phone number. Returns true when the provider accepted it. */
export type OtpSender = (phone: string, code: string) => Promise<boolean>;
let whatsappSender: OtpSender | null = null, smsSender: OtpSender | null = null;
/** WhatsApp is tried first (set from index.ts when the WhatsApp keys are present). */
export function setOtpSender(s: OtpSender | null): void { whatsappSender = s; }
/** A text message (MSG91) is the back-up when WhatsApp is not set up or does not deliver. */
export function setOtpSmsSender(s: OtpSender | null): void { smsSender = s; }

/** Tells the ground's contact person something by WhatsApp. `vars` fill the template's text variables in order. */
export type AlertSender = (phone: string, vars: string[]) => Promise<boolean>;
let alertSender: AlertSender | null = null;
export function setAlertSender(s: AlertSender | null): void { alertSender = s; }
/** Sends a staff alert on WhatsApp. Never throws; false when WhatsApp is not set up or the send fails. */
export async function sendAlert(phone: string, vars: string[]): Promise<boolean> {
  if (!alertSender) return false;
  try { return await alertSender(phone, vars); } catch { return false; }
}

/** Delivers a sign-in code: WhatsApp first, then text message. False when neither is set up or both fail. */
/** True when a sign-in code can actually be delivered (WhatsApp or text message set up), or when running the demo. */
export const otpAvailable = (demo: boolean): boolean => !!(whatsappSender || smsSender) || demo;

export async function sendOtpCode(phone: string, code: string): Promise<boolean> {
  for (const s of [whatsappSender, smsSender]) {
    if (!s) continue;
    try { if (await s(phone, code)) return true; } catch { /* try the next one */ }
  }
  if (whatsappSender || smsSender) return false;
  return sendDirect('sms', phone, `Your Daji Cricket Ground code is ${code}. It works for 10 minutes. Do not share it with anyone.`);
}

/** Sends one message straight away (not stored with the user's messages), for example a sign-in code. False when no provider is set up. */
export async function sendDirect(channel: Channel, to: string, body: string): Promise<boolean> {
  const p = providers.get(channel);
  if (!p) return false;
  try { const r = await p({ id: 'direct', userId: '', channel, category: 'transactional', template: 'direct', subject: null, body, to, bookingId: null }); return !!r.ok; } catch { return false; }
}

export interface TemplateData {
  ref?: string; ground?: string; startAt?: number; amountPaise?: number; creditPaise?: number; refundPaise?: number;
  name?: string; reason?: string; expiresAt?: number; extra?: string;
  /** Google Maps link to the ground. */
  directionsUrl?: string | null;
  contactName?: string; contactPhone?: string;
}

/** Where the ground is and who to call. Added to the data of every message about a booking, so the customer is never left guessing. */
export function venueData(groundId: string): Pick<TemplateData, 'directionsUrl' | 'contactName' | 'contactPhone'> {
  const g = groundRow(groundId);
  const s = getSettings();
  return { directionsUrl: g ? directionsUrl(g) : null, contactName: s.contactName, contactPhone: s.contactPhone };
}

/** " Directions: <link>. Questions? Call Hemanshu Patel on 7567156000." (either part is left out when we do not have it) */
function venueTail(d: TemplateData): string {
  const parts: string[] = [];
  if (d.directionsUrl) parts.push(`Directions: ${d.directionsUrl}`);
  if (d.contactPhone) parts.push(`Questions? Call ${d.contactName ? d.contactName + ' on ' : ''}${d.contactPhone}.`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

const T: Record<string, (d: TemplateData) => { subject: string; body: string }> = {
  booking_confirmed: (d) => ({ subject: `Booking confirmed — ${d.ref}`, body: `Your booking ${d.ref} at ${d.ground} on ${fmtDateTime(d.startAt!)} is confirmed. Paid so far: ${formatPaise(d.amountPaise ?? 0)}.${venueTail(d)}` }),
  payment_pending: (d) => ({ subject: `Payment received for checking — ${d.ref}`, body: `We have your UPI reference for booking ${d.ref}. Staff will verify it shortly; your slot stays held until then.` }),
  payment_failed: (d) => ({ subject: `Payment did not go through — ${d.ref}`, body: `The payment for booking ${d.ref} failed${d.reason ? ` (${d.reason})` : ''}. Your slot is held until the deadline; you can try again.` }),
  payment_rejected: (d) => ({ subject: `Payment could not be verified — ${d.ref}`, body: `Staff could not verify the UPI payment for booking ${d.ref}${d.reason ? `: ${d.reason}` : ''}. Please check the reference and submit again before the hold ends.` }),
  hold_expired: (d) => ({ subject: `Slot released — ${d.ref}`, body: `We did not receive payment for booking ${d.ref} in time, so the slot at ${d.ground} on ${fmtDateTime(d.startAt!)} has been released.` }),
  booking_pending: (d) => ({ subject: `Booking received, waiting for approval — ${d.ref}`, body: `We have your deposit of ${formatPaise(d.amountPaise ?? 0)} for booking ${d.ref} at ${d.ground} on ${fmtDateTime(d.startAt!)}. Your slot is held while the ground owner approves it. We will message you as soon as it is approved.${venueTail(d)}` }),
  booking_cancelled_owner: (d) => ({ subject: `Your booking was cancelled by the ground — ${d.ref}`, body: `Booking ${d.ref} at ${d.ground} on ${fmtDateTime(d.startAt!)} has been cancelled by the ground owner. Reason: ${d.reason}. You paid ${formatPaise(d.amountPaise ?? 0)}. Open My bookings and choose from the options the ground has offered (see Terms and conditions).${venueTail(d)}` }),
  booking_resolved: (d) => ({ subject: `Your choice is recorded — ${d.ref}`, body: `For cancelled booking ${d.ref}: ${d.extra}` }),
  booking_cancelled_free: (d) => ({ subject: `Booking cancelled — ${d.ref}`, body: `Booking ${d.ref} is cancelled with no charge.${d.refundPaise ? ` A refund of ${formatPaise(d.refundPaise)} is on its way.` : ''}${d.creditPaise ? ` ${formatPaise(d.creditPaise)} has been returned to your account credit.` : ''}` }),
  booking_cancelled_credit: (d) => ({ subject: `Booking cancelled — ${d.ref}`, body: `Booking ${d.ref} was cancelled inside the final 24 hours, so there is no cash refund. ${formatPaise(d.creditPaise ?? 0)} has been added to your account credit${d.expiresAt ? `, valid until ${fmtDateTime(d.expiresAt)}` : ''}.` }),
  no_show: (d) => ({ subject: `Booking marked as no-show — ${d.ref}`, body: `Booking ${d.ref} was marked as a no-show. Under our policy there is no refund or credit.` }),
  refund_processed: (d) => ({ subject: `Refund paid — ${d.ref}`, body: `Your refund of ${formatPaise(d.refundPaise ?? 0)} for booking ${d.ref} has been paid.` }),
  late_payment_refund: (d) => ({ subject: `Payment refunded — ${d.ref}`, body: `Your payment for booking ${d.ref} arrived after the slot was released and the slot was no longer free. ${formatPaise(d.refundPaise ?? 0)} is being refunded.` }),
  credit_issued: (d) => ({ subject: 'Account credit added', body: `${formatPaise(d.creditPaise ?? 0)} was added to your account credit${d.extra ? ` (${d.extra})` : ''}. Valid until ${fmtDateTime(d.expiresAt!)}.` }),
  credit_expired: (d) => ({ subject: 'Account credit expired', body: `${formatPaise(d.creditPaise ?? 0)} of your account credit has expired.` }),
  booking_reminder: (d) => ({ subject: `Reminder — ${d.ref}`, body: `Reminder: booking ${d.ref} at ${d.ground} starts ${fmtDateTime(d.startAt!)}. Balance to pay at the ground: ${formatPaise(d.amountPaise ?? 0)}.${venueTail(d)}` }),
  autodebit_charged: (d) => ({ subject: `Balance paid automatically — ${d.ref}`, body: `We charged the balance of ${formatPaise(d.amountPaise ?? 0)} for booking ${d.ref} at ${d.ground} on ${fmtDateTime(d.startAt!)} from your approved bank account. Nothing more to pay at the ground.` }),
  autodebit_failed: (d) => ({ subject: `Auto-debit did not go through — ${d.ref}`, body: `We could not charge the balance of ${formatPaise(d.amountPaise ?? 0)} for booking ${d.ref}${d.reason ? ` (${d.reason})` : ''}. Please pay it at the ground, or pay online from My bookings.` }),
  enquiry_new: (d) => ({ subject: `New enquiry from ${d.name ?? 'a visitor'}`, body: `${d.name ?? 'Someone'}${d.contactPhone ? ' (' + d.contactPhone + ')' : ''} sent an enquiry${d.ground ? ' about ' + d.ground : ''}.${d.extra ? ' ' + d.extra : ''}` }),
  enquiry_received: (d) => ({ subject: 'We got your enquiry', body: `Thanks ${d.name ?? ''}, we have your enquiry and will get back to you soon.` }),
  quotation_sent: (d) => ({ subject: 'Your quotation', body: `We have sent you a quotation of ${formatPaise(d.amountPaise ?? 0)}.${d.extra ? ' ' + d.extra : ''}` }),
  enquiry_converted: (d) => ({ subject: `Booking created — ${d.ref}`, body: `Your enquiry is now booking ${d.ref} at ${d.ground} on ${fmtDateTime(d.startAt!)}.` }),
};

interface UserContact { id: string; email: string | null; phone: string | null; consent_email: number; consent_sms: number; consent_whatsapp: number }
const contact = (id: string) => one<UserContact>('SELECT id, email, phone, consent_email, consent_sms, consent_whatsapp FROM users WHERE id = ?', id);

function record(userId: string, channel: Channel, category: 'transactional' | 'marketing', template: string, subject: string, body: string, bookingId: string | null, status: 'queued' | 'skipped', skip: string | null): string {
  const id = newId('ntf');
  run('INSERT INTO notifications(id, user_id, channel, category, template, subject, body, status, skip_reason, booking_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, userId, channel, category, template, subject, body, status, skip, bookingId, now());
  return id;
}

/** Transactional message: sent regardless of marketing consent, by email and SMS where we have the address. */
export function notify(userId: string, template: keyof typeof T | string, data: TemplateData, bookingId: string | null = null): void {
  const u = contact(userId);
  const tpl = T[template];
  if (!u || !tpl) return;
  const { subject, body } = tpl(data);
  const ids: string[] = [];
  if (u.email) ids.push(record(userId, 'email', 'transactional', template, subject, body, bookingId, 'queued', null));
  if (u.phone) ids.push(record(userId, 'sms', 'transactional', template, subject, body, bookingId, 'queued', null));
  scheduleDelivery(ids);
  pushNotify(userId, template, subject, body, bookingId);
}

/** Marketing message: needs that channel's own consent, otherwise it is recorded as skipped. */
export function marketing(userId: string, channel: Exclude<Channel, 'push'>, template: string, subject: string, body: string): { sent: boolean; reason?: string; id?: string } {
  const u = contact(userId);
  if (!u) return { sent: false, reason: 'no such user' };
  const consent = channel === 'email' ? u.consent_email : channel === 'sms' ? u.consent_sms : u.consent_whatsapp;
  const addr = channel === 'email' ? u.email : u.phone;
  if (!consent) { record(userId, channel, 'marketing', template, subject, body, null, 'skipped', `no ${channel} marketing consent`); return { sent: false, reason: `no ${channel} marketing consent` }; }
  if (!addr) { record(userId, channel, 'marketing', template, subject, body, null, 'skipped', `no ${channel} address`); return { sent: false, reason: `no ${channel} address` }; }
  const id = record(userId, channel, 'marketing', template, subject, body, null, 'queued', null);
  scheduleDelivery([id]);
  return { sent: true, id };
}

/** A push notification to the app on someone's phone. Nothing is recorded when they have no device registered. */
export function pushNotify(userId: string, template: string, title: string, body: string, bookingId: string | null = null): void {
  if (!one('SELECT 1 FROM push_tokens WHERE user_id = ? LIMIT 1', userId)) return;
  scheduleDelivery([record(userId, 'push', 'transactional', template, title, body, bookingId, 'queued', null)]);
}

/** Push to the owner and to the staff who may manage bookings (for example: a booking is waiting for approval, a booking was cancelled). */
export function pushStaffOf(ownerId: string, template: string, title: string, body: string, bookingId: string | null = null): void {
  const rows = many<{ id: string; permissions: string }>("SELECT id, permissions FROM users WHERE active = 1 AND (id = ? OR (role = 'staff' AND owner_id = ?))", ownerId, ownerId);
  for (const r of rows) {
    if (r.id !== ownerId && !(JSON.parse(r.permissions || '[]') as string[]).includes('manage_bookings')) continue;
    pushNotify(r.id, template, title, body, bookingId);
  }
}

let pending: Promise<unknown>[] = [];
/** Resolves once every in-flight delivery has finished (used by tests and by graceful shutdown). */
export async function flushNotifications(): Promise<void> {
  while (pending.length) { const p = pending; pending = []; await Promise.allSettled(p); }
}

function scheduleDelivery(ids: string[]): void {
  for (const id of ids) {
    const row = one<any>('SELECT n.*, u.email, u.phone FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ?', id);
    if (!row) continue;
    const p = providers.get(row.channel);
    if (!p) continue; // stays 'queued': recorded, nothing configured to send it
    const to = row.channel === 'email' ? row.email : row.phone;
    // Start inside a promise so a provider that throws synchronously cannot break the booking that triggered the message.
    const job = Promise.resolve().then(() => p({ id, userId: row.user_id, channel: row.channel, category: row.category, template: row.template, subject: row.subject, body: row.body, to, bookingId: row.booking_id }))
      .then((r) => { run('UPDATE notifications SET status = ?, skip_reason = ?, sent_at = ? WHERE id = ?', r.ok ? 'sent' : 'failed', r.ok ? null : (r.error ?? 'provider error'), r.ok ? now() : null, id); })
      .catch((e) => { run('UPDATE notifications SET status = ?, skip_reason = ? WHERE id = ?', 'failed', String(e?.message ?? e).slice(0, 200), id); });
    pending.push(job);
  }
}

export function listNotifications(userId: string, limit = 50): Notification[] {
  return many<any>('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', userId, limit).map(toNotification);
}
export const toNotification = (r: any): Notification => ({
  id: r.id, userId: r.user_id, channel: r.channel, category: r.category, template: r.template, subject: r.subject, body: r.body,
  status: r.status, skipReason: r.skip_reason, bookingId: r.booking_id, createdAt: r.created_at,
});
