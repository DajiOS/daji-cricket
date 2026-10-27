// Runs the REAL phone-app screens (mobile/src/MeScreen.tsx, ManageBooking.tsx, PayScreen.tsx and what they import) against a real server on a local port.
// The screens are bundled with esbuild and drawn with the small React Native stand-in in mobile/preview/shim (HTML in Chromium at phone size), so the app's own screen code, API calls
// and state run for real; only the native widgets are replaced. This is EMULATION of the screens' behaviour. It is not Expo Go, a simulator or a real iPhone or Android phone, and it
// says nothing about native look, keyboard, touch or the real Razorpay window (all NOT_RUN). iOS and Android share these same screens.
// Run from server/:  ESBUILD_PATH=<esbuild> REACT_DIR=<node_modules holding react and react-dom> node --disable-warning=ExperimentalWarning scripts/client-flows-mobile.ts <output folder>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startHarness, grounds, bookAndPay, type GroundLite } from '../test/helpers.ts';
import { resetClock } from '../src/clock.ts';
import { many, one } from '../src/db.ts';
import { reconcile } from '../src/finevents.ts';
import { addDays, istDate } from '../src/time.ts';

// Code passed to page.evaluate / waitForFunction runs in the browser; these names exist there, not in Node.
declare const document: any;
declare const window: any;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const esbuild = require(process.env.ESBUILD_PATH || 'esbuild');
const REACT_DIR = process.env.REACT_DIR || '/tmp/desk-tools/node_modules';
const out = process.argv[2] ?? 'client-mobile-evidence';
mkdirSync(out, { recursive: true });
const REPO = resolve(import.meta.dirname, '../..');

