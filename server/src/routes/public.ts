import { MAX_DAYS_AHEAD } from '../hold.ts';
import { BRAND, type PublicConfig } from '@daji/shared';
import { Router, ok, created } from '../http.ts';
import { razorpayConfigured } from '../config.ts';
import { getSettings } from '../settings.ts';
import { availability, getGroundOr404, listGrounds, toGround } from '../grounds.ts';
import { Validator } from '../input.ts';
import { HttpError } from '../errors.ts';
import { checkPasswordStrength, createUser, hashPassword, login, revokeAllTokens, revokeToken, signToken, toUser, userByEmail, userByPhone, userRow, type UserRow } from '../auth.ts';
import { splitName, titleCase } from '../names.ts';
import { checkOtp, requestOtp } from '../otp.ts';
import { requestPasswordReset, resetPassword } from '../passwordReset.ts';
import { otpAvailable } from '../notifications.ts';
import { audit } from '../audit.ts';
import { createEnquiry } from '../enquiries.ts';
import { isValidDate, istDate } from '../time.ts';
import { closedByScope } from '../closures.ts';
import { now } from '../clock.ts';
import { one, run } from '../db.ts';
import { festivalOn, festivalPreview } from '../festivals.ts';
import { siteDesign } from '../packs.ts';
import { callback as microsoftCallback, microsoftConfigured, redeem as microsoftRedeem, startUrl as microsoftStart } from '../microsoft.ts';

