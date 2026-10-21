import type { Config } from './config.ts';
import { many } from './db.ts';
import { now } from './clock.ts';
import { getSettings } from './settings.ts';
import { integrationStatuses } from './integrations.ts';
import { lastOffsiteCopy, lastRestorePractice, listBackups } from './backup.ts';
import { groundRates } from './rates.ts';
import { listCameras } from './cameras.ts';
import { istDate } from './time.ts';
import type { UserRow } from './auth.ts';

// The go-live check: everything on the "Before opening day" list that the software can see for itself, in one place. It names what is missing
// and where to fix it, and never shows a secret: for server settings it says only whether each one is set (the same rule as the Connections page).
// Things only a person can confirm (the advocate's review, phones installed) are listed as "you" items so the list is complete.

export type ReadyState = 'done' | 'todo' | 'warn' | 'you';
export interface ReadyItem { id: string; group: string; label: string; state: ReadyState; detail: string; fix: string | null; link: string | null }
export interface Readiness { at: number; openingDay: string; daysToOpening: number | null; done: number; total: number; items: ReadyItem[] }

const DEMO_DOMAIN = /@daji\.test$/i;
const HOUR = 3600_000;

interface GroundLite { id: string; name: string; owner_id: string; open_time: string; close_time: string; rates: string; price_paise: number; images: string }
interface UserLite { role: string; email: string | null; active: number }

/** Desk screens only the software owner (super admin) can open. */
const SOFTWARE_OWNER_SCREENS = ['/settings/backups', '/settings/people', '/settings/services', '/platform'];

