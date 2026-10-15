// Builds brand/tokens.css and brand/theme-preview.html from shared/src/brand.ts, so the preview can never drift from the real tokens.
//   node --disable-warning=ExperimentalWarning brand/build.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../server/src/settings.ts';
import { DAJI_LOCATION } from '../server/src/seed.ts';
import { THEMES, DESIGN, BRAND, cssVariables, formatPaise, formatPhone, ballSvg, wordmarkSvg, BALL_COLORS, BALL_PROOF_COLORS, type WordmarkVariant } from '../shared/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(join(here, 'theme-preview.tpl.html'), 'utf8');

const tokens = cssVariables('obsidian') + '\n' + cssVariables('ivory', '[data-theme="ivory"]');
writeFileSync(join(here, 'tokens.css'), `/* Generated from shared/src/brand.ts — do not edit. */\n${tokens}`);


// ---- sample numbers that add up (paise)
const rev = { played: 48_620_000, noshow: 1_800_000, late: 1_100_000, expired: 250_000, other: 2_500_000 };
const exp: [string, string, number][] = [
  ['Staff', 'Salaries & wages', 6_800_000],
  ['Ground upkeep', 'Groundsman & pitch care', 3_200_000],
  ['Ground upkeep', 'Repairs & maintenance', 2_100_000],
  ['Ground upkeep', 'Equipment & consumables', 625_075],
  ['Utilities', 'Electricity & floodlights', 1_843_200],
  ['Utilities', 'Water', 240_000],
  ['Premises', 'Rent & lease', 4_000_000],
  ['Premises', 'Insurance', 450_000],
  ['Admin & finance', 'Marketing & advertising', 1_200_000],
  ['Admin & finance', 'Payment gateway fees', 986_000],
  ['Admin & finance', 'Professional fees', 800_000],
  ['Admin & finance', 'Bank charges', 3_540],
];
const revenueTotal = rev.played + rev.noshow + rev.late + rev.expired + rev.other;
const expenseTotal = exp.reduce((s, e) => s + e[2], 0);
const net = revenueTotal - expenseTotal;
const margin = `${Math.round((net / revenueTotal) * 1000) / 10}%`;

