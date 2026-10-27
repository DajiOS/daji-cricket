import { useEffect, useRef, useState } from 'react';

// Colour themes: the club look (forest green and champagne, the default), Cricket green and the starter kit's ten palettes, each in light and dark. The choice is remembered on this device
// and desk.html applies it before the first paint, so the page never flashes the wrong colours.
const MODE_KEY = 'daji.desk.theme';
const PAL_KEY = 'daji.desk.pal';

/** key, name, then the swatch colours: light background, light strong, dark background, dark surface, accent. */
export const PALETTES = [
  { key: 'club', name: 'Club: forest & champagne', l: '#F3F1EA', ls: '#0F2A1F', d: '#07110D', ds: '#12201A', acc: '#D9C08A' },
  { key: 'field', name: 'Cricket green', l: '#F3F6F4', ls: '#1C7A3E', d: '#0A1310', ds: '#111C18', acc: '#2EA45A' },
  { key: 'forest', name: 'Forest & brass', l: '#F5F2EC', ls: '#14241F', d: '#0E1916', ds: '#16231F', acc: '#C9A66B' },
  { key: 'onyx', name: 'Ivory & onyx', l: '#F7F6F3', ls: '#111111', d: '#0B0B0B', ds: '#151515', acc: '#D4B474' },
  { key: 'sand', name: 'Sandstone & terracotta', l: '#F6EFE6', ls: '#9A4A2A', d: '#17110D', ds: '#211914', acc: '#E08A62' },
  { key: 'navy', name: 'Navy & champagne', l: '#F4F3EF', ls: '#0F1C33', d: '#0A1222', ds: '#111B2F', acc: '#D8BE86' },
  { key: 'sage', name: 'Sage & linen', l: '#F3F4EE', ls: '#3E5A45', d: '#111712', ds: '#19211B', acc: '#A9C68E' },
  { key: 'plum', name: 'Plum & rose gold', l: '#F7F2F2', ls: '#3B1F36', d: '#140C13', ds: '#1E141C', acc: '#E3A08E' },
  { key: 'copper', name: 'Charcoal & copper', l: '#F4F3F1', ls: '#2A2B2E', d: '#111213', ds: '#1A1B1D', acc: '#DE925E' },
  { key: 'pearl', name: 'Teal & pearl', l: '#F1F5F4', ls: '#14484B', d: '#0A1617', ds: '#112022', acc: '#6FC4C2' },
  { key: 'burgundy', name: 'Burgundy & cream', l: '#F6F1EA', ls: '#5E1A23', d: '#150A0C', ds: '#1F1013', acc: '#E7909A' },
  { key: 'slate', name: 'Midnight & silver', l: '#F2F3F5', ls: '#1F2633', d: '#0C0E12', ds: '#14171D', acc: '#A9B8D6' },
] as const;
type Mode = 'light' | 'dark';

const root = document.documentElement;
const readMode = (): Mode => (root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
const readPal = (): string => { const p = root.getAttribute('data-pal'); return PALETTES.some((x) => x.key === p) ? p! : 'club'; };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: the choice lasts until the page closes */ } };

/** The colour dot at the far right of the top bar. It opens the colour theme menu: light or dark, then one of ten palettes. */
export function ThemeToggle() {
  const [mode, setModeState] = useState<Mode>(readMode());
  const [pal, setPalState] = useState(readPal());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', away); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open]);
  const setMode = (m: Mode) => { if (m === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme'); save(MODE_KEY, m); setModeState(m); };
  const setPal = (k: string) => { root.setAttribute('data-pal', k); save(PAL_KEY, k); setPalState(k); };
  const cur = PALETTES.find((p) => p.key === pal) ?? PALETTES[0];
  const dot = (p: (typeof PALETTES)[number]) => `linear-gradient(135deg, ${mode === 'dark' ? p.ds : p.ls} 50%, ${p.acc} 50%)`;
  return (
    <div className="theme-pick" ref={box}>
      <button type="button" className="theme-dot" aria-label="Colour theme" title="Colour theme" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={{ background: dot(cur) }} />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Colour theme">
          <div className="theme-menu-head">
            <span className="eyebrow" style={{ margin: 0 }}>Colour theme</span>
            <div className="theme-mode" role="group" aria-label="Light or dark">
              <button type="button" aria-pressed={mode === 'light'} aria-label="Light mode" title="Light mode" onClick={() => setMode('light')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              </button>
              <button type="button" aria-pressed={mode === 'dark'} aria-label="Dark mode" title="Dark mode" onClick={() => setMode('dark')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
              </button>
            </div>
          </div>
          {PALETTES.map((p) => (
            <button key={p.key} type="button" role="menuitemradio" aria-checked={p.key === pal} className="theme-row" onClick={() => setPal(p.key)}>
              <span className="theme-sw" aria-hidden="true"><i style={{ background: mode === 'dark' ? p.d : p.l }} /><i style={{ background: mode === 'dark' ? p.ds : p.ls }} /><i style={{ background: p.acc }} /></span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
