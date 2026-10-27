// Drives the real staff desk (the committed React desk bundle against a real server on a local port) in a browser at desktop and at phone width.
// Staff flows added for DEF-MAP-001 and DEF-MAP-003: the security deposit panel on a booking (collect, return, keep part with a reason, reverse; permission and server errors shown)
// and the Move Booking control (reason of at least 10 characters, preview, the server's refusals shown, the customer's allowance untouched). The database is read after each run.
// Browser emulation on desktop Chromium: not a real tablet or phone (NOT_RUN).
// Run from server/:  node --disable-warning=ExperimentalWarning scripts/client-flows-desk.ts <output folder>
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
type HTMLButtonElement = any;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'client-desk-evidence';
mkdirSync(out, { recursive: true });
const PROFILES = [
  { name: 'desktop desk 1440', context: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone-width desk 390', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];
const h = await startHarness();
resetClock();
const results: Record<string, unknown>[] = [];
let failures = 0;
const today = () => istDate(Date.now());
const bookingRow = (id: string) => one<any>('SELECT id, status, date, start_at, total_paise, advance_paise, paid_paise, reschedule_count FROM bookings WHERE id = ?', id)!;
const deposit = (id: string) => many<any>('SELECT kind, amount_paise, method, reason FROM security_deposit_entries WHERE booking_id = ? ORDER BY created_at, rowid', id);
const held = (id: string) => deposit(id).reduce((s: number, e: any) => s + (e.kind === 'collect' || e.kind === 'reverse' ? e.amount_paise : -e.amount_paise), 0);

type Ctx = { page: any; shot: (s: string) => Promise<void>; row: Record<string, unknown>; g: GroundLite; cust: string };
// a booking opens on its Summary tab; the deposit panel sits on its Money tab (/bookings/<id>/money)
const open = async (page: any, id: string, tab = '') => { await page.goto(h.url + `/desk.html#/bookings/${id}${tab ? '/' + tab : ''}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[role="dialog"][aria-label^="Booking"]', { timeout: 20000 }); };

const SCENARIOS: { id: string; as: 'owner1' | 'staff1'; run: (c: Ctx) => Promise<boolean> }[] = [
  {
    id: 'owner collects, keeps part with a reason, reverses and returns a security deposit; the booking figures never change',
    as: 'owner1',
    run: async ({ page, shot, row, g, cust }) => {
      const b = await bookAndPay(h, cust, g.id, addDays(today(), 6), '19:00', 1);
      const before = bookingRow(b.id);
      await open(page, b.id, 'money');
      await page.waitForSelector('#deposit-panel [data-act="collect"]');
      await shot('1-panel-empty');
      const dialog = async (act: string, fill: Record<string, string>) => {
        await page.click(`#deposit-panel [data-act="${act}"]`);
        await page.waitForSelector('#deposit-submit');
        for (const [sel, v] of Object.entries(fill)) await page.fill(sel, v);
      };
      await dialog('collect', { '#deposit-amount': '1000', '#deposit-reference': 'receipt-desk-1' });
      await page.click('#deposit-submit');
      await page.waitForFunction(() => document.querySelector('[data-testid="deposit-held"]')?.textContent?.includes('1,000'), null, { timeout: 15000 });
      await shot('2-collected');
      // a too-short reason is refused on the screen; a real one is accepted
      await dialog('deduct', { '#deposit-amount': '300', '#deposit-reason': 'short' });
      await page.click('#deposit-submit');
      await page.waitForSelector('.modal [role="alert"]');
      row.shortReasonError = (await page.locator('.modal [role="alert"]').first().innerText()).trim();
      await page.fill('#deposit-reason', 'Cracked boundary rope, replaced');
      await page.click('#deposit-submit');
      await page.waitForFunction(() => document.querySelector('[data-testid="deposit-held"]')?.textContent?.includes('700'), null, { timeout: 15000 });
      await shot('3-kept-part');
      // asking to keep more than is held shows the server's message
      await dialog('deduct', { '#deposit-amount': '5000', '#deposit-reason': 'Far too much to keep here' });
      await page.click('#deposit-submit');
      await page.waitForFunction(() => /held/i.test(document.querySelector('.modal [role="alert"]')?.textContent || ''), null, { timeout: 15000 });
      row.tooMuchError = (await page.locator('.modal [role="alert"]').first().innerText()).trim();
      await page.locator('.overlay').last().getByRole('button', { name: 'Cancel' }).click(); // closes only the deposit dialog, not the booking behind it
      await dialog('reverse', { '#deposit-reason': 'Rope was already damaged before the match' });
      await page.click('#deposit-submit');
      await page.waitForFunction(() => document.querySelector('[data-testid="deposit-held"]')?.textContent?.includes('1,000'), null, { timeout: 15000 });
      await dialog('refund', { '#deposit-amount': '1000' });
      await page.click('#deposit-submit');
      await page.waitForFunction(() => document.querySelector('[data-testid="deposit-held"]')?.textContent?.includes('₹0'), null, { timeout: 15000 });
      await shot('4-returned');
      const after = bookingRow(b.id), rep = reconcile(g.ownerId);
      row.finalDb = { entries: deposit(b.id), heldPaise: held(b.id), bookingBefore: before, bookingAfter: after, reconcileUnexplained: rep.unexplained };
      return JSON.stringify(before) === JSON.stringify(after) && held(b.id) === 0 && deposit(b.id).map((e: any) => e.kind).join() === 'collect,deduct,reverse,refund' && rep.unexplained === 0;
    },
  },
  {
    id: 'front-desk staff can collect and return a deposit but are not offered the owner-only actions',
    as: 'staff1',
    run: async ({ page, shot, row, g, cust }) => {
      const b = await bookAndPay(h, cust, g.id, addDays(today(), 6), '19:00', 1);
      await open(page, b.id, 'money');
      await page.waitForSelector('#deposit-panel [data-act="collect"]');
      row.offered = await page.locator('#deposit-panel [data-act]').evaluateAll((els: any[]) => els.map((e) => e.getAttribute('data-act')));
      row.ownerOnlyNote = (await page.locator('#deposit-panel').innerText()).includes("owner's decision");
      await shot('1-staff-panel');
      return JSON.stringify(row.offered) === JSON.stringify(['collect', 'refund']) && row.ownerOnlyNote === true;
    },
  },
  {
    id: 'staff move a booking inside the customer cut-off with a reason; the customer allowance is not used',
    as: 'staff1',
    run: async ({ page, shot, row, g, cust }) => {
      // a booking that starts in less than 24 hours, so the customer's own cut-off would refuse the move
      let b: any = null;
      for (const day of [today(), addDays(today(), 1)]) {
        const slots = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body.slots as { time: string; start: number; state?: string }[];
        for (const sl of slots) if (sl.start - Date.now() > 3 * 3600_000 && sl.start - Date.now() < 20 * 3600_000 && sl.state === 'available') { try { b = await bookAndPay(h, cust, g.id, day, sl.time, 1); } catch { b = null; } if (b) break; }
        if (b) break;
      }
      if (!b) { row.skipped = 'no free slot within 24 hours found'; return false; }
      const custRefused = await h.post(`/api/bookings/${b.id}/reschedule`, { date: b.date, startTime: '23:00' }, cust);
      row.customerSees = custRefused.body?.error?.code;
      const target = (await h.get(`/api/grounds/${g.id}/availability?date=${b.date}`)).body.slots.filter((x: any) => x.state === 'available' && x.start > b.startAt + 3600_000).map((x: any) => x.time)[0] as string | undefined;
      if (!target) { row.skipped = 'no later free slot that day'; return false; }
      const before = bookingRow(b.id);
      await open(page, b.id);
      await page.click('#move-booking');
      await page.waitForSelector('#move-confirm');
      await page.fill('#move-time', target);
      await page.click('#move-confirm');
      await page.waitForFunction(() => /Show what changes. first/.test(document.body.innerText), null, { timeout: 5000 });
      row.confirmBeforePreview = 'refused: asks for the preview first';
      if (bookingRow(b.id).start_at !== before.start_at) throw new Error('the booking moved without a preview');
      await page.click('#move-preview');
      await page.waitForSelector('#move-preview-box');
      row.verdict = (await page.locator('#move-verdict').innerText()).trim();
      await shot('1-preview');
      await page.fill('#move-reason', 'too short');
      await page.click('#move-confirm');
      await page.waitForFunction(() => /10 characters/i.test(document.querySelector('.modal [role="alert"]')?.textContent || ''), null, { timeout: 10000 });
      row.reasonError = (await page.locator('.modal [role="alert"]').first().innerText()).trim();
      await shot('2-reason-required');
      await page.fill('#move-reason', 'Customer phoned: team arrives later');
      await page.click('#move-confirm');
      await page.waitForFunction(() => !document.querySelector('#move-confirm'), null, { timeout: 15000 });
      const after = bookingRow(b.id);
      const hist = many<any>('SELECT actor_role, reason FROM booking_reschedules WHERE booking_id = ?', b.id);
      row.finalDb = { before, after, history: hist, customerMoves: one<{ n: number }>("SELECT COUNT(*) n FROM booking_reschedules WHERE booking_id = ? AND actor_role = 'customer'", b.id)!.n };
      return row.customerSees === 'RESCHEDULE_TOO_LATE' && row.confirmBeforePreview !== undefined && after.start_at !== before.start_at && after.reschedule_count === 0
        && hist.length === 1 && hist[0].actor_role === 'staff' && hist[0].reason === 'Customer phoned: team arrives later';
    },
  },
  {
    id: 'a move to a taken time shows the server\'s refusal and changes nothing',
    as: 'staff1',
    run: async ({ page, shot, row, g, cust }) => {
      const date = addDays(today(), 6);
      const b = await bookAndPay(h, cust, g.id, date, '10:00', 1);
      await bookAndPay(h, cust, g.id, date, '14:00', 1);
      const before = bookingRow(b.id);
      await open(page, b.id);
      await page.click('#move-booking'); await page.waitForSelector('#move-confirm');
      await page.fill('#move-time', '14:00'); await page.fill('#move-reason', 'Trying a time that is taken');
      await page.click('#move-preview');
      await page.waitForSelector('.modal [role="alert"]');
      row.error = (await page.locator('.modal [role="alert"]').first().innerText()).trim();
      await shot('1-taken');
      const after = bookingRow(b.id);
      return JSON.stringify(before) === JSON.stringify(after) && many('SELECT 1 FROM booking_reschedules WHERE booking_id = ?', b.id).length === 0 && /taken|booked|available/i.test(String(row.error));
    },
  },
  {
    id: 'the owner links a whole ground to its nets on the settings screen, and the booking engine then refuses or allows the same time as configured',
    as: 'owner1',
    run: async ({ page, shot, row, g, cust }) => {
      const nets = (await grounds(h)).find((x) => x.name === 'Practice Nets')!;
      const date = addDays(today(), 6);
      const hold = async (ground: GroundLite, t: string) => (await h.post('/api/bookings', { groundId: ground.id, date, startTime: t, slots: 1 }, cust)).status;
      await page.goto(h.url + '/desk.html#/settings/prices', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`[data-ground="${g.id}"] [data-include="${nets.id}"]`, { timeout: 20000 });
      await shot('1-settings-before');
      await page.check(`[data-ground="${g.id}"] [data-include="${nets.id}"]`);
      await page.click(`[data-save-links="${g.id}"]`);
      await page.waitForFunction((id: string) => (document.querySelector(`[data-save-links="${id}"]`) as HTMLButtonElement)?.disabled === true, g.id, { timeout: 15000 });
      await shot('2-saved-blocking');
      const linkRow = many<any>('SELECT parent_id, child_id, conflicts FROM ground_links');
      const netsFirst = await hold(nets, '19:00');
      const wholeSameTime = await hold(g, '19:00');
      await page.uncheck(`[data-ground="${g.id}"] [data-blocks="${nets.id}"]`);
      await page.click(`[data-save-links="${g.id}"]`);
      await page.waitForFunction((id: string) => (document.querySelector(`[data-save-links="${id}"]`) as HTMLButtonElement)?.disabled === true, g.id, { timeout: 15000 });
      const independent = many<any>('SELECT conflicts FROM ground_links');
      const wholeAfter = await hold(g, '19:00');
      row.finalDb = { linkRow, netsFirst, wholeSameTime, independent, wholeAfterIndependent: wholeAfter, audit: many<any>("SELECT action FROM audit_log WHERE action = 'ground.links'").length };
      return linkRow.length === 1 && linkRow[0].conflicts === 1 && netsFirst === 201 && wholeSameTime === 409 && independent[0].conflicts === 0 && wholeAfter === 201;
    },
  },
];

