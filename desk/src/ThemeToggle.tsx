import { useState } from 'react';

const KEY = 'daji.desk.theme';
const read = (): 'light' | 'dark' => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

/** Sun and moon icon at the far right of the top bar. The choice is remembered on this device. */
export function ThemeToggle() {
  const [mode, setMode] = useState<'light' | 'dark'>(read());
  const flip = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, next); } catch { /* private window: the choice lasts until the page closes */ }
    setMode(next);
  };
  return (
    <button type="button" className="theme-toggle" data-mode={mode} role="switch" aria-checked={mode === 'dark'} onClick={flip} aria-label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} title={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
      <span className="tt-knob">
        <svg className="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3L7 7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" /></svg>
        <svg className="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>
      </span>
    </button>
  );
}
