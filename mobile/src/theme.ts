export type Mode = 'dark' | 'light';
const DARK = { bg: '#0a0c0b', panel: '#141815', line: '#2a302b', text: '#f3eee3', muted: '#9a9a8f', gold: '#c9a96b', goldDark: '#a88a4f', danger: '#e07a6e', ok: '#8fd3a3' };
const LIGHT = { bg: '#f6f4ee', panel: '#ffffff', line: '#ddd7c5', text: '#1f1b12', muted: '#5d5646', gold: '#8c6f2a', goldDark: '#6a5014', danger: '#b3261e', ok: '#2b7a48' };
/** The colours in use. The object is changed in place when the theme changes, and the app is drawn again, so every screen reads the new values. */
export const C: typeof DARK = { ...DARK };
export let mode: Mode = 'dark';
export function setMode(m: Mode): void { mode = m; Object.assign(C, m === 'light' ? LIGHT : DARK); }
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
