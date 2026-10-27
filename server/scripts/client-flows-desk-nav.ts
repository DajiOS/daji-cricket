// Opens every one of the Daji Admin register's 82 left-panel routes as a fresh deep link in the real desk bundle, at desktop, iPad-landscape and phone
// widths, and checks: the page that serves it opens (or the plain "not built" page for a route nothing serves), the left panel marks the register
// section, a workspace opens on the right tab, nothing loaded by the owner shows as failed, and the phone layout has no sideways scroll.
// Then a front-desk team member: the menu shows only what their permissions allow, and pages beyond them say so instead of showing blanks or zeros.
// Browser emulation on desktop Chromium: not a real iPad or phone (NOT_RUN).
// Run from server/:  node --disable-warning=ExperimentalWarning scripts/client-flows-desk-nav.ts <output folder>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, grounds, bookAndPay } from '../test/helpers.ts';
import { resetClock } from '../src/clock.ts';
import { addDays, istDate } from '../src/time.ts';
import { REGISTER, resolveRoute } from '../../desk/src/routes.ts';

declare const document: any;
declare const window: any;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'client-desk-nav-evidence';
mkdirSync(out, { recursive: true });
const PROFILES = [
  { name: 'desktop 1440', key: 'desktop', context: { viewport: { width: 1440, height: 900 } } },
  { name: 'ipad-landscape 1180', key: 'ipad', context: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone 390', key: 'phone', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];
const ELSEWHERE: Record<number, string> = { 60: 'Customers', 62: 'Academy' };
const TAB: Record<string, string> = { customer: 'Customer', money: 'Money', match: 'Match', messages: 'Messages', documents: 'Documents', timeline: 'Timeline', bookings: 'Bookings', activity: 'Activity' };

const h = await startHarness();
resetClock();
const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
const cust = await h.login('customer'), owner = await h.login('owner1'), staff = await h.login('staff1');
const terms = (await h.get('/api/legal/staff-terms', staff)).body;
await h.post('/api/legal/staff-terms/accept', { version: terms.version, sha256: terms.sha256 }, staff);
const booking = await bookAndPay(h, cust, g.id, addDays(istDate(Date.now()), 5), '10:00', 1);
const custId = (await h.get('/api/me', cust)).body.user.id as string;
await h.post('/api/enquiries', { groundId: g.id, message: 'Corporate match for 22 players next month', players: 22 }, cust);
await h.post('/api/staff/ask', { question: 'How many bookings today?' }, owner);
const idFor = (route: string) => route.replace(':id', route.startsWith('/bookings') ? booking.id : route.startsWith('/customers') ? custId : 'prj_demo');

const results: Record<string, unknown>[] = [];
let failures = 0;
const browser = await chromium.launch();

/** A fresh load of the desk at an address, and what it shows once the page has settled. */
async function visit(page: any, route: string) {
  await page.goto('about:blank');
  await page.goto(h.url + '/desk.html#' + route, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const p = document.querySelector('.page');
    if (!p) return false;
    if (p.querySelector('[data-state="loading"], [aria-label="Loading"], .shimmer')) return false;
    if (document.querySelector('#intro')) return false;
    return !!(p.querySelector('h1, [data-state]') || document.querySelector('[role="dialog"]') || p.innerText.trim().length > 60) && !/^\s*Loading…\s*$/.test(p.innerText);
  }, null, { timeout: 30000 });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const p = document.querySelector('.page');
    const dlg = document.querySelector('[role="dialog"]');
    const on = document.querySelector('.dside-grp.on > .dside-item span');
    return {
      title: (p.querySelector('h1')?.innerText || dlg?.getAttribute('aria-label') || '').trim(),
      notBuilt: !!p.querySelector('[data-state="not-built"]'),
      failed: [...document.querySelectorAll('[data-state="failed"], .err[role="alert"]')].map((e: any) => e.innerText.trim().slice(0, 160)),
      denied: [...document.querySelectorAll('[data-state="denied"]')].length,
      section: on ? on.textContent.trim() : null,
      selectedTab: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((e: any) => e.textContent.trim()),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      sideVisible: (() => { const s = document.querySelector('.dside'); if (!s) return false; const r = s.getBoundingClientRect(); return r.right > 0 && r.width > 0; })(),
      menu: [...document.querySelectorAll('.dside-grp > .dside-item span')].map((e: any) => e.textContent.trim()),
    };
  });
}

