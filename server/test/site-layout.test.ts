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
