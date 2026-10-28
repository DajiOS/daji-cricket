// Brand and theme tokens. One source of truth for the website, the Expo app and printed/exported reports.
//
// Theme: "Obsidian & Champagne" — a near-black, faintly green canvas, champagne-gold hairlines and accents,
// warm ivory type. The lettering follows the copper sign at the ground: a flowing brush script for "Daji"
// (and for accent words), bold condensed capitals for "CRICKET GROUND" (and for headings), and a quiet sans for
// everything you read or add up. The bronze comes from the same sign; the O in GROUND is the half red, half white
// cricket ball (ball.ts).
export const BRAND = {
  name: 'Daji Cricket Ground',
  short: 'Daji',
  domain: 'dajicricket.com',
  /** Printed under the name on the website, the app and messages. */
  tagline: 'Project by Daji Parivar',
} as const;

export interface ThemeColors {
  bg: string;
  bgRaised: string;
  surface: string;
  surfaceHigh: string;
  surfaceTop: string;
  line: string;
  lineStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  gold: string;
  goldBright: string;
  goldDeep: string;
  onGold: string;
  bronze: string;
  emerald: string;
  emeraldBright: string;
  ok: string;
  warn: string;
  danger: string;
  info: string;
  glow: string;
  scrim: string;
}

export const THEMES = {
  /** Default. The site and app open in this. */
  obsidian: {
    bg: '#0a0c0b',
    bgRaised: '#0f1211',
    surface: '#141816',
    surfaceHigh: '#1a1f1c',
    surfaceTop: '#222824',
    line: 'rgba(216,190,132,0.16)',
    lineStrong: 'rgba(216,190,132,0.38)',
    text: '#f3eee3',
    textMuted: '#b9b3a4',
    textFaint: '#8d8979',
    gold: '#c9a96b',
    goldBright: '#e6d09f',
    goldDeep: '#9a7d44',
    onGold: '#17130a',
    bronze: '#b8805c',
    emerald: '#123b2d',
    emeraldBright: '#2c7a5b',
    ok: '#6dbb96',
    warn: '#e0b45c',
    danger: '#df7d6e',
    info: '#8eadd0',
    glow: 'rgba(230,208,159,0.22)',
    scrim: 'rgba(5,6,5,0.72)',
  },
  /** For printed P&L, PDFs and anyone who prefers light. Same hierarchy, inverted. */
  ivory: {
    bg: '#f6f2e9',
    bgRaised: '#fbf8f1',
    surface: '#fffdf8',
    surfaceHigh: '#f1ebdd',
    surfaceTop: '#e8e0cd',
    line: 'rgba(70,54,20,0.14)',
    lineStrong: 'rgba(70,54,20,0.34)',
    text: '#1b1812',
    textMuted: '#5a5446',
    textFaint: '#6c6555',
    gold: '#80622a',
    goldBright: '#b8934a',
    goldDeep: '#5f4818',
    onGold: '#17130a',
    bronze: '#8e5a3a',
    emerald: '#0f3d2e',
    emeraldBright: '#1d6a4d',
    ok: '#1a6e48',
    warn: '#8a6010',
    danger: '#b23c2e',
    info: '#2f5f93',
    glow: 'rgba(184,147,74,0.18)',
    scrim: 'rgba(246,242,233,0.78)',
  },
} as const satisfies Record<string, ThemeColors>;

export type ThemeName = keyof typeof THEMES;

export const DESIGN = {
  fonts: {
    /** The "Daji" lettering: a brush script. Used for the wordmark and for accent words inside headings; never for body text. */
    script: "'Kaushan Script', 'Yellowtail', 'Segoe Script', 'Brush Script MT', cursive",
    /** The "CRICKET GROUND" lettering: bold, semi-condensed capitals. Headings, ground names, big figures. */
    display: "'Barlow Semi Condensed', 'Roboto Condensed', 'Arial Narrow', 'DejaVu Sans Condensed', system-ui, sans-serif",
    /** Everything you read, fill in or add up. Use tabular figures for money. */
    body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  /** Google Fonts request for the web build (the Expo app bundles the same files). */
  googleFonts: 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Inter:wght@300;400;500;600&family=Kaushan+Script&display=swap',
  radius: { sm: 2, md: 6, lg: 12, pill: 999 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 72, 9: 112 },
  /** Eyebrow labels: small, upper-case, wide-tracked, in gold. */
  eyebrow: { size: 11, tracking: '0.24em' },
  motion: { ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fast: 160, base: 260, slow: 480 },
  shadow: {
    card: '0 28px 60px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)',
    lift: '0 40px 80px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(216,190,132,0.22)',
  },
  gradient: {
    gold: 'linear-gradient(135deg, #ecd9ad 0%, #c9a96b 46%, #a3844a 100%)',
    goldHover: 'linear-gradient(135deg, #f3e3bd 0%, #d6b87b 46%, #b2915a 100%)',
    canvas: 'radial-gradient(1200px 600px at 78% -10%, rgba(44,122,91,0.16), transparent 60%), radial-gradient(900px 500px at 0% 0%, rgba(184,128,92,0.10), transparent 55%)',
  },
} as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** `:root { --bg: …; }` for a theme, plus the design tokens. The web build writes this into the page. */
export function cssVariables(theme: ThemeName = 'obsidian', selector = ':root'): string {
  const c = THEMES[theme];
  const lines = Object.entries(c).map(([k, v]) => `  --${kebab(k)}: ${v};`);
  lines.push(`  --font-script: ${DESIGN.fonts.script};`, `  --font-display: ${DESIGN.fonts.display};`, `  --font-body: ${DESIGN.fonts.body};`);
  for (const [k, v] of Object.entries(DESIGN.radius)) lines.push(`  --radius-${k}: ${v}px;`);
  lines.push(`  --ease: ${DESIGN.motion.ease};`, `  --shadow-card: ${DESIGN.shadow.card};`, `  --shadow-lift: ${DESIGN.shadow.lift};`);
  lines.push(`  --gradient-gold: ${DESIGN.gradient.gold};`, `  --gradient-gold-hover: ${DESIGN.gradient.goldHover};`, `  --gradient-canvas: ${DESIGN.gradient.canvas};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/** WCAG contrast ratio between two #rrggbb colours (used by the theme test). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
