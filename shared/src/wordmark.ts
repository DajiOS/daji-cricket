// "Daji Cricket Ground" exactly as on the sign maker's drawing: the knot mark, the brush-script "Daji" whose j drops
// between CRICKET and GROUND, bold capitals, and a half white, half red cricket ball in place of the O.
// The outlines are traced from the drawing (see brand/trace) and live in wordmarkData.ts. Never re-typeset this in a font.
import { WORDMARK_DATA as D } from './wordmarkData.ts';
import { BALL_COLORS, BALL_PROOF_COLORS, ballDefs, ballInner, type BallColors } from './ball.ts';

// Every variant is flat: plain fills and gradients, no glow, no filters, so the lettering sits straight on the page
// background and renders the same everywhere, including react-native-svg in the Expo app.
export type WordmarkVariant =
  /** Copper lettering, the sign's bronze made light enough to read on the dark site. The default. */
  | 'copper'
  /** Flat champagne gold. */
  | 'gold'
  /** Near-black. Light backgrounds and print. */
  | 'ink'
  /** The sign maker's proof: everything in one orange. */
  | 'proof';

interface Look { stops: [string, string] | null; flat: string; ball: BallColors }
const LOOKS: Record<WordmarkVariant, Look> = {
  copper: { stops: ['#e2ae8a', '#c27d4f'], flat: '#d19468', ball: BALL_COLORS },
  gold: { stops: ['#efdeb4', '#b5955a'], flat: '#cfb078', ball: BALL_COLORS },
  ink: { stops: null, flat: '#1b1812', ball: BALL_COLORS },
  proof: { stops: null, flat: '#f6853f', ball: BALL_PROOF_COLORS },
};

const [BX, BY, BW, BH] = D.box;
/** Width / height of the lettering with no margin. */
export const WORDMARK_ASPECT = BW / BH;

export interface WordmarkOptions {
  /** Keeps gradient and filter ids unique when several wordmarks share a page. */
  id?: string;
  /** Extra attributes on the <svg>, e.g. `class="logo" height="56"`. */
  attrs?: string;
  /** Space around the lettering, in drawing pixels. A little by default; the lettering fills the picture. */
  margin?: number;
}

/** The traced outlines, as paths. The Expo app draws these with react-native-svg. */
export const WORDMARK_PARTS = D;

/** The same ball as the drawing: its size and place, for hand-drawing it somewhere else. */
export const WORDMARK_BALL = { cx: D.ball.cx, cy: D.ball.cy, r: D.ball.r + 0.8 };

export function wordmarkSvg(variant: WordmarkVariant = 'copper', opts: WordmarkOptions = {}): string {
  const look = LOOKS[variant];
  const id = opts.id ?? 'wm';
  const m = opts.margin ?? 4;
  const vb = `${r(BX - m)} ${r(BY - m)} ${r(BW + 2 * m)} ${r(BH + 2 * m)}`;
  const ball = WORDMARK_BALL;
  const letters = [...D.mark, ...D.script, ...D.dots, ...D.caps].map((d) => `<path d="${d}"/>`).join('');
  // The ball is 188 units wide in its own box (r 94 + outline); scale it to the drawing's ball.
  const k = (2 * ball.r) / 191;
  const place = `translate(${r(ball.cx - 100 * k)} ${r(ball.cy - 100 * k)}) scale(${r(k * 1000) / 1000})`;
  const solid = `<circle cx="${ball.cx}" cy="${ball.cy}" r="${r(ball.r)}"/>`;
  const faceFill = look.stops ? `url(#${id}-face)` : look.flat;

  const defs: string[] = [];
  if (look.stops) defs.push(`<linearGradient id="${id}-face" gradientUnits="userSpaceOnUse" x1="0" y1="${r(BY)}" x2="0" y2="${r(BY + BH)}"><stop offset="0" stop-color="${look.stops[0]}"/><stop offset="1" stop-color="${look.stops[1]}"/></linearGradient>`);
  defs.push(ballDefs(`${id}-ball`));

  const body: string[] = [
    `<g fill="${faceFill}">${letters}${solid}</g>`,
    `<g transform="${place}">${ballInner(look.ball, `${id}-ball`)}</g>`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Daji Cricket Ground" ${opts.attrs ?? ''}><title>Daji Cricket Ground</title><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}
