import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DESIGN, contrast, cssVariables, ballParts, ballSvg, wordmarkSvg, WORDMARK_PARTS, WORDMARK_ASPECT, BALL_COLORS, BALL_PROOF_COLORS, type WordmarkVariant, type ThemeName } from '@daji/shared';

// The luxury look is only worth having if it stays readable. These are WCAG AA floors for text (4.5:1).
const AA = 4.5;

for (const name of Object.keys(THEMES) as ThemeName[]) {
  const t = THEMES[name];
  const grounds = ['bg', 'bgRaised', 'surface', 'surfaceHigh'] as const;

  test(`${name}: body, muted and faint text are readable on every surface`, () => {
    for (const g of grounds) {
      for (const fg of ['text', 'textMuted', 'textFaint'] as const) {
        assert.ok(contrast(t[fg], t[g]) >= AA, `${fg} on ${g} is ${contrast(t[fg], t[g]).toFixed(2)}`);
      }
    }
  });

  test(`${name}: gold text and status colours are readable on surfaces`, () => {
    for (const g of grounds) {
      for (const fg of ['gold', 'ok', 'warn', 'danger', 'info'] as const) {
        assert.ok(contrast(t[fg], t[g]) >= AA, `${fg} on ${g} is ${contrast(t[fg], t[g]).toFixed(2)}`);
      }
    }
  });

  test(`${name}: button text is readable across the whole gold gradient`, () => {
    const stops = [...DESIGN.gradient.gold.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
    assert.ok(stops.length >= 3);
    for (const s of stops) assert.ok(contrast(t.onGold, s) >= AA, `onGold on ${s} is ${contrast(t.onGold, s).toFixed(2)}`);
  });
}

test('css variables are generated from the tokens, one place only', () => {
  const css = cssVariables('obsidian');
  assert.match(css, /--bg: #0a0c0b;/);
  assert.match(css, /--text-muted: /);
  assert.match(css, /--gradient-gold: linear-gradient/);
  assert.match(cssVariables('ivory', '[data-theme="ivory"]'), /^\[data-theme="ivory"\] \{/);
});

// ------------------------------------------------------------------ the O in GROUND: a half white, half red cricket ball

test('the ball is white on the left and red on the right with three rows of stitching on the red side', () => {
  const b = ballParts();
  assert.equal(b.stitchRows.length, 3);
  for (const row of b.stitchRows) {
    const xs = [...row.matchAll(/M([\d.]+) /g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 20, 'a row has many stitches');
    assert.ok(xs.every((x) => x > b.cx && x < b.cx + b.r), 'stitches are on the red (right) side, inside the ball');
    const ys = [...row.matchAll(/M[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    for (const y of ys) assert.ok(Math.hypot(xs[0]! - b.cx, y - b.cy) < b.r, 'every stitch is inside the rim');
  }
  const svg = ballSvg(BALL_COLORS, 't1');
  assert.ok(b.whitePath.includes('0 0 0') && b.redPath.includes('0 0 1'), 'white is the left half, red the right');
  assert.ok(svg.includes(BALL_COLORS.red) && svg.includes(BALL_COLORS.white));
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
});

test('the wordmark is the traced sign: mark, Daji with its dots, CRICKET GROUND, and a ball in place of the O', () => {
  assert.equal(WORDMARK_PARTS.mark.length, 2);
  assert.equal(WORDMARK_PARTS.script.length, 2);
  assert.equal(WORDMARK_PARTS.dots.length, 2);
  assert.equal(WORDMARK_PARTS.caps.length, 12, 'C R I C K E T G R U N D: eleven letters of CRICKET GROUND without the O, plus the second R');
  // the ball sits between the R and the U of GROUND, bigger than the capitals as on the drawing
  const [bx, by, bw, bh] = WORDMARK_PARTS.box;
  assert.ok(WORDMARK_PARTS.ball.cx > bx + bw * 0.75 && WORDMARK_PARTS.ball.cx < bx + bw);
  assert.ok(WORDMARK_PARTS.ball.cy > by + bh * 0.6);
  assert.ok(Math.abs(bw / bh - WORDMARK_ASPECT) < 1e-9);
  for (const v of ['copper', 'gold', 'ink', 'proof'] as WordmarkVariant[]) {
    const svg = wordmarkSvg(v, { id: `t-${v}` });
    assert.match(svg, /^<svg [^>]*viewBox="[-\d. ]+"/);
    assert.ok(svg.includes('aria-label="Daji Cricket Ground"') && svg.includes('<title>Daji Cricket Ground</title>'));
    assert.ok((svg.match(/id="t-[a-z]+-/g) ?? []).length >= 1, "ids are prefixed so two wordmarks never clash");
    assert.ok(svg.includes(`${v === 'proof' ? BALL_PROOF_COLORS.red : BALL_COLORS.red}`), 'the ball keeps its own colours in every colourway');
    assert.ok(!/NaN|undefined/.test(svg), 'no broken numbers');
    // flat: it sits straight on the page, with no glow, shadow or filter of any kind (so it also draws in react-native-svg)
    assert.ok(!/<filter|feGaussianBlur|feMorphology|filter=|drop-shadow/.test(svg), `${v} must have no glow`);
  }
  assert.ok(wordmarkSvg().includes('id="wm-face"'), 'copper, with its gradient, is the default');
  assert.throws(() => wordmarkSvg('sign' as WordmarkVariant), 'the glowing sign variant is gone');
  // two wordmarks on one page must not share ids
  const both = wordmarkSvg('copper', { id: 'a' }) + wordmarkSvg('copper', { id: 'b' });
  const ids = [...both.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length);
});

test('the lettering around the wordmark follows the sign: a brush script, bold condensed capitals, a quiet sans', () => {
  assert.match(DESIGN.fonts.script, /cursive$/);
  assert.match(DESIGN.fonts.display, /Condensed/);
  assert.match(DESIGN.googleFonts, /Barlow\+Semi\+Condensed/);
  assert.match(DESIGN.googleFonts, /Kaushan\+Script/);
  assert.match(cssVariables('obsidian'), /--font-script:/);
});
