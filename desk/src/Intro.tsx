import { useEffect, useRef, useState } from 'react';

declare global { interface Window { DajiIntro?: { play: (box: HTMLElement, o: { dark?: boolean; logo?: string; onDone?: () => void }) => { finish: () => void } } } }

/** The opening animation, once per visit. The sequence itself is in the website's intro.js, so the website and the desk play the same film. */
export function Intro() {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem('daji.desk.intro') !== '1' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !!window.DajiIntro; } catch { return false; } });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on || !box.current) return;
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    try { window.DajiIntro!.play(box.current, { dark, logo: dark ? 'assets/logo.svg' : 'assets/logo-brass.svg', onDone: () => { try { sessionStorage.setItem('daji.desk.intro', '1'); } catch { /* ignore */ } setOn(false); } }); } catch { setOn(false); }
  }, [on]);
  if (!on) return null;
  return <div id="intro" ref={box} aria-hidden="true" />;
}