export function readiness(cfg: Config, u: UserRow, ownerId: string | null): Readiness {
  const items: ReadyItem[] = [];
  const add = (group: string, id: string, label: string, state: ReadyState, detail: string, fix: string | null = null, link: string | null = null) => items.push({ id, group, label, state, detail, fix, link });
  const s = getSettings();
  const t = now();
  const today = istDate(t);
  const own = u.role === 'super_admin' ? ownerId : u.role === 'owner' ? u.id : null;

  // ---- the server ----
  const S = 'Server';
  add(S, 'demo', 'Demo mode is off', cfg.demoMode ? 'todo' : 'done',
    cfg.demoMode ? 'Demo logins work and online payments are fake.' : 'Demo accounts and the fake payment gateway are off.',
    'Set DEMO_MODE=off in deploy/.env on the server and restart.');
  add(S, 'https', 'The site is on https', !cfg.isLocal && cfg.publicUrl.startsWith('https://') ? 'done' : 'todo',
    cfg.isLocal ? 'This server runs on a local address.' : cfg.publicUrl.startsWith('https://') ? 'PUBLIC_URL is https.' : 'PUBLIC_URL is not https.',
    'Set PUBLIC_URL and API_URL to the https addresses in deploy/.env.');
  add(S, 'fieldkey', 'Sign-in secrets are encrypted', cfg.fieldKey.length >= 24 ? 'done' : 'todo',
    cfg.fieldKey.length >= 24 ? 'FIELD_KEY is set.' : 'FIELD_KEY is not set (at least 24 characters).',
    'Set FIELD_KEY in deploy/.env and keep a copy in your password manager.');

  // ---- accounts ----
  const A = 'Accounts';
  const users = many<UserLite>("SELECT role, email, active FROM users WHERE role IN ('super_admin','owner','staff')");
  const real = (r: string) => users.filter((x) => x.role === r && x.active && !DEMO_DOMAIN.test(x.email ?? ''));
  const demoLeft = users.filter((x) => x.active && DEMO_DOMAIN.test(x.email ?? '')).length;
  add(A, 'admin', 'A real software owner account', real('super_admin').length ? 'done' : 'todo',
    real('super_admin').length ? `${real('super_admin').length} software owner account(s).` : 'Only the demo software owner exists.',
    'On the server run scripts/create-admin.ts (see deploy/DEPLOY.md, step 4).');
  add(A, 'owner', 'The ground owner\'s account', real('owner').length ? 'done' : 'todo',
    real('owner').length ? `${real('owner').length} owner account(s).` : 'No real owner account yet.', 'Add the owner in Settings, People.', '/settings/people');
  add(A, 'staff', 'Staff accounts and their rights', real('staff').length ? 'done' : 'todo',
    real('staff').length ? `${real('staff').length} staff account(s). Check each one's rights in Team.` : 'No staff accounts yet.', 'Add staff and tick their rights in Team.', '/team');
  add(A, 'demoAccounts', 'Demo accounts switched off', demoLeft ? 'todo' : 'done',
    demoLeft ? `${demoLeft} demo account(s) (@daji.test) can still sign in.` : 'No demo account can sign in.', 'Switch them off in Settings, People.', '/settings/people');

  // ---- the ground ----
  const G = 'Ground';
  const grounds = own ? many<GroundLite>('SELECT * FROM grounds WHERE active = 1 AND owner_id = ? ORDER BY name', own) : many<GroundLite>('SELECT * FROM grounds WHERE active = 1 ORDER BY name');
  const names = (gs: GroundLite[]) => gs.map((g) => g.name).join(', ');
  add(G, 'grounds', 'Grounds entered', grounds.length ? 'done' : 'todo',
    grounds.length ? `${grounds.length} ground(s) open for booking: ${names(grounds)}. Check the names are the real ones.` : 'No ground is open for booking.',
    'Add the grounds in Settings, Prices and timings.', '/settings/prices');
  const noRates = grounds.filter((g) => !groundRates(g).length && !(g.price_paise > 0));
  add(G, 'rates', 'Rates entered', !grounds.length || noRates.length ? 'todo' : 'done',
    !grounds.length ? 'Enter the grounds first.' : noRates.length ? `No rates for: ${names(noRates)}.` : 'Every ground has rates. Check the amounts against the rate card.',
    'Enter the rates in Settings, Prices and timings.', '/settings/prices');
  add(G, 'timings', 'Opening times entered', grounds.length ? 'done' : 'todo',
    grounds.length ? grounds.map((g) => `${g.name} ${g.open_time} to ${g.close_time}`).join('; ') + '.' : 'Enter the grounds first.',
    'Set the times in Settings, Prices and timings.', '/settings/prices');
  const noPhotos = grounds.filter((g) => { try { return !(JSON.parse(g.images) as unknown[]).length; } catch { return true; } });
  add(G, 'photos', 'Ground photos', !grounds.length || noPhotos.length ? 'warn' : 'done',
    !grounds.length ? 'Enter the grounds first.' : noPhotos.length ? `No photos for: ${names(noPhotos)}.` : 'Every ground has photos. Use only photos you own.',
    'Add your own photos in Photos and videos.', '/media');

  // ---- the booking window ----
  const B = 'Booking window';
  const open = s.bookingsOpenFrom, close = s.bookingsCloseFrom;
  add(B, 'openFrom', 'First booking day set', open ? 'done' : 'warn',
    open ? `Customers can book from ${open}.` : 'No first day: customers can book from today.', 'Set it in Settings, Booking window.', '/settings/booking');
  add(B, 'closeFrom', 'Bookings close on the right day', close && open && close <= open ? 'todo' : close && close <= today ? 'warn' : 'done',
    close ? (open && close <= open ? `Bookings close on ${close}, before they open.` : close <= today ? `Bookings are closed since ${close}.` : `Bookings close from ${close} until you clear it.`) : 'No closing day set.',
    'Set it in Settings, Booking window.', '/settings/booking');

  // ---- payments and messages: names of settings only, never their values ----
  const P = 'Payments and messages';
  const integ = new Map(integrationStatuses(cfg).map((i) => [i.id, i]));
  const rz = integ.get('razorpay')!;
  const live = cfg.razorpay.keyId.startsWith('rzp_live');
  add(P, 'razorpay', 'Razorpay live keys', rz.status === 'ready' && live ? 'done' : rz.status === 'ready' ? 'warn' : 'todo',
    rz.status !== 'ready' ? `Not set: ${rz.missing.join(', ')}.` : live ? 'Live keys and the webhook secret are set.' : 'Test keys are set. Switch to live keys once a test payment and refund have worked.',
    'Put the keys in deploy/.env on the server (never in the desk, chat or git), then press Test in Connections.', '/settings/connections');
  add(P, 'razorpayTest', 'Razorpay keys tested', rz.lastTest?.ok ? 'done' : rz.status === 'ready' ? 'todo' : 'warn',
    rz.lastTest ? `${rz.lastTest.ok ? 'Passed' : 'Failed'}: ${rz.lastTest.message}` : 'Not tested yet.', 'Press Test next to Razorpay in Connections.', '/settings/connections');
  add(P, 'online', 'Online payments switched on', s.razorpayEnabled ? 'done' : 'warn',
    s.razorpayEnabled ? 'Customers can pay online.' : 'Online payment is switched off: customers can only pay by UPI or at the ground.', 'Switch it on in Settings, Payments.', '/settings/payments');
  add(P, 'upi', 'UPI ID for direct payments', s.upiId ? 'done' : 'warn',
    s.upiId ? 'A UPI ID is set.' : 'No UPI ID: customers cannot pay by UPI directly.', 'Enter it in Settings, Payments.', '/settings/payments');
  const wa = integ.get('whatsapp')!, sms = integ.get('msg91')!;
  add(P, 'whatsapp', 'WhatsApp sign-in codes and alerts', wa.status === 'ready' ? (wa.lastTest?.ok ? 'done' : 'warn') : sms.status === 'ready' ? 'warn' : 'todo',
    wa.status === 'ready' ? (wa.lastTest ? `Set. Last test ${wa.lastTest.ok ? 'passed' : 'failed'}.` : 'Set, not tested yet.') : `Not set: ${wa.missing.join(', ')}.${sms.status === 'ready' ? ' Text message codes (MSG91) work meanwhile.' : ' Customers can only sign in with email and password.'}`,
    'Register the number with Meta, get the daji_otp template approved, then put the token and phone number ID in deploy/.env.', '/settings/connections');
  const em = integ.get('email')!;
  add(P, 'email', 'Booking emails (Gmail)', em.status === 'ready' ? (em.lastTest?.ok ? 'done' : 'warn') : 'todo',
    em.status === 'ready' ? (em.lastTest ? `Set. Last test ${em.lastTest.ok ? 'passed' : 'failed'}.` : 'Set, not tested yet.') : `Not set: ${em.missing.join(', ')}.`,
    'Create a Gmail App Password, put it in deploy/.env as GMAIL_APP_PASSWORD, then press Test next to Email in Connections.', '/settings/connections');
  const ai = integ.get('claude')!;
  add(P, 'askAi', 'Ask AI (free-form questions)', ai.status === 'ready' ? (ai.lastTest?.ok ? 'done' : 'warn') : 'warn',
    ai.status === 'ready' ? (ai.lastTest ? `Key set. Last test ${ai.lastTest.ok ? 'passed' : 'failed'}.` : 'Key set, not tested yet. Every question sent to Claude costs money.') : 'No key: Ask AI still answers common questions from the built-in reports. Add a key to let it answer anything.',
    'Put ANTHROPIC_API_KEY in deploy/.env (and AI_MODE=claude), set a monthly spend limit in the Anthropic console, then press Test in Connections.', '/settings/connections');
  const bank = integ.get('yodlee')!;
  add(P, 'bankFeed', 'Automatic bank feed (optional)', bank.status === 'ready' ? (bank.lastTest?.ok ? 'done' : 'warn') : 'warn',
    bank.status === 'ready' ? (bank.lastTest ? `Set. Last test ${bank.lastTest.ok ? 'passed' : 'failed'}.` : 'Set, not tested yet.') : 'Not set up. Bank statements can still be imported from a file in Bank import.',
    'The software owner enters the Yodlee details in Platform, Bank connection. Until then upload statements in Bank import.', '/bank');
  add(P, 'contact', 'Contact details on the website', s.contactPhone && s.contactEmail ? 'done' : 'todo',
    s.contactPhone && s.contactEmail ? 'A phone number and email are shown.' : 'The phone number or email is missing.', 'Enter them in Settings, Website.', '/settings/website');

  // ---- backups ----
  const K = 'Backups';
  const backups = listBackups(cfg);
  const newest = backups[0];
  add(K, 'daily', 'Daily backups', !cfg.backup.enabled ? 'todo' : !cfg.backup.passphrase ? 'warn' : newest && t - newest.createdAt < 36 * HOUR ? 'done' : 'todo',
    !cfg.backup.enabled ? 'Backups are off on this server.' : !cfg.backup.passphrase ? 'Backups run but are not encrypted (BACKUP_PASSPHRASE is not set).' : newest ? `Newest snapshot ${newest.name}${t - newest.createdAt < 36 * HOUR ? '.' : ', more than a day old.'}` : 'No snapshot yet.',
    'Check BACKUP_PASSPHRASE in deploy/.env, or press Take a backup now in Settings, Backups.', '/settings/backups');
  const copy = lastOffsiteCopy(cfg), s3 = backups.find((b) => b.offsite)?.offsite;
  const offAt = Math.max(copy?.at ?? 0, s3?.ok ? s3.at : 0);
  add(K, 'offsite', 'Backups copied off the server', offAt && t - offAt < 3 * 24 * HOUR ? 'done' : offAt ? 'warn' : 'todo',
    offAt ? `Last copy ${new Date(offAt).toISOString().slice(0, 10)}${t - offAt < 3 * 24 * HOUR ? '.' : ', more than 3 days ago.'}` : 'No copy has left the server yet.',
    'Schedule deploy/offsite-backup.sh with cron (deploy/DEPLOY.md, Backups).', '/settings/backups');
  const rp = lastRestorePractice(cfg);
  add(K, 'restore', 'A restore practised', rp?.ok ? 'done' : 'todo',
    rp ? `${rp.ok ? 'Passed' : 'Failed'} on ${new Date(rp.at).toISOString().slice(0, 10)}: ${rp.message}` : 'Never practised.',
    'Press Practise a restore in Settings, Backups, or run deploy/restore-practice.sh.', '/settings/backups');

  // ---- cameras ----
  const cams = listCameras(u, own).items;
  add('Cameras', 'cameras', 'Cameras connected', cams.some((c) => c.online) ? 'done' : cams.length ? 'warn' : 'todo',
    cams.length ? `${cams.filter((c) => c.online).length} of ${cams.length} camera(s) sending pictures now.` : 'No camera added yet.',
    'Add the cameras in Live cameras and run the bridge at the ground (camera-bridge/README.md).', '/cameras');

  // ---- what only a person can confirm ----
  const Y = 'Only you can do these';
  add(Y, 'advocate', 'Advocate review of terms and privacy', 'you', 'docs/LEGAL-REVIEW.md lists the questions for the advocate.', null, '/compliance');
  add(Y, 'ca', 'CA decisions on tax and GST', 'you', 'GST registration, SAC code and rate, PT slab and TDS (docs/LEGAL-REVIEW.md, items 7 and 7b).', null, '/compliance');
  add(Y, 'media', 'Only photos, videos, music and logos you own', 'you', 'docs/MEDIA-INVENTORY.md lists every file to check.', null, '/media');
  add(Y, 'payTest', 'A real test booking, payment and refund', 'you', 'Book, pay, cancel and sign in on the live site with test keys first, then once with live keys.', null, null);
  add(Y, 'phones', 'Phone app on the owner\'s and staff phones', 'you', 'Build the app and install it on each phone; sign in once so alerts reach it.', null, null);

  // screens only the software owner can open: the ground owner is told who does it instead of being sent to a page they cannot see
  if (u.role !== 'super_admin') for (const it of items) if (it.link && SOFTWARE_OWNER_SCREENS.some((p) => it.link === p || it.link!.startsWith(p + '/'))) {
    it.link = null;
    if (it.state !== 'done') it.fix = `${it.fix ?? ''} Your software owner does this.`.trim();
  }

  const counted = items.filter((i) => i.state !== 'you');
  const days = open ? Math.round((Date.parse(`${open}T00:00:00+05:30`) - Date.parse(`${today}T00:00:00+05:30`)) / (24 * HOUR)) : null;
  return { at: t, openingDay: open, daysToOpening: days, done: counted.filter((i) => i.state === 'done').length, total: counted.length, items };
}
