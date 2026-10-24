export type Mode = 'dark' | 'light';
// The starter kit's Forest palette, the same one the desk opens with. strong / onStrong are the main button; soft is a quiet fill.
const DARK = { bg: '#0E1916', panel: '#16231F', soft: '#1E2D28', line: '#2C3C36', text: '#EDE6D8', muted: '#A9A293', gold: '#C9A66B', goldDark: '#A88A4F', danger: '#E07A6E', ok: '#8FD3A3', strong: '#C9A66B', onStrong: '#14241F' };
const LIGHT = { bg: '#F5F2EC', panel: '#FFFDF9', soft: '#F0EBE2', line: '#E6DFD3', text: '#14241F', muted: '#5F5A51', gold: '#7A5E33', goldDark: '#5E4824', danger: '#B3261E', ok: '#2B7A48', strong: '#14241F', onStrong: '#F5F2EC' };
/** The colours in use. The object is changed in place when the theme changes, and the app is drawn again, so every screen reads the new values. */
export const C: typeof DARK = { ...LIGHT };
export let mode: Mode = 'light';
export function setMode(m: Mode): void { mode = m; Object.assign(C, m === 'light' ? LIGHT : DARK); }
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
