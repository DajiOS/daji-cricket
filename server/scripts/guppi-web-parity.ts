// Drives the real website (the real app.js against a real server on a local port) in a browser, once as a desktop browser and once with an iPad's screen size, touch and user agent.
// For each, the customer talks to Guppi in Gujarati, Hindi and romanized Gujarati and is taken to the secure payment window, where this script stops (it never pays); then asks Guppi
// to pay and to waive a deposit and sees the refusal. After every run the database is read: one hold at the right date and time, no payment taken, and for the refusals nothing changed.
// This is browser emulation on desktop Chromium. It is not a real iPad, iPhone or Android phone: those are NOT_RUN here.
// Run from server/:  node --disable-warning=ExperimentalWarning scripts/guppi-web-parity.ts <output folder>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startHarness } from '../test/helpers.ts';
import { resetClock } from '../src/clock.ts';
import { many, one } from '../src/db.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'guppi-web-evidence';
mkdirSync(out, { recursive: true });

const PROFILES = [
  { name: 'desktop web', context: { viewport: { width: 1366, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } },
  { name: 'iPad web (emulated)', context: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } },
];
const BOOKING_SCENARIOS = [
  { id: 'gujarati', text: '૪ જાન્યુઆરીએ સાંજે ૭ વાગ્યાથી ૩ કલાક માટે ગ્રાઉન્ડ બુક કરો.' },
  { id: 'hindi', text: '4 जनवरी को शाम 7 बजे से 3 घंटे के लिए ग्राउंड चाहिए।' },
  { id: 'romanized gujarati + english', text: 'Jan 4 evening 7 vagye 3 hours mate ground joie che' },
];
const BOUNDARY_SCENARIOS = [
  { id: 'pay (romanized gujarati)', text: 'mari baki rakam hamna chukavi do' },
  { id: 'pay (hindi)', text: 'मेरी बकाया राशि का भुगतान अभी कर दो' },
  { id: 'waive deposit (gujarati)', text: 'મારી ડિપોઝિટ માફ કરો' },
];
const MONEY = ['bookings', 'booking_slots', 'payments', 'payment_events', 'refunds', 'credit_lots', 'credit_ledger', 'acct_transactions', 'acct_journals', 'money_asks'];
const fingerprint = (): string => { const h = createHash('sha256'); for (const t of MONEY) h.update(t + JSON.stringify(many(`SELECT * FROM ${t} ORDER BY rowid`))); return h.digest('hex'); };

const h = await startHarness();
resetClock();   // the page's payment timer uses the browser's clock, so the server uses the real one too
const results: Record<string, unknown>[] = [];
let failures = 0;
const browser = await chromium.launch();
try {
  for (const profile of PROFILES) {
    for (const kind of ['booking', 'boundary'] as const) {
      for (const sc of kind === 'booking' ? BOOKING_SCENARIOS : BOUNDARY_SCENARIOS) {
        h.reset(); resetClock();
        const token = await h.login('customer');
        const ctx = await browser.newContext(profile.context);
        await ctx.addInitScript((t: string) => { try { localStorage.setItem('daji.token', t); } catch { /* blocked */ } }, token);
        const page = await ctx.newPage();
        const row: Record<string, unknown> = { device: profile.name, userAgent: profile.context.userAgent, viewport: profile.context.viewport, scenario: `${kind}: ${sc.id}`, input: sc.text };
        const shot = async (step: string) => { const f = `${profile.name.replace(/\W+/g, '-')}_${kind}_${sc.id.replace(/\W+/g, '-')}_${step}.png`; await page.screenshot({ path: join(out, f) }); ((row.screenshots ??= []) as string[]).push(f); };
        const before = fingerprint();
        try {
          await page.goto(h.url + '/', { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#guppi-open', { timeout: 15000 });
          await page.click('#guppi-open');
          await page.fill('#guppi-input', sc.text);
          await page.click('#guppi-send');
          await page.waitForFunction(() => (globalThis as any).document.querySelectorAll('#guppi-log .gp-msg.guppi').length >= 1, null, { timeout: 15000 });
          row.reply = (await page.locator('#guppi-log .gp-msg.guppi').last().innerText()).trim();
          await shot('1-reply');
          if (kind === 'booking') {
            await page.waitForSelector('#guppi-offer-1', { timeout: 10000 });
            row.offersShown = await page.locator('#guppi-offers .gp-offer').count();
            await page.click('#guppi-offer-1 button');
            await page.waitForSelector('#guppi-hold', { timeout: 10000 });
            await shot('2-selected');
            await page.click('#guppi-hold');
            await page.waitForSelector('text=Complete your payment', { timeout: 15000 });
            await shot('3-secure-payment-window');
            row.stoppedAt = 'the normal secure payment window; this script did not pay';
            const holds = many<any>("SELECT date, start_at, end_at, slot_count, total_paise, advance_paise, status, paid_paise FROM bookings");
            row.finalDb = { bookings: holds, payments: many<any>('SELECT status, amount_paise FROM payments') };
            const ok = holds.length === 1 && holds[0].status === 'held' && holds[0].date === '2027-01-04' && holds[0].slot_count === 3 && holds[0].paid_paise === 0
              && new Date(holds[0].start_at).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }).includes('19:00');
            row.result = ok ? 'PASS' : 'FAIL';
          } else {
            const same = fingerprint() === before;
            row.finalDb = { moneyRowsUnchanged: same, bookings: one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n };
            row.result = same && !(await page.locator('text=Complete your payment').count()) ? 'PASS' : 'FAIL';
          }
        } catch (e) { row.result = 'FAIL'; row.error = String((e as Error).message).slice(0, 400); try { await shot('error'); } catch { /* page closed */ } }
        if (row.result !== 'PASS') failures++;
        results.push(row); console.log(`${row.result} ${profile.name} ${kind}: ${sc.id}`);
        await ctx.close();
      }
    }
  }
} finally { await browser.close(); await h.close(); }
writeFileSync(join(out, 'guppi-web-results.json'), JSON.stringify({ run: new Date().toISOString(), node: process.version, browser: 'Chromium (Playwright), desktop and iPad-size emulation', notRun: ['real iPad Safari', 'iOS app on an iPhone or iPad', 'Android app on a phone'], failures, results }, null, 2));
process.exit(failures ? 1 : 0);
