// Drives the real website (the real app.js against a real server on a local port) in a browser, once as a desktop browser and once with an iPad's screen size, touch and user agent.
// Customer flows added for DEF-MAP-001, 002 and 004: change a booking's time (eligibility, options, preview, confirm), pay a dearer move's exact difference online and see a declined
// attempt stay outstanding, read the security deposit separately from the advance, and see the "too late" refusal. After each run the database is read.
// Staff flows (the desk) are in scripts/client-flows-desk.ts. This is browser emulation on desktop Chromium: not a real iPad, iPhone or Android phone (NOT_RUN).
// Run from server/:  node --disable-warning=ExperimentalWarning scripts/client-flows-web.ts <output folder>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
const out = process.argv[2] ?? 'client-web-evidence';
mkdirSync(out, { recursive: true });

const PROFILES = [
  { name: 'desktop web', context: { viewport: { width: 1366, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } },
  { name: 'iPad web (emulated)', context: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } },
];

const h = await startHarness();
resetClock(); // the page's own clock is the real one, so the server uses the real one too
const results: Record<string, unknown>[] = [];
let failures = 0;
const today = () => istDate(Date.now());
const bookingRow = (id: string) => one<any>('SELECT id, status, date, start_at, total_paise, advance_paise, paid_paise FROM bookings WHERE id = ?', id)!;
const balancePays = (id: string) => many<any>("SELECT status, amount_paise FROM payments WHERE booking_id = ? AND purpose = 'balance' ORDER BY created_at, rowid", id);

type Page = any;
type Ctx = { page: Page; shot: (s: string) => Promise<void>; row: Record<string, unknown>; token: string; g: GroundLite; owner: string; staff: string };

