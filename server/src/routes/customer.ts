import { myDashboard } from '../mydash.ts';
import { Router, ok, created } from '../http.ts';
import { U, page } from './helpers.ts';
import { Validator } from '../input.ts';
import { HttpError } from '../errors.ts';
import { audit } from '../audit.ts';
import { deleteMyAccount } from '../accountDeletion.ts';
import { checkPasswordStrength, setPassword, signToken, toUser, userByEmail, userRow, verifyPassword } from '../auth.ts';
import { run, one } from '../db.ts';
import { now } from '../clock.ts';
import { accessBooking, bookingPayments, listBookings, viewBooking } from '../bookings.ts';
import { holdSlots, parseHold, planFor } from '../hold.ts';
import { cancelSeries, seriesOf } from '../recurring.ts';
import { cancelMandate, confirmMandate, mandateView, startMandate, LIMITS } from '../autodebit.ts';
import { evaluatePromo } from '../promo.ts';
import { getGroundOr404 } from '../grounds.ts';
import { cancelBooking, cancelPreviewFor } from '../cancellation.ts';
import { submitUpiReference, verifyRazorpayCheckout } from '../payments.ts';
import * as credits from '../credits.ts';
import { getEnquiry, listEnquiries, respondToQuotation } from '../enquiries.ts';
import { listNotifications } from '../notifications.ts';
import { saveToken, removeToken } from '../push.ts';
import { setAvatar, clearAvatar, readAvatar, MAX_AVATAR_BYTES } from '../avatar.ts';
import type { Reply } from '../http.ts';
import { resolveOwnerCancel } from '../cancellation.ts';
import { beginSetup, checkCode, confirmSetup, disable as disableMfa, mfaEnabled } from '../mfa.ts';
import { scopeOwnerId } from '../auth.ts';

const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,30}$/;