try {
  // 1. the owner opens all 82 register routes on each profile
  for (const profile of PROFILES) {
    const ctx = await browser.newContext(profile.context);
    await ctx.addInitScript((t: string) => { try { localStorage.setItem('daji.token', t); sessionStorage.setItem('daji.desk.intro', '1'); } catch { /* blocked */ } }, owner);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    for (const r of REGISTER) {
      const route = idFor(r.route);
      const row: Record<string, unknown> = { check: 'register route', device: profile.name, as: 'owner1', registerRow: r.row, registerRoute: '/desk' + r.route, opened: route, servedBy: r.to ? resolveRoute(route).path : null, finding: r.finding };
      const problems: string[] = [];
      try {
        const n = errors.length;
        const s = await visit(page, route);
        Object.assign(row, s);
        if (r.to && s.notBuilt) problems.push('served route shows "not built"');
        if (!r.to && !s.notBuilt) problems.push('unserved route does not say "not built"');
        if (s.failed.length) problems.push('a load failed for the owner: ' + s.failed.join(' | '));
        if (s.denied) problems.push('owner was refused');
        if (!s.title) problems.push('no page heading');
        // rows 60 and 62 have no report of their own yet: they open the customer directory and the academy fees, so the panel marks those sections
        const expectSection = ELSEWHERE[r.row] ?? r.section;
        if (profile.key !== 'phone' && r.to && s.section !== expectSection) problems.push(`left panel marks "${s.section}", expected "${expectSection}"`);
        if (profile.key !== 'phone' && !s.sideVisible) problems.push('left panel hidden on a wide screen');
        const tab = r.route.match(/:id\/(\w+)$/)?.[1];
        if (r.to && tab && TAB[tab] && !s.selectedTab.includes(TAB[tab]!)) problems.push(`opened on tab ${s.selectedTab.join('/')} not ${TAB[tab]}`);
        if (r.to && /^\/(bookings|customers)\/:id$/.test(r.route) && !s.selectedTab.some((t: string) => t === 'Summary' || t === 'Overview')) problems.push('workspace not on its first tab');
        if (profile.key === 'phone' && s.overflowX > 1) problems.push(`page scrolls sideways by ${s.overflowX}px`);
        if (errors.length > n) problems.push('script error: ' + errors.slice(n).join(' | '));
        delete row.menu;
        const shoot = profile.key === 'desktop' || r.row === REGISTER.find((x) => x.section === r.section)!.row || /:id/.test(r.route);
        if (shoot) { const f = `${profile.key}_r${String(r.row).padStart(2, '0')}_${r.route.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'today'}.png`; await page.screenshot({ path: join(out, f) }); row.screenshot = f; }
      } catch (e) { problems.push(String((e as Error).message).slice(0, 300)); }
      row.result = problems.length ? 'FAIL' : 'PASS';
      if (problems.length) { row.problems = problems; failures++; }
      results.push(row);
      console.log(`${row.result} ${profile.name} r${r.row} ${r.route}${problems.length ? ' :: ' + problems.join('; ') : ''}`);
    }
    await ctx.close();
  }

  // 2. a front-desk team member (bookings, payments, enquiries, customers): the menu and the pages follow the same rules as the server
  for (const profile of [PROFILES[0]!, PROFILES[2]!]) {
    const ctx = await browser.newContext(profile.context);
    await ctx.addInitScript((t: string) => { try { localStorage.setItem('daji.token', t); sessionStorage.setItem('daji.desk.intro', '1'); } catch { /* blocked */ } }, staff);
    const page = await ctx.newPage();
    const checks: { route: string; expect: 'ready' | 'refused'; why: string }[] = [
      { route: '/bookings', expect: 'ready', why: 'manages bookings' },
      { route: `/bookings/${booking.id}/messages`, expect: 'ready', why: 'manages bookings' },
      { route: '/enquiries', expect: 'ready', why: 'manages enquiries' },
      { route: `/customers/${custId}/money`, expect: 'ready', why: 'views customers' },
      { route: '/resources/blocks', expect: 'refused', why: 'no manage_grounds' },
      { route: '/finance/gst', expect: 'refused', why: 'no accounting or revenue' },
      { route: '/admin/payroll', expect: 'refused', why: 'owner only' },
    ];
    for (const c of checks) {
      const row: Record<string, unknown> = { check: 'team member permissions', device: profile.name, as: 'staff1', opened: c.route, expect: c.expect, why: c.why };
      const problems: string[] = [];
      try {
        const s = await visit(page, c.route);
        const body = await page.evaluate(() => document.querySelector('.page').innerText as string);
        const refused = s.denied > 0 || /role does not include|permission|not allowed|only the owner|owner only|do not have access/i.test(body);
        Object.assign(row, { title: s.title, denied: s.denied, failed: s.failed, refusedText: refused, menu: s.menu });
        if (c.expect === 'ready' && (refused || s.failed.length)) problems.push('refused or failed: ' + s.failed.join(' | '));
        if (c.expect === 'refused' && !refused) problems.push('no refusal shown');
        if (c.expect === 'refused' && /₹\s?[1-9]/.test(body)) problems.push('money figures shown on a refused page');
        const f = `staff-${profile.key}_${c.route.replace(/\W+/g, '-').slice(0, 40)}.png`; await page.screenshot({ path: join(out, f) }); row.screenshot = f;
      } catch (e) { problems.push(String((e as Error).message).slice(0, 300)); }
      row.result = problems.length ? 'FAIL' : 'PASS';
      if (problems.length) { row.problems = problems; failures++; }
      results.push(row); console.log(`${row.result} ${profile.name} staff ${c.route}${problems.length ? ' :: ' + problems.join('; ') : ''}`);
    }
    // the menu: each section opens on a page this login may use, and lists only those pages
    if (profile.key === 'desktop') {
      const s0 = await visit(page, '/today');
      const sections: Record<string, { opens: string; pages: string[] }> = {};
      for (const label of s0.menu) {
        await page.click(`.dside-grp > .dside-item:has-text("${label}")`);
        await page.waitForFunction((l: string) => document.querySelector('.dside-grp.on > .dside-item span')?.textContent.trim() === l, label, { timeout: 15000 });
        await page.waitForTimeout(400);
        sections[label] = await page.evaluate(() => ({ opens: (document.querySelector('.page h1')?.innerText || '').trim(), pages: [...document.querySelectorAll('.dside-grp.on .dside-sub')].map((e: any) => e.textContent.trim()) }));
      }
      const row: Record<string, unknown> = { check: 'team member menu', device: profile.name, as: 'staff1', menu: s0.menu, sections };
      const problems: string[] = [];
      const money = sections['Revenue & Accounting'];
      if (money && (money.pages.some((x: string) => /GST|Books|Banking|Overview|Payments|Bills|Month end/.test(x)) || !/Pipeline/.test(money.opens))) problems.push('books pages offered without the accounting or revenue permission');
      const admin = sections['Admin'];
      if (admin && (admin.pages.length > 1 || admin.opens !== 'Activity')) problems.push('Admin offers more than the activity log to a team member');
      if (s0.menu.includes('Academy')) problems.push('Academy shown without manage_academy');
      row.result = problems.length ? 'FAIL' : 'PASS';
      if (problems.length) { row.problems = problems; failures++; }
      results.push(row); console.log(`${row.result} ${profile.name} staff menu :: ${JSON.stringify(sections)}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); await h.close(); }
writeFileSync(join(out, 'client-desk-nav-results.json'), JSON.stringify({ run: new Date().toISOString(), node: process.version, browser: 'Chromium (Playwright), desktop, iPad-landscape and phone-width emulation', notRun: ['real iPad', 'real phone'], failures, total: results.length, results }, null, 2));
process.exit(failures ? 1 : 0);
