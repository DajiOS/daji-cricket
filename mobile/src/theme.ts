export type Mode = 'dark' | 'light';
// The Daji look, matched to the desk: a near-black (dark) or warm off-white (light) page, plain cards, and one gold accent. No green
// behind anything: green is only the "ok" colour. gold is the accent for icons and links (the name is kept so every screen keeps
// working), strong / onStrong are the main button, soft is a quiet fill. head / headMuted / onBg are for words drawn straight on the page.
const DARK = { bg: '#080A09', panel: '#141817', soft: '#1D2220', line: '#252B28', text: '#F2EFE8', muted: '#9BA19D', gold: '#D9C08A', goldDark: '#B89A5C', danger: '#F07A6E', ok: '#5CC98A', warn: '#F2B544', strong: '#D9C08A', onStrong: '#17140C', head: '#FFFFFF', headMuted: '#8F9692', onBg: '#D9C08A', bar: '#171B1A', ink: '#121514' };
const LIGHT = { bg: '#F3F2EE', panel: '#FFFFFF', soft: '#EFEDE7', line: '#E5E2DA', text: '#17191A', muted: '#6B716E', gold: '#8A6C22', goldDark: '#6E561B', danger: '#C93A32', ok: '#1E8A4C', warn: '#A86400', strong: '#17191A', onStrong: '#FFFFFF', head: '#111312', headMuted: '#757B78', onBg: '#8A6C22', bar: '#FFFFFF', ink: '#141716' };
/** Bright colours for icon tiles, so a grid of actions is easy to tell apart. They read on both the dark and the light page. */
export const HUES = ['#D9A94A', '#4C9BF5', '#9B7BF7', '#2BB5A0', '#F0796E', '#E26BB0', '#5CC98A', '#F2B544'];
/** The colours in use. The object is changed in place when the theme changes, and the app is drawn again, so every screen reads the new values. */
export const C: typeof DARK = { ...LIGHT };
export let mode: Mode = 'light';
export function setMode(m: Mode): void { mode = m; Object.assign(C, m === 'light' ? LIGHT : DARK); }
/** A colour see-through, for tinted fills: tint('#1C7A3E', 0.12). */
export const tint = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
/** Every phone number is shown with its country code: Indian numbers (stored as 10 digits) get +91, others keep their own +code. Same as shared/src/money.ts. */
export function formatPhone(phone?: string | null): string {
  const p = (phone ?? '').trim();
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const m = /^(?:91|0)?(\d{5})(\d{5})$/.exec(d);
  if (m && (!p.startsWith('+') || d.startsWith('91'))) return `+91 ${m[1]} ${m[2]}`;
  return p; // already has its own +code, or is not a phone number we can read
}
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