export function customerRoutes(r: Router): void {
  // ---- profile and consent
  r.get('/api/me', (c) => ok({ user: toUser(U(c)) }), { auth: 'user' });

  // ---- phone push notifications (the app registers its Expo push token after sign-in)
  r.post('/api/me/push-token', (c) => {
    const v = new Validator(c.json());
    const token = v.str('token', { required: true, max: 200 });
    const platform = v.oneOf('platform', ['ios', 'android', 'web'] as const);
    v.done();
    saveToken(U(c).id, token!, platform ?? null);
    return ok({ saved: true });
  }, { auth: 'user' });
  r.post('/api/me/push-token/remove', (c) => {
    const v = new Validator(c.json());
    const token = v.str('token', { required: true, max: 200 });
    v.done();
    removeToken(U(c).id, token!);
    return ok({ removed: true });
  }, { auth: 'user' });

  // ---- optional two-step sign-in (owners, staff, super admin) ----
  r.get('/api/me/mfa', (c) => ok({ enabled: mfaEnabled(U(c).id) }), { auth: ['owner', 'staff', 'super_admin'] });
  r.post('/api/me/mfa/setup', (c) => {
    const u = U(c);
    if (mfaEnabled(u.id)) throw new HttpError(409, 'MFA_ALREADY_ON', 'Two-step sign-in is already on');
    return ok(beginSetup(u.id, u.email ?? u.name, 'Daji Cricket Ground'));
  }, { auth: ['owner', 'staff', 'super_admin'] });
  r.post('/api/me/mfa/enable', (c) => {
    const u = U(c);
    const v = new Validator(c.json()); const code = v.str('code', { required: true, max: 12 }); v.done();
    if (!confirmSetup(u.id, code!)) throw new HttpError(400, 'MFA_INVALID', 'That code is not right. Check the app and try the newest code.');
    audit({ id: u.id, role: u.role }, 'mfa.enable', 'user', u.id, {}, scopeOwnerId(u));
    return ok({ enabled: true });
  }, { auth: ['owner', 'staff', 'super_admin'] });
  r.post('/api/me/mfa/disable', (c) => {
    const u = U(c);
    const v = new Validator(c.json()); const password = v.str('password', { required: true, trim: false }); const code = v.str('code', { required: true, max: 12 }); v.done();
    if (!verifyPassword(password!, u.password_hash)) throw new HttpError(403, 'INVALID_PASSWORD', 'Password is not right');
    if (!checkCode(u.id, code!, { requireEnabled: true })) throw new HttpError(400, 'MFA_INVALID', 'That code is not right.');
    disableMfa(u.id);
    audit({ id: u.id, role: u.role }, 'mfa.disable', 'user', u.id, {}, scopeOwnerId(u));
    return ok({ enabled: false });
  }, { auth: ['owner', 'staff', 'super_admin'] });

  r.patch('/api/me', (c) => {
    const u = U(c);
    const body = c.json() as any;
    const v = new Validator(body);
    const name = v.str('name', { min: 2, max: 80 });
    const phone = v.phone('phone');
    const email = v.email('email');
    const businessName = u.role === 'owner' ? v.str('businessName', { max: 80 }) : undefined;
    const upiId = u.role === 'owner' ? v.str('upiId', { max: 80 }) : undefined;
    if (upiId !== undefined && upiId !== '' && !UPI_RE.test(upiId)) v.fail('upiId', 'Must look like name@bank');
    const cons = body.consent;
    let ce: boolean | undefined, cs: boolean | undefined, cw: boolean | undefined;
    if (cons !== undefined) {
      const cv = new Validator(cons && typeof cons === 'object' ? cons : {});
      ce = cv.bool('email'); cs = cv.bool('sms'); cw = cv.bool('whatsapp');
      for (const f of cv.fields) v.fail(`consent.${f.field}`, f.message);
    }
    v.done();
    if (name !== undefined) run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', name, now(), u.id);
    if (email !== undefined) {
      const other = userByEmail(email);
      if (other && other.id !== u.id) throw new HttpError(409, 'EMAIL_TAKEN', 'That email is already used by another account');
      run('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', email, now(), u.id);
    }
    if (phone !== undefined) run('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?', phone, now(), u.id);
    if (businessName !== undefined) run('UPDATE users SET business_name = ?, updated_at = ? WHERE id = ?', businessName, now(), u.id);
    if (upiId !== undefined) { run('UPDATE users SET upi_id = ?, updated_at = ? WHERE id = ?', upiId || null, now(), u.id); audit({ id: u.id, role: u.role }, 'owner.upi_update', 'user', u.id, { upiId: upiId || null }, u.id); }
    if (ce !== undefined || cs !== undefined || cw !== undefined) {
      run('UPDATE users SET consent_email = ?, consent_sms = ?, consent_whatsapp = ?, consent_updated_at = ? WHERE id = ?',
        ce === undefined ? u.consent_email : ce ? 1 : 0, cs === undefined ? u.consent_sms : cs ? 1 : 0, cw === undefined ? u.consent_whatsapp : cw ? 1 : 0, now(), u.id);
      audit({ id: u.id, role: u.role }, 'consent.update', 'user', u.id, { email: ce, sms: cs, whatsapp: cw });
    }
    return ok({ user: toUser(userRow(u.id)!) });
  }, { auth: 'user' });

  // ---- profile picture
  r.post('/api/me/avatar', (c) => { const url = setAvatar(c.cfg.dataDir, U(c), c.raw); return ok({ avatarUrl: url, user: toUser(userRow(U(c).id)!) }); }, { auth: 'user', maxBody: MAX_AVATAR_BYTES + 1024 });
  r.del('/api/me/avatar', (c) => { clearAvatar(c.cfg.dataDir, U(c)); return ok({ avatarUrl: null }); }, { auth: 'user' });
  r.get('/api/avatar/:id', (c): Reply => {
    const f = readAvatar(c.cfg.dataDir, c.params.id!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' } };
  }, { rate: 'none' });

  r.post('/api/me/password', (c) => {
    const u = U(c);
    const v = new Validator(c.json());
    const current = v.str('currentPassword', { required: true, trim: false });
    const next = v.str('newPassword', { required: true, trim: false });
    if (next) { const p = checkPasswordStrength(next); if (p) v.fail('newPassword', p); }
    v.done();
    if (!verifyPassword(current!, u.password_hash)) throw new HttpError(400, 'VALIDATION_FAILED', 'The current password is not right', { fields: [{ field: 'currentPassword', message: 'Not the password you signed in with' }] });
    setPassword(u.id, next!);
    audit({ id: u.id, role: u.role }, 'auth.password_change', 'user', u.id);
    const fresh = userRow(u.id)!;
    return ok({ token: signToken(c.cfg, fresh), user: toUser(fresh) });
  }, { auth: 'user', rate: 'auth' });

  // Delete my account (customers). Asked for by Apple and Google for any app that lets people sign up.
  r.post('/api/me/delete', (c) => ok(deleteMyAccount(c.cfg.dataDir, U(c), c.json())), { auth: 'user', rate: 'auth' });

  // ---- bookings
  // Shows what a promo code takes off before the customer holds the slot.
  r.post('/api/promo/check', (c) => {
    const body = c.json() as Record<string, unknown>;
    const req = parseHold({ ...body, promoCode: undefined });
    const code = String((body as any).promoCode ?? '');
    if (!code.trim()) throw new HttpError(400, 'PROMO_INVALID', 'Enter a promo code.');
    const plan = planFor(getGroundOr404(req.groundId), req, true);
    const { promo, discountPaise } = evaluatePromo(code, getGroundOr404(req.groundId), U(c).id, plan.totalPaise);
    return ok({ code: promo.code, label: promo.label, discountPaise, totalPaise: plan.totalPaise - discountPaise, fullPricePaise: plan.totalPaise });
  }, { auth: ['customer'] });
  r.post('/api/bookings', async (c) => created(await holdSlots(c.cfg, U(c), c.json())), { auth: ['customer'] });

  r.get('/api/bookings', (c) => {
    const { limit, offset } = page(c);
    return ok(listBookings({ customerId: U(c).id, status: c.query.get('status') ?? undefined, from: c.query.get('from') ?? undefined, to: c.query.get('to') ?? undefined, limit, offset }));
  }, { auth: ['customer'] });

  r.get('/api/bookings/:id', (c) => {
    const b = accessBooking(U(c), c.params.id!);
    return ok({ booking: viewBooking(b.id), payments: bookingPayments(b.id) });
  }, { auth: 'user' });

  r.post('/api/bookings/:id/upi-reference', (c) => {
    const v = new Validator(c.json());
    const utr = v.str('utr', { required: true, max: 30 });
    const note = v.str('note', { max: 200 });
    v.done();
    const p = submitUpiReference(U(c), c.params.id!, { utr: utr!, note });
    return ok({ payment: p, booking: viewBooking(p.bookingId) });
  }, { auth: ['customer'] });

  r.get('/api/bookings/:id/cancel-preview', (c) => {
    const prefer = c.query.get('prefer');
    return ok(cancelPreviewFor(U(c), c.params.id!, prefer === 'credit' ? 'credit' : undefined));
  }, { auth: ['customer'] });

  r.post('/api/bookings/:id/cancel', (c) => {
    const v = new Validator(c.json());
    const reason = v.str('reason', { max: 300 });
    const prefer = v.oneOf('prefer', ['refund', 'credit'] as const);
    v.done();
    return ok(cancelBooking(U(c), c.params.id!, { reason, prefer }));
  }, { auth: ['customer'] });

  // Auto-debit: approve once, and the balance of each booking is charged shortly before it starts.
  r.get('/api/autodebit', (c) => ok({ ...mandateView(U(c).id), limits: LIMITS }), { auth: ['customer'] });
  r.post('/api/autodebit/start', async (c) => {
    const v = new Validator(c.json());
    const max = v.int('maxAmountPaise', { min: 1 });
    v.done();
    return ok(await startMandate(c.cfg, U(c), max));
  }, { auth: ['customer'] });
  r.post('/api/autodebit/confirm', async (c) => {
    const v = new Validator(c.json());
    const mandateId = v.str('mandateId', { required: true, max: 60 });
    const paymentId = v.str('paymentId', { max: 80 });
    const signature = v.str('signature', { max: 200 });
    v.done();
    return ok(await confirmMandate(c.cfg, U(c), { mandateId: mandateId!, paymentId, signature }));
  }, { auth: ['customer'] });
  r.del('/api/autodebit', (c) => ok(cancelMandate(U(c))), { auth: ['customer'] });

  r.get('/api/bookings/:id/series', (c) => {
    const b = accessBooking(U(c), c.params.id!);
    return ok({ series: b.series_id ? seriesOf(b.series_id) : null });
  }, { auth: 'user' });
  r.post('/api/bookings/:id/cancel-series', (c) => {
    const v = new Validator(c.json());
    const reason = v.str('reason', { max: 300 });
    v.done();
    return ok(cancelSeries(U(c), c.params.id!, reason));
  }, { auth: 'user' });

  // The ground cancelled the booking and explained why: the customer picks a full refund, the full amount as credit, or another slot (which keeps the money as credit to use on the new booking).
  r.post('/api/bookings/:id/resolve', (c) => {
    const v = new Validator(c.json());
    const choice = v.oneOf('choice', ['refund', 'half', 'credit', 'rebook'] as const, true);
    v.done();
    return ok(resolveOwnerCancel(U(c), c.params.id!, choice!));
  }, { auth: ['customer'] });

  r.post('/api/payments/razorpay/verify', (c) => {
    const v = new Validator(c.json());
    const orderId = v.str('orderId', { required: true, max: 80 });
    const paymentId = v.str('paymentId', { required: true, max: 80 });
    const signature = v.str('signature', { required: true, max: 200 });
    v.done();
    const out = verifyRazorpayCheckout(c.cfg, U(c), { orderId: orderId!, paymentId: paymentId!, signature: signature! });
    const p = one<{ booking_id: string }>('SELECT booking_id FROM payments WHERE rp_order_id = ?', orderId!);
    return ok({ outcome: out.outcome, booking: viewBooking(p!.booking_id) });
  }, { auth: ['customer'] });

  // ---- the customer's own dashboard
  r.get('/api/my/dashboard', (c) => ok(myDashboard(U(c))), { auth: ['customer'] });

  // ---- credit
  r.get('/api/credits', (c) => ok(credits.summary(U(c).id)), { auth: ['customer'] });

  // ---- enquiries (own)
  r.get('/api/my/enquiries', (c) => {
    const { limit, offset } = page(c);
    return ok(listEnquiries(U(c), { status: c.query.get('status') ?? undefined, limit, offset }));
  }, { auth: ['customer'] });
  r.get('/api/my/enquiries/:id', (c) => ok(getEnquiry(U(c), c.params.id!)), { auth: ['customer'] });
  r.post('/api/my/enquiries/:id/quotations/:qid/respond', (c) => {
    const v = new Validator(c.json());
    const accept = v.bool('accept', true);
    v.done();
    return ok(respondToQuotation(U(c), c.params.id!, c.params.qid!, accept!));
  }, { auth: ['customer'] });

  r.get('/api/notifications', (c) => ok({ items: listNotifications(U(c).id) }), { auth: 'user' });
}
