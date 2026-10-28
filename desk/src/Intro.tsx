import { useEffect, useRef, useState } from 'react';

declare global { interface Window { DajiIntro?: { play: (box: HTMLElement, o: { dark?: boolean; logo?: string; onDone?: () => void }) => { finish: () => void } } } }

/** The opening animation, once per visit. The sequence itself is in the website's intro.js, so the website and the desk play the same film. */
export function Intro() {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem('daji.desk.intro') !== '1' && sessionStorage.getItem('daji.splash') !== '1' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !!window.DajiIntro; } catch { return false; } });
  const box = useRef<HTMLDivElement>(null);
  // white-label: the opening film is the main website's (Daji Cricket Ground). Another business's desk never plays it.
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on) return;
    const t = (() => { try { return localStorage.getItem('daji.token'); } catch { return null; } })();
    if (!t) { setOk(true); return; }
    const api = ((window as any).DAJI_API || '').replace(/\/$/, '');
    fetch(api + '/api/desk/brand', { headers: { authorization: 'Bearer ' + t } })
      .then((r) => (r.ok ? r.json() : null)).then((b) => setOk(!b || b.mainSettings !== false)).catch(() => setOk(true));
  }, [on]);
  useEffect(() => {
    if (!on || !ok || !box.current) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    try { window.DajiIntro!.play(box.current, { dark, logo: dark ? 'assets/logo.svg' : 'assets/logo-brass.svg', onDone: () => { try { sessionStorage.setItem('daji.desk.intro', '1'); } catch { /* ignore */ } setOn(false); } }); } catch { setOn(false); }
  }, [on, ok]);
  if (!on || ok === false) return null;
  return <div id="intro" ref={box} aria-hidden="true" />;
}