const SCENARIOS: { id: string; run: (c: Ctx) => Promise<boolean> }[] = [
  {
    id: 'customer moves a booking to a dearer time and pays the exact difference online',
    run: async ({ page, shot, row, token, g }) => {
      const date = addDays(today(), 6);
      const b = await bookAndPay(h, token, g.id, date, '09:00', 1);
      const before = bookingRow(b.id);
      await page.goto(h.url + '/#bookings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bk .change-time', { timeout: 15000 });
      await shot('1-my-bookings');
      await page.click('.bk .change-time');
      await page.waitForSelector('#rs-find');
      await shot('2-change-time');
      await page.fill('#rs-date', date); await page.fill('#rs-time', '19:00');
      await page.click('#rs-find');
      await page.waitForSelector('#rs-options button[data-option-id]');
      await page.click('#rs-options button[data-option-id]');
      await page.waitForSelector('#rs-verdict');
      row.verdict = (await page.locator('#rs-verdict').innerText()).trim(); row.direction = await page.getAttribute('#rs-verdict', 'data-direction');
      row.summary = (await page.locator('#rs-summary').innerText()).replace(/\s+/g, ' ');
      await shot('3-preview');
      const unchanged = bookingRow(b.id).start_at === before.start_at && many('SELECT 1 FROM booking_reschedules WHERE booking_id = ?', b.id).length === 0;
      await page.click('#rs-confirm');
      await page.waitForSelector('#rs-done');
      await page.waitForSelector('#rs-pay');
      await shot('4-moved');
      const moved = bookingRow(b.id), diff = moved.total_paise - before.total_paise;
      row.differencePaise = diff;
      await page.click('#rs-pay');
      await page.waitForSelector('#diff-pay');
      row.amountShown = (await page.locator('#diff-amount').innerText()).trim();
      await shot('5-pay-difference');
      await page.click('#diff-pay');
      await page.waitForFunction(() => !document.querySelector('.bk .pay-diff') && !document.querySelector('#modal.open'), null, { timeout: 15000 });
      await shot('6-after-payment');
      const after = bookingRow(b.id), rep = reconcile(g.ownerId);
      row.finalDb = { before, moved, after, balancePayments: balancePays(b.id), reconcileUnexplained: rep.unexplained };
      const shownOk = String(row.amountShown).replace(/[^\d]/g, '') === String(diff / 100);
      return unchanged && row.direction === 'dearer' && shownOk && after.paid_paise === before.paid_paise + diff && after.status === 'confirmed' && balancePays(b.id).length === 1 && balancePays(b.id)[0].status === 'captured' && rep.unexplained === 0;
    },
  },
  {
    id: 'a declined payment leaves the difference outstanding on the booking card, then it is paid',
    run: async ({ page, shot, row, token, g }) => {
      const date = addDays(today(), 6);
      const b = await bookAndPay(h, token, g.id, date, '09:00', 1);
      const r = await h.post(`/api/bookings/${b.id}/reschedule`, { date, startTime: '19:00' }, token);
      if (r.status !== 200) throw new Error('move failed ' + r.status);
      const moved = bookingRow(b.id), diff = moved.total_paise - b.totalPaise;
      await page.goto(h.url + '/#bookings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bk .pay-diff');
      row.cardText = (await page.locator('.bk').first().innerText()).replace(/\s+/g, ' ');
      await page.click('.bk .pay-diff');
      await page.waitForSelector('#diff-decline');
      await page.click('#diff-decline');
      await page.waitForFunction(() => /declined/i.test(document.querySelector('#diff-status')?.textContent || ''), null, { timeout: 15000 });
      await shot('1-declined');
      const afterDecline = bookingRow(b.id);
      await page.click('#modal .x'); // closing the window re-reads the booking from the server
      await page.waitForSelector('.bk .pay-diff');
      row.stillDue = (await page.locator('.bk .pay-diff').innerText()).trim();
      await shot('2-still-due');
      await page.click('.bk .pay-diff');
      await page.waitForSelector('#diff-pay'); await page.click('#diff-pay');
      await page.waitForFunction(() => !document.querySelector('.bk .pay-diff'), null, { timeout: 15000 });
      const done = bookingRow(b.id), rep = reconcile(g.ownerId);
      row.finalDb = { afterDecline, done, balancePayments: balancePays(b.id), reconcileUnexplained: rep.unexplained };
      return afterDecline.paid_paise === moved.paid_paise && afterDecline.status === 'confirmed' && String(row.stillDue).replace(/[^\d]/g, '') === String(diff / 100) && done.paid_paise === moved.paid_paise + diff
        && JSON.stringify(balancePays(b.id).map((p: any) => p.status)) === '["failed","captured"]' && rep.unexplained === 0;
    },
  },
  {
    id: 'the security deposit is shown read-only and apart from the booking advance',
    run: async ({ page, shot, row, token, g, staff }) => {
      const b = await bookAndPay(h, token, g.id, addDays(today(), 6), '19:00', 1);
      const c = await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: staff, body: { amountPaise: 100000, method: 'cash', reference: 'receipt-web-1' }, headers: { 'idempotency-key': 'web-dep-1' } });
      if (c.status !== 201) throw new Error('collect failed ' + c.status);
      const before = bookingRow(b.id);
      await page.goto(h.url + '/#bookings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bk .view-deposit');
      await page.click('.bk .view-deposit');
      await page.waitForSelector('#dep-held-amount');
      row.held = (await page.locator('#dep-held-amount').innerText()).trim();
      row.bookingBlock = (await page.locator('#dep-booking').innerText()).replace(/\s+/g, ' ');
      row.explain = (await page.locator('#dep-explain').innerText()).trim();
      await shot('1-deposit-view');
      const controls = await page.locator('#sheet button:not(.x), #sheet input').count();
      row.controlsInView = controls;
      const after = bookingRow(b.id);
      return row.held === '₹1,000' && /advance/i.test(String(row.bookingBlock)) && /separate/i.test(String(row.explain)) && controls === 0 && JSON.stringify(before) === JSON.stringify(after);
    },
  },
  {
    id: 'inside the 24-hour cut-off the screen shows the server\'s reason and offers no options',
    run: async ({ page, shot, row, token, g }) => {
      // a booking that starts in less than 24 hours: found among today's and tomorrow's slots
      let b: any = null;
      for (const day of [today(), addDays(today(), 1)]) {
        const av = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body.slots as { time: string; start: number; state?: string; available?: boolean }[];
        for (const s of av) { if (s.start - Date.now() > 3 * 3600_000 && s.start - Date.now() < 20 * 3600_000 && (s.state ?? (s.available ? 'available' : 'x')) === 'available') { try { b = await bookAndPay(h, token, g.id, day, s.time, 1); } catch { b = null; } if (b) break; } }
        if (b) break;
      }
      if (!b) { row.skipped = 'no free slot starting within 24 hours found today'; return true; }
      await page.goto(h.url + '/#bookings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bk .change-time');
      await page.click('.bk .change-time');
      await page.waitForSelector('#rs-blocked');
      row.code = await page.getAttribute('#rs-blocked', 'data-code'); row.message = (await page.locator('#rs-blocked').innerText()).trim();
      await shot('1-too-late');
      const noOptions = (await page.locator('#rs-find').count()) === 0;
      const hist = many('SELECT 1 FROM booking_reschedules WHERE booking_id = ?', b.id).length;
      return row.code === 'RESCHEDULE_TOO_LATE' && noOptions && hist === 0;
    },
  },
  {
    id: 'a cheaper time shows the settlement as credit and moves with it',
    run: async ({ page, shot, row, token, g, staff }) => {
      const date = addDays(today(), 7);
      const b = await bookAndPay(h, token, g.id, date, '19:00', 1);
      await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: b.totalPaise - b.paidPaise }, staff);
      await page.goto(h.url + '/#bookings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bk .change-time'); await page.click('.bk .change-time');
      await page.waitForSelector('#rs-find'); await page.fill('#rs-date', date); await page.fill('#rs-time', '09:00'); await page.click('#rs-find');
      await page.waitForSelector('#rs-options button[data-option-id]'); await page.click('#rs-options button[data-option-id]');
      await page.waitForSelector('#rs-verdict');
      row.verdict = (await page.locator('#rs-verdict').innerText()).trim(); await shot('1-cheaper-preview');
      const creditsBefore = many('SELECT 1 FROM credit_lots WHERE booking_id = ?', b.id).length;
      await page.click('#rs-confirm'); await page.waitForSelector('#rs-settled');
      row.settled = (await page.locator('#rs-settled').innerText()).trim(); await shot('2-settled');
      const lots = many<any>('SELECT amount_paise, source FROM credit_lots WHERE booking_id = ?', b.id);
      const rep = reconcile(g.ownerId);
      row.finalDb = { creditsBefore, lots, booking: bookingRow(b.id), reconcileUnexplained: rep.unexplained, refunds: many('SELECT 1 FROM refunds WHERE booking_id = ?', b.id).length };
      return row.direction !== 'x' && /credit/i.test(String(row.verdict)) && lots.length === 1 && lots[0].source === 'restore' && rep.unexplained === 0;
    },
  },
];