const row = (label: string, paise: number, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${formatPaise(paise).replace('₹', '')}</td></tr>`;
const grp = (label: string) => `<tr class="grp"><td colspan="2">${label}</td></tr>`;
let pl = grp('Revenue');
pl += row('Bookings played', rev.played) + row('No-show advances kept', rev.noshow) + row('Late-cancellation fees', rev.late) + row('Expired credit', rev.expired) + row('Other income', rev.other);
pl += row('Total revenue', revenueTotal, 'sub');
for (const g of [...new Set(exp.map((e) => e[0]))]) {
  pl += grp(g);
  for (const e of exp.filter((x) => x[0] === g)) pl += row(e[1], e[2]);
}
pl += row('Total expenses', expenseTotal, 'sub');
pl += `<tr class="net"><td>Net profit</td><td>${formatPaise(net).replace('₹', '')}</td></tr>`;

const months = ['N', 'D', 'J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O'];
const heights = [38, 44, 41, 52, 61, 66, 58, 49, 55, 63, 70, 84];
const bars = heights.map((h, i) => `<i class="${i === 11 ? 'cur' : ''}" style="height:${h}%"></i>`).join('');
const mlabels = months.map((m) => `<span>${m}</span>`).join('');

// ---- booking panel
const days = ['Wed 14', 'Thu 15', 'Fri 16', 'Sat 17', 'Sun 18', 'Mon 19', 'Tue 20'].map((d, i) => {
  const [w, n] = d.split(' ');
  return `<div class="day${i === 3 ? ' on' : ''}">${w}<b>${n}</b></div>`;
}).join('');
type S = 'av' | 'sel' | 'held' | 'booked' | 'blocked';
const slotDefs: [string, S, number][] = [
  ['16:00', 'booked', 220000], ['17:00', 'av', 220000], ['18:00', 'held', 260000], ['19:00', 'sel', 260000],
  ['20:00', 'sel', 260000], ['21:00', 'av', 260000], ['22:00', 'av', 260000], ['15:00', 'booked', 220000],
  ['14:00', 'av', 220000], ['13:00', 'av', 220000], ['12:00', 'blocked', 220000], ['11:00', 'av', 220000],
];
const order = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
const slots = order.map((t) => {
  const [, st, p] = slotDefs.find((s) => s[0] === t)!;
  return `<div class="slot ${st}">${t}<small>${st === 'booked' ? 'Booked' : st === 'held' ? 'Held' : st === 'blocked' ? 'Closed' : formatPaise(p)}</small></div>`;
}).join('');

const grounds = [
  { n: 'Cricket Ground', area: 'Surat', mono: 'D', f: ['Floodlights', 'Changing rooms', 'Parking'], p: 180000 },
  { n: 'Practice Nets', area: 'Surat', mono: 'N', f: ['Floodlights', 'Bowling machine'], p: 60000 },
  { n: 'Riverside Box Cricket', area: 'Gotri, Vadodara', mono: 'R', f: ['Floodlights', 'Parking'], p: 150000 },
].map((g) => `<a class="card" href="#"><div class="plate"><i>${g.mono}</i><span class="eyebrow">${g.area}</span></div><div class="body"><h4>${g.n}</h4><div class="chips">${g.f.map((x) => `<span class="chip">${x}</span>`).join('')}</div><div class="price"><div><b>${formatPaise(g.p)}</b> <span>/ hour</span></div><span class="arrow">Book →</span></div></div></a>`).join('');

const swatchKeys = ['bg', 'surface', 'surfaceHigh', 'text', 'gold', 'goldBright', 'bronze', 'emeraldBright', 'ok', 'warn', 'danger', 'info'] as const;
const swatches = swatchKeys.map((k) => `<div style="background:${THEMES.obsidian[k]};${['text', 'gold', 'goldBright', 'ok', 'warn', 'info', 'bronze', 'danger'].includes(k) ? 'color:#0a0c0b;text-shadow:none' : ''}">${k.replace(/([A-Z])/g, ' $1')}</div>`).join('');

// What the page says about contact and the academy comes from the same defaults the server uses, so the two cannot disagree.
const S = DEFAULT_SETTINGS;
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const [acFirst, ...acRest] = S.academyName.split(' ');
const coords = `${DAJI_LOCATION.lat.toFixed(4)}° N, ${DAJI_LOCATION.lng.toFixed(4)}° E`;

const fill: Record<string, string> = {
  TAGLINE: esc(BRAND.tagline), CITY: 'Surat', COORDS: coords, DIRECTIONS: esc(DAJI_LOCATION.mapUrl),
  CONTACT_NAME: esc(S.contactName), CONTACT_PHONE: esc(formatPhone(S.contactPhone)), CONTACT_PHONE_RAW: esc(S.contactPhone), CONTACT_EMAIL: esc(S.contactEmail),
  ACADEMY_NAME: esc(S.academyName), ACADEMY_RUNBY: esc(S.academyRunBy), ACADEMY_BRAND: esc(S.academyBrand), ACADEMY_ABOUT: esc(S.academyAbout),
  ACADEMY_H: `${esc(acFirst ?? '')} ${esc(acRest.slice(0, -1).join(' '))} <em>${esc(acRest.slice(-1)[0] ?? '')}</em>`.replace('  ', ' '),
  GOOGLE_FONTS: DESIGN.googleFonts, TOKENS: tokens, 
  PRICE_FROM: formatPaise(180000), SUM_TOTAL: formatPaise(520000), SUM_ADV: formatPaise(260000),
  DAYS: days, SLOTS: slots, GROUNDS: grounds, PL_ROWS: pl, BARS: bars, MLABELS: mlabels, SWATCHES: swatches,
  K_REV: formatPaise(revenueTotal), K_REV_NOTE: '124 bookings played', K_EXP: formatPaise(expenseTotal), K_EXP_NOTE: 'paid in October', K_NET: formatPaise(net), K_MARGIN: margin,
  RZP: formatPaise(4_825_050),
  WORDMARK_NAV: wordmarkSvg('copper', { id: 'wmn', attrs: 'class="wm-nav"' }), WORDMARK_BIG: wordmarkSvg('copper', { id: 'wmb' }),
};
let html = tpl;
for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(v);
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) throw new Error(`unfilled placeholders: ${[...new Set(left)].join(', ')}`);
writeFileSync(join(here, 'theme-preview.html'), html);
// the brand files
writeFileSync(join(here, 'ball-o.svg'), ballSvg(BALL_COLORS, 'ball', 'width="512" height="512"'));
writeFileSync(join(here, 'ball-o-proof.svg'), ballSvg(BALL_PROOF_COLORS, 'ball', 'width="512" height="512"'));
for (const v of ['copper', 'gold', 'ink', 'proof'] as WordmarkVariant[]) writeFileSync(join(here, `wordmark-${v}.svg`), wordmarkSvg(v, { id: 'wm' }));
console.log('wrote tokens.css and theme-preview.html', { net: formatPaise(net), margin });