const browser = await chromium.launch();
try {
  for (const profile of PROFILES) {
    for (const sc of SCENARIOS) {
      h.reset(); resetClock();
      const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
      const token = await h.login(sc.as), cust = await h.login('customer');
      if (sc.as === 'staff1') { const t = (await h.get('/api/legal/staff-terms', token)).body; await h.post('/api/legal/staff-terms/accept', { version: t.version, sha256: t.sha256 }, token); } // a team member accepts the terms once, as the desk would ask
      const ctx = await browser.newContext(profile.context);
      await ctx.addInitScript((t: string) => { try { localStorage.setItem('daji.token', t); } catch { /* blocked */ } }, token);
      const page = await ctx.newPage();
      const row: Record<string, unknown> = { device: profile.name, viewport: profile.context.viewport, signedInAs: sc.as, scenario: sc.id };
      const shot = async (step: string) => { const f = `${profile.name.replace(/\W+/g, '-')}_${sc.id.slice(0, 26).replace(/\W+/g, '-')}_${step}.png`; await page.screenshot({ path: join(out, f) }); ((row.screenshots ??= []) as string[]).push(f); };
      try { row.result = (await sc.run({ page, shot, row, g, cust })) ? 'PASS' : 'FAIL'; }
      catch (e) { row.result = 'FAIL'; row.error = String((e as Error).message).slice(0, 500); try { await shot('error'); } catch { /* page closed */ } }
      if (row.result !== 'PASS') failures++;
      results.push(row); console.log(`${row.result} ${profile.name} (${sc.as}): ${sc.id}${row.error ? ' :: ' + row.error : ''}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); await h.close(); }
writeFileSync(join(out, 'client-desk-results.json'), JSON.stringify({ run: new Date().toISOString(), node: process.version, browser: 'Chromium (Playwright), desktop and phone-width emulation', notRun: ['real tablet or phone browser'], failures, results }, null, 2));
process.exit(failures ? 1 : 0);