const h = await startHarness();
resetClock();
const work = mkdtempSync(join(tmpdir(), 'daji-mobile-'));
const entry = join(work, 'entry.tsx');
writeFileSync(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeScreen } from '${REPO}/mobile/src/MeScreen';
import { loadToken } from '${REPO}/mobile/src/api';
const user = (window as any).__DAJI_USER__;
loadToken().then(() => createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><MeScreen user={user} onSignOut={() => {}} /></div>));
`);
const Sh = `${REPO}/mobile/preview/shim`;
const built = await esbuild.build({
  entryPoints: [entry], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.ts': 'ts', '.tsx': 'tsx' }, logLevel: 'error',
  alias: { 'react-native': `${Sh}/rn.tsx`, 'expo-secure-store': `${Sh}/stubs.ts`, 'expo-image-picker': `${Sh}/picker.ts`, 'expo-notifications': `${Sh}/notif.ts`, 'expo-constants': `${Sh}/misc.tsx`, 'expo-status-bar': `${Sh}/misc.tsx`, 'react-native-webview': `${Sh}/misc.tsx`, react: `${REACT_DIR}/react`, 'react-dom': `${REACT_DIR}/react-dom` },
  define: { 'process.env.EXPO_PUBLIC_APP_ENV': '"dev"', 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify(h.url), 'process.env.NODE_ENV': '"production"' }, nodePaths: [REACT_DIR, `${REPO}/mobile/node_modules`],
});
const bundle = built.outputFiles[0].text;
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}@keyframes rnspin{to{transform:rotate(360deg)}}</style></head><body><div id="root" style="height:100%"></div><script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';

const today = () => istDate(Date.now());
const bookingRow = (id: string) => one<any>('SELECT id, status, date, start_at, total_paise, advance_paise, paid_paise FROM bookings WHERE id = ?', id)!;
const balancePays = (id: string) => many<any>("SELECT status, amount_paise FROM payments WHERE booking_id = ? AND purpose = 'balance' ORDER BY created_at, rowid", id);
const ddmmyyyy = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const digits = (t: string) => t.replace(/[^\d]/g, '');

type Ctx = { page: any; shot: (s: string) => Promise<void>; row: Record<string, unknown>; token: string; g: GroundLite; staff: string };
const text = (page: any, t: string | RegExp) => page.getByText(t).first();
const tap = async (page: any, t: string | RegExp) => { await text(page, t).waitFor({ timeout: 15000 }); await text(page, t).click(); };

const SCENARIOS: { id: string; run: (c: Ctx) => Promise<boolean> }[] = [
  {
    id: 'a booking is moved to a dearer time and the exact difference is paid on the app',
    run: async ({ page, shot, row, token, g }) => {
      const date = addDays(today(), 6);
      const b = await bookAndPay(h, token, g.id, date, '09:00', 1);
      const before = bookingRow(b.id);
      await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('Your bookings'), null, { timeout: 20000 });
      await tap(page, 'Change time'); await shot('1-card');
      await text(page, 'Show times').waitFor();
      await page.getByPlaceholder('dd/mm/yyyy').fill(ddmmyyyy(date));
      await page.locator('input').nth(1).fill('19:00');
      await tap(page, 'Show times');
      await tap(page, /19:00 – 20:00/);
      await text(page, 'Confirm the move').waitFor();
      row.verdict = (await text(page, /costs .* more/).innerText()).trim(); await shot('2-preview');
      const untouched = bookingRow(b.id).start_at === before.start_at && many('SELECT 1 FROM booking_reschedules WHERE booking_id = ?', b.id).length === 0;
      await tap(page, 'Confirm the move');
      await text(page, /^Moved to/).waitFor(); await shot('3-moved');
      const moved = bookingRow(b.id), diff = moved.total_paise - before.total_paise;
      await tap(page, /Pay the .* difference online/);
      await text(page, 'Pay the difference').waitFor();
      row.screen = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400); await shot('4-pay-difference');
      const shown = await text(page, /Pay .* with the demo card/).innerText();
      await tap(page, /Pay .* with the demo card/);
      await text(page, 'Payment received. Thank you.').waitFor();
      await shot('5-after-payment');
      const after = bookingRow(b.id), rep = reconcile(g.ownerId);
      row.finalDb = { before, moved, after, balancePayments: balancePays(b.id), reconcileUnexplained: rep.unexplained };
      return untouched && digits(shown) === String(diff / 100) && after.paid_paise === before.paid_paise + diff && after.status === 'confirmed' && balancePays(b.id).length === 1 && balancePays(b.id)[0].status === 'captured' && rep.unexplained === 0 && !/hold has run out/i.test(String(row.screen));
    },
  },
  {
    id: 'a declined card leaves the difference outstanding on the card and it is paid on the retry',
    run: async ({ page, shot, row, token, g }) => {
      const date = addDays(today(), 6);
      const b = await bookAndPay(h, token, g.id, date, '09:00', 1);
      if ((await h.post(`/api/bookings/${b.id}/reschedule`, { date, startTime: '19:00' }, token)).status !== 200) throw new Error('move failed');
      const moved = bookingRow(b.id), diff = moved.total_paise - b.totalPaise;
      await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('Your bookings'), null, { timeout: 20000 });
      row.cardText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      await tap(page, /^Pay .* online$/);
      await tap(page, 'Pretend the card is declined');
      await text(page, /declined/i).waitFor(); await shot('1-declined');
      const afterDecline = bookingRow(b.id);
      await tap(page, 'Back');
      await text(page, /^Pay .* online$/).waitFor(); row.stillDue = (await text(page, /^Pay .* online$/).innerText()).trim(); await shot('2-still-due');
      await tap(page, /^Pay .* online$/); await tap(page, /Pay .* with the demo card/);
      await text(page, 'Payment received. Thank you.').waitFor();
      const done = bookingRow(b.id), rep = reconcile(g.ownerId);
      row.finalDb = { afterDecline, done, balancePayments: balancePays(b.id), reconcileUnexplained: rep.unexplained };
      return afterDecline.paid_paise === moved.paid_paise && afterDecline.status === 'confirmed' && digits(String(row.stillDue)) === String(diff / 100) && done.paid_paise === moved.paid_paise + diff
        && JSON.stringify(balancePays(b.id).map((p: any) => p.status)) === '["failed","captured"]' && rep.unexplained === 0;
    },
  },
  {
    id: 'the security deposit is shown read-only and apart from the booking advance',
    run: async ({ page, shot, row, token, g, staff }) => {
      const b = await bookAndPay(h, token, g.id, addDays(today(), 6), '19:00', 1);
      if ((await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: staff, body: { amountPaise: 100000, method: 'cash', reference: 'receipt-app-1' }, headers: { 'idempotency-key': 'app-dep-1' } })).status !== 201) throw new Error('collect failed');
      const before = bookingRow(b.id);
      await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('Your bookings'), null, { timeout: 20000 });
      await tap(page, 'Security deposit');
      await text(page, 'Security deposit held now').waitFor();
      row.screen = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      await shot('1-deposit-view');
      const buttons = await page.locator('[role="button"]').allInnerTexts();
      row.buttons = buttons;
      return /Booking advance \(part of the price\)/.test(String(row.screen)) && /₹1,000/.test(String(row.screen)) && /separate amount/.test(String(row.screen)) && buttons.map((x: string) => x.trim()).join('|') === 'Back' && JSON.stringify(before) === JSON.stringify(bookingRow(b.id));
    },
  },
  {
    id: 'a booking inside the 24-hour cut-off shows the server\'s reason and offers no times',
    run: async ({ page, shot, row, token, g }) => {
      let b: any = null;
      for (const day of [today(), addDays(today(), 1)]) {
        const slots = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body.slots as { time: string; start: number; state?: string }[];
        for (const sl of slots) if (sl.start - Date.now() > 3 * 3600_000 && sl.start - Date.now() < 20 * 3600_000 && sl.state === 'available') { try { b = await bookAndPay(h, token, g.id, day, sl.time, 1); } catch { b = null; } if (b) break; }
        if (b) break;
      }
      if (!b) { row.skipped = 'no free slot within 24 hours found'; return false; }
      await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('Your bookings'), null, { timeout: 20000 });
      await tap(page, 'Change time');
      await text(page, /more than 24 hours remain/).waitFor();
      row.message = (await text(page, /more than 24 hours remain/).innerText()).trim(); await shot('1-too-late');
      return (await page.getByText('Show times').count()) === 0 && many('SELECT 1 FROM booking_reschedules WHERE booking_id = ?', b.id).length === 0;
    },
  },
];

const PROFILE = { name: 'phone-size screen (React Native stand-in, Chromium)', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const results: Record<string, unknown>[] = [];
let failures = 0;
const browser = await chromium.launch();
try {
  for (const sc of SCENARIOS) {
    h.reset(); resetClock();
    const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
    const token = await h.login('customer'), staff = await h.login('staff1');
    const me = (await h.get('/api/me', token)).body;
    const ctx = await browser.newContext(PROFILE.context);
    await ctx.addInitScript(([t, u]: [string, string]) => { try { localStorage.setItem('daji.token', t); (window as any).__DAJI_USER__ = JSON.parse(u); } catch { /* blocked */ } }, [token, JSON.stringify(me.user ?? me)]);
    const page = await ctx.newPage();
    await page.route('**/__mobile__', (r: any) => r.fulfill({ contentType: 'text/html', body: html }));
    const row: Record<string, unknown> = { device: PROFILE.name, viewport: PROFILE.context.viewport, scenario: sc.id };
    const shot = async (step: string) => { const f = `mobile_${sc.id.slice(0, 28).replace(/\W+/g, '-')}_${step}.png`; await page.screenshot({ path: join(out, f) }); ((row.screenshots ??= []) as string[]).push(f); };
    try {
      await page.goto(h.url + '/__mobile__', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.innerText.includes('Your bookings') || document.body.innerText.includes('My dashboard'), null, { timeout: 20000 });
      row.result = (await sc.run({ page, shot, row, token, g, staff })) ? 'PASS' : 'FAIL';
    } catch (e) { row.result = 'FAIL'; row.error = String((e as Error).message).slice(0, 500); try { await shot('error'); } catch { /* page closed */ } }
    if (row.result !== 'PASS') failures++;
    results.push(row); console.log(`${row.result} ${sc.id}${row.error ? ' :: ' + row.error : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); await h.close(); }
writeFileSync(join(out, 'client-mobile-results.json'), JSON.stringify({ run: new Date().toISOString(), node: process.version, method: 'real mobile screen source bundled with esbuild and drawn through mobile/preview/shim in Chromium at phone size, against the real server', notRun: ['Expo Go', 'iOS simulator', 'Android emulator', 'real iPhone or iPad', 'real Android phone', 'real Razorpay window'], failures, results }, null, 2));
process.exit(failures ? 1 : 0);
