// The "O" in GROUND: a cricket ball, half white and half red, as on the sign maker's drawing. A straight seam runs down
// the middle where the two halves meet, with three rows of stitching on the red side. One geometry, used by the
// website (inline SVG), the exported brand files and the Expo app (react-native-svg reads the same numbers).

export interface BallColors {
  white: string;
  red: string;
  redDark: string;
  thread: string;
  outline: string;
  gloss: string;
}

/** Default: a white ball and a red ball. */
export const BALL_COLORS: BallColors = {
  white: '#f7f1e3',
  red: '#b3261e',
  redDark: '#7f1912',
  thread: '#fbe9d6',
  outline: '#2b1a12',
  gloss: '#d9cdb2',
};

/** The colours on the sign maker's proof, where everything is printed in orange. */
export const BALL_PROOF_COLORS: BallColors = {
  white: '#fcae49',
  red: '#db3012',
  redDark: '#a82208',
  thread: '#ffd9c2',
  outline: '#6b3a20',
  gloss: '#ee9433',
};

export interface BallParts {
  viewBox: string;
  cx: number;
  cy: number;
  r: number;
  whitePath: string;
  redPath: string;
  /** The darker strip of seam right of the split. */
  seamPath: string;
  /** Three rows of stitches (one path each). */
  stitchRows: string[];
  /** A short curved highlight on the white half. */
  glossPath: string;
}

const CX = 100;
const CY = 100;
const R = 94;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function ballParts(): BallParts {
  const top = CY - R;
  const bottom = CY + R;
  const whitePath = `M${CX} ${top}A${R} ${R} 0 0 0 ${CX} ${bottom}Z`;
  const redPath = `M${CX} ${top}A${R} ${R} 0 0 1 ${CX} ${bottom}Z`;
  const band = 4.6;
  const seamPath = `M${CX} ${top}L${CX + band} ${r2(CY - Math.sqrt(R * R - band * band))}L${CX + band} ${r2(CY + Math.sqrt(R * R - band * band))}L${CX} ${bottom}Z`;
  const rows = [8.5, 18, 27.5].map((dx) => {
    const half = Math.sqrt(R * R - dx * dx) - 9; // stay inside the rim
    let d = '';
    for (let y = CY - half; y <= CY + half - 3.4; y += 6.4) d += `M${CX + dx} ${r2(y)}v3.4`;
    return d;
  });
  const glossPath = 'M44 70C48 54 58 42 70 36';
  return { viewBox: '0 0 200 200', cx: CX, cy: CY, r: R, whitePath, redPath, seamPath, stitchRows: rows, glossPath };
}

/** The ball as an SVG string. */
export function ballSvg(colors: BallColors = BALL_COLORS, id = 'ball', attrs = ''): string {
  const b = ballParts();
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.viewBox}" ${attrs}>`,
    `<defs><radialGradient id="${id}-shade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.26"/></radialGradient></defs>`,
    ballInner(colors, id),
    `</svg>`,
  ].join('');
}

/** Just the shapes, for placing inside another SVG (the wordmark). Needs `<id>-shade` from ballDefs(). */
export function ballInner(colors: BallColors, id: string): string {
  const b = ballParts();
  return [
    `<path d="${b.whitePath}" fill="${colors.white}"/>`,
    `<path d="${b.redPath}" fill="${colors.red}"/>`,
    `<path d="${b.glossPath}" fill="none" stroke="${colors.gloss}" stroke-width="6" stroke-linecap="round" opacity="0.7"/>`,
    `<path d="${b.seamPath}" fill="${colors.redDark}"/>`,
    `<g fill="none" stroke="${colors.thread}" stroke-width="2.6" stroke-linecap="round">${b.stitchRows.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="url(#${id}-shade)"/>`,
    `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="none" stroke="${colors.outline}" stroke-width="3"/>`,
  ].join('');
}

export function ballDefs(id: string): string {
  return `<radialGradient id="${id}-shade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.26"/></radialGradient>`;
}