const browser = await chromium.launch();
try {
  for (const profile of PROFILES) {
    for (const sc of SCENARIOS) {
      h.reset(); resetClock();
      const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
      const token = await h.login('customer'), owner = await h.login('owner1'), staff = await h.login('staff1');
      const ctx = await browser.newContext(profile.context);
      await ctx.addInitScript((t: string) => { try { localStorage.setItem('daji.token', t); } catch { /* blocked */ } }, token);
      const page = await ctx.newPage();
      const row: Record<string, unknown> = { device: profile.name, userAgent: profile.context.userAgent, viewport: profile.context.viewport, scenario: sc.id };
      const shot = async (step: string) => { const f = `${profile.name.replace(/\W+/g, '-')}_${sc.id.slice(0, 28).replace(/\W+/g, '-')}_${step}.png`; await page.screenshot({ path: join(out, f) }); ((row.screenshots ??= []) as string[]).push(f); };
      try { row.result = (await sc.run({ page, shot, row, token, g, owner, staff })) ? 'PASS' : 'FAIL'; }
      catch (e) { row.result = 'FAIL'; row.error = String((e as Error).message).slice(0, 500); row.stack = String((e as Error).stack).split('\n').slice(0, 4).join(' / '); try { await shot('error'); } catch { /* page closed */ } }
      if (row.result !== 'PASS') failures++;
      results.push(row); console.log(`${row.result} ${profile.name}: ${sc.id}${row.error ? ' :: ' + row.error : ''}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); await h.close(); }
writeFileSync(join(out, 'client-web-results.json'), JSON.stringify({ run: new Date().toISOString(), node: process.version, browser: 'Chromium (Playwright), desktop and iPad-size emulation', notRun: ['real iPad Safari', 'iOS app on an iPhone or iPad', 'Android app on a phone'], failures, results }, null, 2));
process.exit(failures ? 1 : 0);
