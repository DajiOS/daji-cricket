import type { GlobalSettings } from '@daji/shared';
import { many, one, run } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { normalizePhone } from './input.ts';
import { SITE_DESIGN_CHOICES } from './packs.ts';
import { DESIGN_PACES } from './design.ts';
import { DEFAULT_AI_NAME, checkAiName } from './aiNames.ts';
import { SOFTWARE_OWNER } from '@daji/shared';

export const DEFAULT_SETTINGS: GlobalSettings = {
  razorpayEnabled: true,
  /** Every online booking waits for the owner's approval after the advance is paid; the slot stays held meanwhile. */
  requireApproval: true,
  /** Customers may let the ground charge the balance of a booking from their bank (UPI AutoPay) shortly before it starts. Off until the Razorpay account supports it. */
  autoDebitEnabled: false,
  /** How many hours before the start the balance is charged. */
  autoDebitHoursBefore: 24,
  /** The first day customers can book. Before this the website shows when bookings open and the server refuses holds. */
  bookingsOpenFrom: '2026-11-14',
  /** Bookings are closed from this day on, until the software owner clears it. */
  bookingsCloseFrom: '2027-06-01',
  upiId: '',
  upiPayee: 'Daji Cricket Ground',
  contactName: 'Hemanshu Patel',
  contactPhone: '7567156000',
  contactEmail: 'dajicricket@gmail.com',
  academyName: 'MP13 Academy',
  academyRunBy: 'Munaf Patel',
  academyBrand: 'MP13',
  academyAbout: 'MP13 Academy is associated with Daji Cricket Ground. Munaf Patel runs his academy under MP13.',
  academyCoaches: [],
  instagramUrl: 'https://www.instagram.com/dajicricketground/',
  galleryImages: [],
  academyImages: [],
  holdMinutesOnline: 15,
  holdMinutesUpi: 15,
  verifyMinutesUpi: 120,
  graceMinutes: 10,
  maxHoldExtensions: 2,
  advanceMode: 'percent',
  advanceValue: 50,
  fullPaymentWithinHours: 24,
  freeCancelHours: 24,
  lateCancelCreditPercent: 100,
  /** A free cancellation refunded to the original payment method returns only this share of the cash paid; keeping it as account credit returns all of it. */
  cashRefundPercent: 50,
  creditExpiryDays: 90,
  noShowGraceMinutes: 30,
  /** On a festival day the website wears the festival look for every visitor, even one who picked a theme. Off: a visitor's own pick wins. */
  festivalForEveryone: true,
  /** Off until the owner switches it on: the customer Guppi booking assistant (any language) over the normal booking commands. */
  guppiAssistEnabled: false,
  /** Off in this release: customers changing a booked slot themselves. The API exists but no client has a screen for it. */
  customerRescheduleEnabled: false,
  retentionDisputesEnabled: true,
  /** Owner's decision (27 Oct 2026): customers may move a booking only when MORE than 24 hours remain, at most 2 completed moves. */
  rescheduleCutoffHours: 24,
  rescheduleMaxMoves: 2,
  /** A cheaper new time returns the difference as account credit; 'refund_request' sends it through the refund approval chain instead. Never an automatic refund. */
  rescheduleCheaperTreatment: 'credit',
  /** Off until its screens are run on devices: the separate refundable security deposit (staff record it; the customer sees it). */
  securityDepositEnabled: false,
  /** The website's design for visitors who have not picked one: 'rotate' changes it through the day (design.ts), or one fixed design. */
  siteDesign: 'rotate',
  designPace: 'daypart',
  /** What everyone here sees the assistant called, unless they pick their own name in Profile. Platform AI underneath never changes. */
  aiAssistantName: DEFAULT_AI_NAME,
  /** Siri and phone voice shortcuts for this business. Each person still turns voice on for themselves on their own phone; off here turns it off for everyone. */
  voiceShortcutsEnabled: true,
  /** Customers see free slots without prices and send a pricing enquiry for a slot instead of paying online (priceOnEnquiry.ts). The saved prices are kept. */
  pricesOnEnquiry: false,
  /** The company that owns and runs the software. Daji Cricket Ground and every other business are its customers. Software owner only. */
  softwareOwnerName: SOFTWARE_OWNER.name,
  /** The customer business the main web address and app show. Empty: every business, as before there was more than one. Software owner only. */
  mainSiteBusinessId: '',
};

