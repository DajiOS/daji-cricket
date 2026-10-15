export const C = { bg: '#0a0c0b', panel: '#141815', line: '#2a302b', text: '#f3eee3', muted: '#9a9a8f', gold: '#c9a96b', goldDark: '#a88a4f', danger: '#e07a6e', ok: '#8fd3a3' };
export const inr = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => { const [, m, day] = d.split('-').map(Number); return `${day} ${MON[(m ?? 1) - 1]}`; };
