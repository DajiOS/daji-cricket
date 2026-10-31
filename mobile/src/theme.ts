export type Mode = 'dark' | 'light';
// The Daji look: a soft grey page (light) or near-black page (dark), white or charcoal rounded cards, black (light) / white (dark)
// main buttons and one orange accent. No green behind anything: green is only the "ok" colour. gold is the accent for icons and links
// (the name is kept so every screen keeps working), strong / onStrong are the main button, soft is a quiet fill, ink is the dark
// highlight card. head / headMuted / onBg are for words drawn straight on the page.
const DARK = { bg: '#0E0F11', panel: '#1A1B1E', soft: '#24262A', line: '#2C2E33', text: '#F3F3F4', muted: '#9A9CA3', gold: '#F28C38', goldDark: '#D9711F', danger: '#F07A6E', ok: '#5CC98A', warn: '#F2B544', strong: '#F3F3F4', onStrong: '#111214', head: '#FFFFFF', headMuted: '#8D9097', onBg: '#F28C38', bar: '#1A1B1E', ink: '#000000' };
const LIGHT = { bg: '#E8E9EC', panel: '#FFFFFF', soft: '#F1F2F4', line: '#E6E7EA', text: '#17181B', muted: '#85888F', gold: '#E0742A', goldDark: '#C25E18', danger: '#D9483F', ok: '#22985A', warn: '#B87100', strong: '#17181B', onStrong: '#FFFFFF', head: '#17181B', headMuted: '#7D8087', onBg: '#E0742A', bar: '#FFFFFF', ink: '#17181B' };
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