export function publicRoutes(r: Router): void {
  // Used by Docker's health check and by deploy/check-live.sh. It reads the database, so "ok" means bookings can be served. `demo` is true while
  // DEMO_MODE is on (demo accounts and the fake payment gateway), which must never be the case on the real site.
  r.get('/api/health', (c) => {
    let database = 'ok';
    try { one('SELECT 1 AS n'); } catch { database = 'error'; }
    const healthy = database === 'ok';
    return ok({ ok: healthy, time: now(), database, demo: c.cfg.demoMode }, healthy ? 200 : 503);
  }, { rate: 'none' });

  // Today's festival look (India time), read by the website on every page load. ?date= shows another day and
  // ?preview=<id>&day=<n> one festival's day, so the owner can see a look before the day comes. ?pack=<id> rotates
  // through another quarter's design pack, so the owner can try a pack before it goes live.
  r.get('/api/festival', (c) => {
    const preview = c.query.get('preview'), date = c.query.get('date');
    if (date && !isValidDate(date)) throw new HttpError(400, 'VALIDATION_FAILED', 'date must look like 2026-11-08', { fields: [{ field: 'date', message: 'A date like 2026-11-08' }] });
    const festival = preview ? festivalPreview(preview, Number(c.query.get('day') ?? 1)) : festivalOn(date || istDate(now()));
    // the site's design for visitors who have not picked one: rotating through the day, or the owner's fixed choice
    const s = getSettings();
    return ok({ festival, forEveryone: s.festivalForEveryone, site: siteDesign(s.siteDesign, now(), c.query.get('pack'), s.designPace), time: now() });
  });

  r.get('/api/config', (c) => {
    const s = getSettings();
    const cfg: PublicConfig = {
      brand: BRAND.name,
      tagline: BRAND.tagline,
      contact: { name: s.contactName, phone: s.contactPhone, email: s.contactEmail },
      academy: { name: s.academyName, runBy: s.academyRunBy, brand: s.academyBrand, about: s.academyAbout, coaches: s.academyCoaches },
      instagramUrl: s.instagramUrl || null,
      gallery: s.galleryImages,
      academyGallery: s.academyImages,
      razorpayEnabled: s.razorpayEnabled,
      codesEnabled: c.cfg.otpSignIn && otpAvailable(c.cfg.demoMode),
      microsoftSignIn: microsoftConfigured(c.cfg),
      razorpayDemo: !razorpayConfigured(c.cfg) && c.cfg.demoMode,
      razorpayKeyId: razorpayConfigured(c.cfg) ? c.cfg.razorpay.keyId : null,
      holdMinutesOnline: s.holdMinutesOnline,
      maxDaysAhead: MAX_DAYS_AHEAD,
      holdMinutesUpi: s.holdMinutesUpi,
      verifyMinutesUpi: s.verifyMinutesUpi,
      creditExpiryDays: s.creditExpiryDays,
      freeCancelHours: s.freeCancelHours,
      lateCancelCreditPercent: s.lateCancelCreditPercent,
      cashRefundPercent: s.cashRefundPercent,
      requireApproval: s.requireApproval,
      autoDebitEnabled: s.autoDebitEnabled,
      autoDebitHoursBefore: s.autoDebitHoursBefore,
      bookingsOpenFrom: s.bookingsOpenFrom,
      bookingsCloseFrom: s.bookingsCloseFrom,
      closedDates: closedByScope(istDate(now())),
      advanceMode: s.advanceMode,
      advanceValue: s.advanceValue,
      fullPaymentWithinHours: s.fullPaymentWithinHours,
      demoMode: c.cfg.demoMode,
      publicUrl: c.cfg.publicUrl,
      mediaBase: c.cfg.mediaCdn || null,
    };
    return ok(cfg);
  });

  r.get('/api/grounds', (c) => ok({ items: listGrounds({ city: c.query.get('city') ?? undefined, q: c.query.get('q') ?? undefined }) }));

  r.get('/api/grounds/:id', (c) => {
    const g = getGroundOr404(c.params.id!);
    if (!g.active) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
    return ok(toGround(g));
  });

  r.get('/api/grounds/:id/availability', (c) => {
    const g = getGroundOr404(c.params.id!);
    if (!g.active) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
    const date = c.query.get('date');
    if (!isValidDate(date)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send a date like 2026-10-21', { fields: [{ field: 'date', message: 'Must be a date like 2026-10-21' }] });
    return ok(availability(g, date));
  });

  r.post('/api/enquiries', (c) => created(createEnquiry(c.user?.role === 'customer' ? c.user : null, c.json())), { rate: 'auth' });

  r.post('/api/auth/register', (c) => {
    const v = new Validator(c.json());
    const firstName = v.str('firstName', { min: 1, max: 40 });
    const lastName = v.str('lastName', { min: 1, max: 40 });
    const name = firstName ? undefined : v.str('name', { required: true, min: 2, max: 80 });
    const email = v.email('email', true);
    // Both are needed, and either one signs in afterwards. The number is not checked with a code while WhatsApp codes are off.
    const phone = v.intlPhone('phone', true);
    const password = v.str('password', { required: true, trim: false });
    const consent = (c.json() as any).consent ?? {};
    const cv = new Validator(typeof consent === 'object' && consent ? consent : {});
    const ce = cv.bool('email'), cs = cv.bool('sms'), cw = cv.bool('whatsapp');
    for (const f of cv.fields) v.fail(`consent.${f.field}`, f.message);
    if (password) { const pw = checkPasswordStrength(password); if (pw) v.fail('password', pw); }
    v.done();
    // Someone already booked at the desk has a record without a login. An email address alone does not prove it is theirs, and taking
    // the record over would hand a stranger that person's bookings and credit. They claim it by signing in with the code sent to their mobile.
    const sameEmail = email ? userByEmail(email) : undefined;
    if (sameEmail) throw new HttpError(409, 'ACCOUNT_EXISTS', sameEmail.role === 'customer' && !sameEmail.password_hash
      ? 'This email is already with us from a booking at the ground. Sign in with the code sent to your mobile number to use that record, or ask the ground to help.'
      : 'There is already an account with this email. Sign in with a code sent to your mobile, or reset your password, instead of making a new one.');
    const row = createUser({ role: 'customer', name: name ?? `${firstName} ${lastName ?? ''}`, ...(firstName ? { firstName, lastName: lastName ?? '' } : {}), email: email!, phone: phone!, password: password! });
    if (ce || cs || cw) {
      run('UPDATE users SET consent_email = ?, consent_sms = ?, consent_whatsapp = ?, consent_updated_at = ? WHERE id = ?', ce ? 1 : 0, cs ? 1 : 0, cw ? 1 : 0, now(), row.id);
      audit({ id: row.id, role: 'customer' }, 'consent.set', 'user', row.id, { email: !!ce, sms: !!cs, whatsapp: !!cw });
    }
    const fresh = userRow(row.id)!;
    return created({ token: signToken(c.cfg, fresh), user: toUser(fresh) });
  }, { rate: 'auth' });

  // Sign out on the server: this token stops working everywhere, immediately. Safe to call with an expired or missing token.
  r.post('/api/auth/logout', (c) => { const done = revokeToken(c.cfg, c.req.headers.authorization); if (done && c.user) audit({ id: c.user.id, role: c.user.role }, 'auth.logout', 'user', c.user.id, {}); return ok({ signedOut: true }); }, { rate: 'auth' });
  r.post('/api/auth/logout-all', (c) => { revokeAllTokens(c.user!.id); audit({ id: c.user!.id, role: c.user!.role }, 'auth.logout_all', 'user', c.user!.id, {}); return ok({ signedOut: true }); }, { auth: 'user' });

  r.post('/api/auth/login', (c) => {
    const v = new Validator(c.json());
    const who = v.str('identifier', { max: 120 }) ?? v.str('email', { max: 120, required: true });
    const password = v.str('password', { required: true, trim: false });
    const code = v.str('code', { max: 12 });
    const countryCode = v.str('countryCode', { max: 4 });
    v.done();
    return ok(login(c.cfg, who!, password!, code, countryCode));
  }, { rate: 'auth' });

  // ---- Sign in with Microsoft, for the phone apps (the steps are in src/microsoft.ts)
  r.get('/api/auth/microsoft/start', (c) => ({ status: 302, headers: { Location: microsoftStart(c.cfg, c.query.get('app'), c.query.get('challenge')), 'Cache-Control': 'no-store' }, raw: '' }), { rate: 'auth' });
  r.get('/api/auth/microsoft/callback', async (c) => {
    const r = await microsoftCallback(c.cfg, c.query);
    if ('location' in r) return { status: 302, headers: { Location: r.location, 'Cache-Control': 'no-store' }, raw: '' };
    return { status: 400, contentType: 'text/html; charset=utf-8', raw: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Daji sign-in</title><p style="font:16px system-ui;margin:40px 20px">${r.page}</p>` };
  }, { rate: 'auth' });
  r.post('/api/auth/microsoft/redeem', (c) => {
    const v = new Validator(c.json());
    const ticket = v.str('ticket', { required: true, max: 100 });
    const verifier = v.str('verifier', { required: true, min: 43, max: 128 });
    const code = v.str('code', { max: 12 });
    v.done();
    return ok(microsoftRedeem(c.cfg, ticket!, verifier!, code));
  }, { rate: 'auth' });

  // ---- forgot password: a code sent to the email, then the code and a new password. The answer never says whether the email has an account.
  r.post('/api/auth/password/forgot', (c) => {
    const v = new Validator(c.json());
    const email = v.email('email', true);
    v.done();
    return ok(requestPasswordReset(c.cfg, email!));
  }, { rate: 'auth' });

  r.post('/api/auth/password/reset', (c) => {
    const v = new Validator(c.json());
    const email = v.email('email', true);
    const code = v.str('code', { required: true, min: 4, max: 8 });
    const password = v.str('password', { required: true, trim: false });
    v.done();
    resetPassword(c.cfg, email!, code!, password!);
    return ok({ reset: true });
  }, { rate: 'auth' });

  // ---- phone number and one-time code: create an account, or sign in
  const otpOn = (c: { cfg: { otpSignIn: boolean } }) => { if (!c.cfg.otpSignIn) throw new HttpError(404, 'OTP_OFF', 'Sign in with a code is switched off for now. Use your email or phone number and password.'); };
  r.post('/api/auth/otp/request', async (c) => {
    otpOn(c);
    const v = new Validator(c.json());
    const phone = v.phone('phone', true);
    v.done();
    return ok(await requestOtp(c.cfg, phone!));
  }, { rate: 'auth' });

  r.post('/api/auth/otp/verify', (c) => {
    otpOn(c);
    const body = c.json() as any;
    const v = new Validator(body);
    const phone = v.phone('phone', true);
    const code = v.str('code', { required: true, min: 4, max: 8 });
    const firstName = v.str('firstName', { min: 1, max: 40 });
    const lastName = v.str('lastName', { min: 1, max: 40 });
    const consent = body?.consent ?? {};
    const cv = new Validator(typeof consent === 'object' && consent ? consent : {});
    const ce = cv.bool('email'), cs = cv.bool('sms'), cw = cv.bool('whatsapp');
    v.done();
    const check = checkOtp(c.cfg, phone!, code!);
    const existing = userByPhone(phone!);
    if (existing) {
      if (!existing.active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');
      check.consume();
      return ok({ token: signToken(c.cfg, existing), user: toUser(existing), created: false });
    }
    if (!firstName || !lastName) throw new HttpError(400, 'NAME_REQUIRED', 'There is no account for this number yet. Add your first and last name to create one.', { fields: [{ field: 'firstName', message: 'Required' }, { field: 'lastName', message: 'Required' }] });
    check.consume();
    const row = createUser({ role: 'customer', name: `${firstName} ${lastName}`, firstName, lastName, phone: phone! });
    if (ce || cs || cw) {
      run('UPDATE users SET consent_email = ?, consent_sms = ?, consent_whatsapp = ?, consent_updated_at = ? WHERE id = ?', ce ? 1 : 0, cs ? 1 : 0, cw ? 1 : 0, now(), row.id);
      audit({ id: row.id, role: 'customer' }, 'consent.set', 'user', row.id, { email: !!ce, sms: !!cs, whatsapp: !!cw });
    }
    const fresh = userRow(row.id)!;
    return created({ token: signToken(c.cfg, fresh), user: toUser(fresh), created: true });
  }, { rate: 'auth' });
}
