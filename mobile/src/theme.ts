export type Mode = 'dark' | 'light';
// Cricket green, the same look as the website and the desk. gold is the accent (the name is kept so every screen keeps working), strong / onStrong are the main button, soft is a quiet fill.
const DARK = { bg: '#0A1310', panel: '#111C18', soft: '#16241F', line: '#23352D', text: '#E9F1EC', muted: '#A7B8AF', gold: '#5FD68A', goldDark: '#2EA45A', danger: '#F07A6E', ok: '#5FD68A', warn: '#F2B544', strong: '#1C7A3E', onStrong: '#FFFFFF' };
const LIGHT = { bg: '#F3F6F4', panel: '#FFFFFF', soft: '#EAF2EC', line: '#DCE5DF', text: '#14231B', muted: '#5B6A62', gold: '#1C7A3E', goldDark: '#14602F', danger: '#C93A32', ok: '#1C8A45', warn: '#B86E00', strong: '#1C7A3E', onStrong: '#FFFFFF' };
/** The colours in use. The object is changed in place when the theme changes, and the app is drawn again, so every screen reads the new values. */
export const C: typeof DARK = { ...LIGHT };
export let mode: Mode = 'light';
export function setMode(m: Mode): void { mode = m; Object.assign(C, m === 'light' ? LIGHT : DARK); }
/** A colour see-through, for tinted fills: tint('#1C7A3E', 0.12). */
export const tint = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
