// Opens the website in every look (plain, designer, quarterly pack and festival), day and night, at desktop, laptop and phone width,
// and lists layout problems: the price list or price row narrower than its card, price columns stacked on a wide screen, text cut off
// by its box, and the page scrolling sideways. Run it before a new design pack or festival look ships:
//   node tools/layout/check.mjs [http://localhost:4000] [look,look,...]
// It needs the server running and Playwright (PLAYWRIGHT=/path/to/playwright if it is not installed here). Exit code 1 on a problem.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const app = readFileSync(join(here, '../../web/public/app.js'), 'utf8');
const all = [...app.match(/const THEMES = (\[[\s\S]*?\]\]);/)[1].matchAll(/\['([\w-]+)', '/g)].map((m) => m[1]);
const looks = process.argv[3] ? process.argv[3].split(',') : all;
// a ground with a full price list, whatever the local database holds, so the price card is always drawn
const R = (label, ball, days, from, to, mode, rs, bd = 1) => ({ id: label + ball, label, ball, days, from, to, mode, pricePaise: rs * 100, bundleDays: bd });
const rates = [R('Morning session', 'leather', [2, 3, 4, 5], '07:00', '10:00', 'fixed', 4000), R('Weekend day', 'leather', [6, 0], '07:00', '19:00', 'fixed', 15000),
  R('Evening hours', 'leather', [2, 3, 4, 5, 6, 0], '19:00', '27:00', 'hourly', 3500), R('Two-day tournament (Sat + Sun)', 'tennis', [6], '07:00', '23:00', 'fixed', 151000, 2),
  R('Evening hours', 'tennis', [2, 3, 4, 5, 6, 0], '19:00', '27:00', 'hourly', 3000)];

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let problems = 0;
for (const width of [1400, 1024, 390]) for (const mode of ['day', 'night']) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((m) => { try { sessionStorage.setItem('daji.splash', '1'); localStorage.setItem('daji.mode', JSON.stringify({ m, until: Date.now() + 864e5 })); } catch { /* no storage */ } }, mode);
  await ctx.addInitScript({ path: join(here, 'problems.js') });
  const p = await ctx.newPage();
  await p.route('**/api/grounds', async (route) => { const r = await route.fetch(); const j = await r.json(); for (const g of j.items) g.rates = rates; await route.fulfill({ response: r, json: j }); });
  for (const look of looks) {
    // a festival look only shows on its day, so it is previewed through ?festival=<id>; the others through ?theme=
    await p.goto(look.startsWith('fes_') ? `${base}/?festival=${look}&day=1` : `${base}/?theme=${look}`);
    await p.waitForSelector('.ratecard .rc-col', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(500);
    const found = [...new Set(await p.evaluate(() => window.__layoutProblems()))];
    if (found.length) { problems += found.length; console.log(`${look}, ${mode}, ${width} px:\n  ${found.join('\n  ')}`); }
  }
  await ctx.close();
}
await b.close();
console.log(problems ? `${problems} problems` : `No layout problems in ${looks.length} looks, day and night, at 1400, 1024 and 390 px.`);
process.exit(problems ? 1 : 0);