/** A release switch for a newer way to change a booking. Off refuses that way only, with a clear message; nothing else reads these. */
export function requireFeature(key: 'guppiAssistEnabled' | 'customerRescheduleEnabled' | 'retentionDisputesEnabled' | 'securityDepositEnabled', what: string): void {
  if (!getSettings()[key]) throw new HttpError(503, 'FEATURE_OFF', `${what} is switched off for now. Please use the normal booking screens or call the ground.`);
}

export function getSettings(): GlobalSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of many<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (r.key in DEFAULT_SETTINGS) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
    }
  }
  return out as unknown as GlobalSettings;
}

const INT_RANGES: Record<string, [number, number]> = {
  holdMinutesOnline: [5, 60],
  holdMinutesUpi: [5, 240],
  verifyMinutesUpi: [15, 1440],
  graceMinutes: [0, 120],
  maxHoldExtensions: [0, 10],
  fullPaymentWithinHours: [0, 720],
  freeCancelHours: [0, 720],
  lateCancelCreditPercent: [0, 100],
  cashRefundPercent: [0, 100],
  creditExpiryDays: [1, 3650],
  noShowGraceMinutes: [0, 600],
  autoDebitHoursBefore: [1, 168],
};

/** Validates and stores a partial update. Returns the keys that actually changed (with old/new values). */
export function updateSettings(patch: Record<string, unknown>, actorId: string | null): Record<string, { from: unknown; to: unknown }> {
  const before = getSettings();
  const fields: { field: string; message: string }[] = [];
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) { fields.push({ field: k, message: 'Unknown setting' }); continue; }
    if (k === 'razorpayEnabled' || k === 'requireApproval' || k === 'autoDebitEnabled' || k === 'festivalForEveryone' || k === 'guppiAssistEnabled' || k === 'customerRescheduleEnabled' || k === 'retentionDisputesEnabled' || k === 'securityDepositEnabled' || k === 'voiceShortcutsEnabled' || k === 'pricesOnEnquiry') {
      if (typeof v !== 'boolean') fields.push({ field: k, message: 'Must be true or false' }); else next[k] = v;
    } else if (k === 'rescheduleCutoffHours' || k === 'rescheduleMaxMoves') {
      const [lo, hi] = k === 'rescheduleCutoffHours' ? [0, 720] : [0, 10];
      if (v !== null && (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi)) fields.push({ field: k, message: `A whole number from ${lo} to ${hi}, or null to leave it not configured` }); else next[k] = v;
    } else if (k === 'rescheduleCheaperTreatment') {
      if (v !== 'credit' && v !== 'refund_request') fields.push({ field: k, message: "Must be 'credit' or 'refund_request'" }); else next[k] = v;
    } else if (k === 'siteDesign') {
      if (typeof v !== 'string' || !(SITE_DESIGN_CHOICES as readonly string[]).includes(v)) fields.push({ field: k, message: `One of ${SITE_DESIGN_CHOICES.join(', ')}` }); else next[k] = v;
    } else if (k === 'designPace') {
      if (typeof v !== 'string' || !(DESIGN_PACES as readonly string[]).includes(v)) fields.push({ field: k, message: `One of ${DESIGN_PACES.join(', ')}` }); else next[k] = v;
    } else if (k === 'aiAssistantName') {
      try { next[k] = checkAiName(v, k); } catch (e) { fields.push({ field: k, message: e instanceof HttpError ? e.message : 'Not a usable name' }); }
    } else if (k === 'bookingsOpenFrom' || k === 'bookingsCloseFrom') {
      if (typeof v !== 'string' || (v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v))) fields.push({ field: k, message: 'Must be a date like 2026-11-14, or empty' }); else next[k] = v;
    } else if (k === 'upiId') {
      if (typeof v !== 'string' || (v !== '' && !/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,30}$/.test(v))) fields.push({ field: k, message: 'Must look like name@bank' });
      else next[k] = v;
    } else if (k === 'mainSiteBusinessId') {
      if (typeof v !== 'string' || (v !== '' && !one("SELECT 1 FROM users WHERE id = ? AND role = 'owner'", v))) fields.push({ field: k, message: 'Must be one of the customer businesses, or empty for all' }); else next[k] = v;
    } else if (k === 'softwareOwnerName') {
      if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 60) fields.push({ field: k, message: 'Between 2 and 60 characters' }); else next[k] = v.trim();
    } else if (k === 'upiPayee') {
      if (typeof v !== 'string' || v.trim().length < 1 || v.length > 60) fields.push({ field: k, message: 'Between 1 and 60 characters' }); else next[k] = v.trim();
    } else if (k === 'contactName' || k === 'academyName' || k === 'academyRunBy') {
      if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 80) fields.push({ field: k, message: 'Between 2 and 80 characters' }); else next[k] = v.trim();
    } else if (k === 'academyBrand') {
      if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > 30) fields.push({ field: k, message: 'Between 1 and 30 characters' }); else next[k] = v.trim();
    } else if (k === 'academyAbout') {
      if (typeof v !== 'string' || v.length > 600) fields.push({ field: k, message: 'At most 600 characters' }); else next[k] = v.trim();
    } else if (k === 'instagramUrl') {
      if (typeof v !== 'string' || (v.trim() !== '' && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._\/?=&%-]{0,150}$/.test(v.trim()))) fields.push({ field: k, message: 'Must be an https://www.instagram.com/... link, or empty' });
      else next[k] = v.trim();
    } else if (k === 'academyCoaches') {
      const bad = !Array.isArray(v) || v.length > 12 || v.some((c) => !c || typeof c !== 'object' || typeof c.name !== 'string' || c.name.trim().length < 2 || c.name.length > 80
        || (c.title !== undefined && (typeof c.title !== 'string' || c.title.length > 80)) || (c.bio !== undefined && (typeof c.bio !== 'string' || c.bio.length > 400))
        || (c.photo !== undefined && c.photo !== '' && (typeof c.photo !== 'string' || !(/^https:\/\/[^\s"'<>]+$/.test(c.photo) || /^\/api\/media\/med_[\w-]+$/.test(c.photo)))));
      if (bad) fields.push({ field: k, message: 'Up to 12 coaches, each with a name (2 to 80 characters), an optional title, a short bio (up to 400 characters) and an optional photo' });
      else next[k] = (v as { name: string; title?: string; bio?: string; photo?: string }[]).map((c) => ({ name: c.name.trim(), title: (c.title ?? '').trim(), bio: (c.bio ?? '').trim(), photo: (c.photo ?? '').trim() }));
    } else if (k === 'galleryImages' || k === 'academyImages') {
      // A photo is either an https link or one uploaded to this server (/api/media/<id>).
      if (!Array.isArray(v) || v.length > 24 || v.some((u) => typeof u !== 'string' || u.length > 500 || !(/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/api\/media\/med_[\w-]+$/.test(u)))) fields.push({ field: k, message: 'Up to 24 photos, each an uploaded photo or a link starting with https://' });
      else next[k] = (v as string[]).map((u) => u.trim());
    } else if (k === 'contactPhone') {
      const p = typeof v === 'string' ? normalizePhone(v) : null;
      if (!p) fields.push({ field: k, message: 'Must be a 10-digit Indian mobile number' }); else next[k] = p;
    } else if (k === 'contactEmail') {
      if (typeof v !== 'string' || v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) fields.push({ field: k, message: 'Must be a valid email address' }); else next[k] = v.trim().toLowerCase();
    } else if (k === 'advanceMode') {
      if (v !== 'fixed' && v !== 'percent') fields.push({ field: k, message: "Must be 'fixed' or 'percent'" }); else next[k] = v;
    } else if (k === 'advanceValue') {
      const mode = (patch.advanceMode as string | undefined) ?? before.advanceMode;
      if (!Number.isInteger(v)) fields.push({ field: k, message: 'Must be a whole number' });
      else if (mode === 'percent' && ((v as number) < 1 || (v as number) > 100)) fields.push({ field: k, message: 'A percentage must be from 1 to 100' });
      else if (mode === 'fixed' && (v as number) < 100) fields.push({ field: k, message: 'A fixed advance is in paise and must be at least 100 (₹1)' });
      else next[k] = v;
    } else {
      const [lo, hi] = INT_RANGES[k]!;
      if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) fields.push({ field: k, message: `Must be a whole number from ${lo} to ${hi}` });
      else next[k] = v;
    }
  }
  if (fields.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Some settings are not valid', { fields });
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(next)) {
    const from = (before as unknown as Record<string, unknown>)[k];
    if (from === v || JSON.stringify(from) === JSON.stringify(v)) continue;
    run(
      'INSERT INTO settings(key, value, updated_at, updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
      k, JSON.stringify(v), now(), actorId,
    );
    changed[k] = { from, to: v };
  }
  return changed;
}

export function settingUpdatedAt(key: string): number | null {
  return one<{ updated_at: number }>('SELECT updated_at FROM settings WHERE key=?', key)?.updated_at ?? null;
}
