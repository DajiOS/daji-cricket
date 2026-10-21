import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The price list once shrank to a 250 px column in every designer look, because those card layouts align their children to the start.
// One shared rule at the end of site.css now makes it (and the price row) fill the card in every look. These checks keep that rule
// last, so a new pack or festival look cannot narrow the list again. tools/layout/check.mjs checks the drawn page in a browser.
const css = readFileSync(join(import.meta.dirname, '../../web/public/site.css'), 'utf8');
const guard = css.lastIndexOf('#view-home .card .body > :is(.ratecard,.price){align-self:stretch!important;justify-self:stretch!important;width:auto!important;max-width:none!important');

test('the price list and price row fill their card in every look', () => {
  assert.ok(guard > 0, 'the shared full-width rule is in site.css');
  assert.match(css, /#view-home \.card\.wide \.body > :is\(\.ratecard,\.price\)\{grid-column:1\/-1!important\}/);
  assert.match(css, /#view-home \.ratecard \.rc-cols\{display:grid!important;grid-template-columns:repeat\(auto-fit,minmax\(min\(240px,100%\),1fr\)\)!important\}/);
});

test('no look sets the price list width, or its columns, after the shared rule', () => {
  const ours = [/^#view-home \.card \.body > :is\(\.ratecard,\.price\)\{/, /^#view-home \.card\.wide \.body > (h4|:is\(\.ratecard,\.price\))\{/, /^#view-home \.ratecard \.rc-cols\{/];
  const later = css.slice(guard).split('}').map((r) => r.replace(/^[\s}]*(\/\*[\s\S]*?\*\/\s*)*(@media[^{]*\{)?\s*/, '').trim())
    .filter((r) => /\.ratecard|\.rc-cols|\.price\b/.test(r) && /[{;]\s*(width|max-width|align-self|justify-self|grid-template-columns|grid-column|display)\s*:/.test(r) && !ours.some((o) => o.test(r)));
  assert.deepEqual(later, [], 'a look narrows the price list after the shared rule');
});

test('the academy wordmark scales with its box, so a wide display face is never cut off', () => {
  assert.match(css, /\.mp\{container-type:inline-size\}/);
  assert.match(css, /\.mp b\{font-size:min\([^}]*cqi\)!important\}/);
});

test('every design in every pack is complete: listed, drawn, both halves coloured, faces and a background film', async () => {
  const { PACKS } = await import('../src/packs.ts');
  const app = readFileSync(join(import.meta.dirname, '../../web/public/app.js'), 'utf8');
  const loops = join(import.meta.dirname, '../../web/public/assets/loops');
  for (const d of PACKS.flatMap((p) => p.bands.flatMap((b) => b.designs))) {
    assert.match(app, new RegExp(`\\['${d}', '`), `${d} in THEMES`);
    assert.match(app, new RegExp(`\\n  ${d}: \\{ layout: '`), `${d} in DESIGNS`);
    assert.match(app, new RegExp(`[ ,]${d}: '[A-Z]`), `${d} in THEME_FONTS`);
    assert.ok(css.includes(`:root[data-theme="${d}"]{`), `${d} colours`);
    assert.ok(css.includes(`:root[data-theme="${d}"][data-mode=`) || ['noir', 'pavilion', 'whites', 'pinkball', 'monsoon', 'maroon', 'carbon', 'champagne', 'stadium', 'willow'].includes(d), `${d} other half`);
    for (const ext of ['mp4', 'webm']) assert.ok(readFileSync(join(loops, `${d}.${ext}`)).length > 10_000, `${d}.${ext} film`);
  }
});

test('on festival days the background film stays behind the page instead of joining it and covering the hero', () => {
  assert.ok(css.includes('html[data-fest] #view-home header.hero > :not(.fest-layer,.hero-loopbox){position:relative;z-index:1}'));
  assert.ok(!css.includes('header.hero > :not(.fest-layer){'), 'the old rule pulled the film into the page');
});
