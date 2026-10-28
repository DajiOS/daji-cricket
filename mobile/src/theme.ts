export type Mode = 'dark' | 'light';
// The Daji board look: deep forest green behind everything, cream cards, gold for the main button. gold is the accent inside cards (the name is kept so every
// screen keeps working), strong / onStrong are the main button, soft is a quiet fill. head / headMuted / onBg are for words drawn straight on the green.
const DARK = { bg: '#0A1D13', panel: '#12291C', soft: '#1A3525', line: '#24432F', text: '#EEF3EE', muted: '#A9BBAF', gold: '#E3C27A', goldDark: '#C9A24B', danger: '#F07A6E', ok: '#6FD495', warn: '#F2B544', strong: '#D4AF5A', onStrong: '#18200F', head: '#FFFFFF', headMuted: 'rgba(255,255,255,0.72)', onBg: '#E3C27A', bar: '#081A10' };
const LIGHT = { bg: '#0E2A1B', panel: '#FBF9F3', soft: '#EFEBDD', line: '#E5E0CF', text: '#15231A', muted: '#748379', gold: '#2E9A58', goldDark: '#1C6B3C', danger: '#C93A32', ok: '#1C8A45', warn: '#A86400', strong: '#D4AF5A', onStrong: '#18200F', head: '#FFFFFF', headMuted: 'rgba(255,255,255,0.72)', onBg: '#E3C27A', bar: '#081A10' };
/** The colours in use. The object is changed in place when the theme changes, and the app is drawn again, so every screen reads the new values. */
export const C: typeof DARK = { ...LIGHT };
export let mode: Mode = 'light';
export function setMode(m: Mode): void { mode = m; Object.assign(C, m === 'light' ? LIGHT : DARK); }
/** A colour see-through, for tinted fills: tint('#1C7A3E', 0.12). */
export const tint = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
