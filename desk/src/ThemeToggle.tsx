import { useState } from 'react';

const KEY = 'daji.desk.theme';
const read = (): 'light' | 'dark' => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

/** Sun and moon icon at the far right of the top bar. The choice is remembered on this device. */
export function ThemeToggle() {
  const [mode, setMode] = useState<'light' | 'dark'>(read());
  const flip = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, next); } catch { /* private window: the choice lasts until the page closes */ }
    setMode(next);
  };
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} title="Light / dark">
      <svg className="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" /></svg>
      <svg className="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9" /></svg>
    </button>
  );
}
