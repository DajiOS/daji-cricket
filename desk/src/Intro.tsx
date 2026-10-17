import { useEffect, useRef, useState } from 'react';

declare global { interface Window { DajiSplashGL?: { start: (scene: HTMLElement, w: number, h: number, parts: () => Part[]) => { dispose: () => void } | null } } }
type Part = { kind: 'stump'; alpha: number; x: number; y: number; w: number; h: number; rot: number } | { kind: 'bail'; alpha: number; x: number; y: number; w: number; t: number; rot: number } | { kind: 'ball'; alpha: number; x: number; y: number; r: number; rot: number };
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const CLAY = ['#e2574c', '#f2b134', '#2f9e8f', '#4a7fd1'];
const clamp = (t: number) => Math.min(1, Math.max(0, t));

/** The opening animation, once per visit: stumps rise, a ball takes the bails off, and the name appears. White screen, real-time 3D. */
export function Intro() {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem('daji.desk.intro') !== '1' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !!window.DajiSplashGL; } catch { return false; } });
  const [name, setName] = useState(false), [out, setOut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on || !box.current) return;
    const w = innerWidth, h = innerHeight, u = Math.min(w, h * 1.2) / 100, cx = w / 2, cy = h / 2 - 4 * u, base = cy + 14 * u, sH = 30 * u, sW = 2.6 * u, gap = 4.8 * u, D = 7 * u;
    const t0 = performance.now(), HIT = 1400, END = 3600;
    const parts = (): Part[] => {
      const t = performance.now() - t0, after = clamp((t - HIT) / 900), out: Part[] = [];
      [-1, 0, 1].forEach((i, k) => {
        const rise = ease((t - k * 110) / 620), fall = clamp((t - HIT - k * 40) / 900);
        out.push({ kind: 'stump', alpha: t < HIT ? Math.min(1, rise * 5) : 1 - ease(fall), x: cx + i * gap, y: base + fall * 2 * u, w: sW, h: sH * (t < HIT ? rise : 1), rot: (fall * [-24, -8, 26][k]! * 1.6 * Math.PI) / 180 });
      });
      [-0.5, 0.5].forEach((i, k) => {
        const fly = ease(after);
        out.push({ kind: 'bail', alpha: t < 600 ? 0 : 1 - fly, x: cx + i * gap + (k ? 20 : -22) * u * fly, y: base - sH - 0.6 * u - (k ? 22 : 16) * u * fly + 12 * u * fly * fly, w: gap * 0.88, t: 1.2 * u, rot: (k ? 540 : -620) * fly * Math.PI / 180 });
      });
      const f = clamp((t - 500) / (HIT - 500)), tx = cx + (1 - ease(f)) * w * 0.34, ty = cy - 8 * u + (base - sH * 0.78 - cy + 8 * u) * ease(f) - (1 - f) * 12 * u;
      const bounce = clamp((t - HIT) / 1500);
      out.push({ kind: 'ball', alpha: t < 500 ? 0 : t > END - 400 ? 1 - clamp((t - (END - 400)) / 400) : 1, x: t < HIT ? tx : cx + 14 * u * ease(bounce), y: t < HIT ? ty : base - sH * 0.78 + (base - sH * 0.78 - base + D) * 0 + 8 * u * ease(bounce) - 10 * u * Math.sin(Math.PI * bounce), r: (D / 2) * (1 + (1 - f) * 0.8), rot: t * 0.006 });
      return out;
    };
    const gl = window.DajiSplashGL!.start(box.current, w, h, parts);
    if (!gl) { setOn(false); return; }
    const a = setTimeout(() => setName(true), 1900), b = setTimeout(() => finish(), END + 1900);
    function finish() { try { sessionStorage.setItem('daji.desk.intro', '1'); } catch { /* ignore */ } setOut(true); setTimeout(() => { gl!.dispose(); setOn(false); }, 650); }
    (box.current as HTMLElement & { finish?: () => void }).finish = finish;
    return () => { clearTimeout(a); clearTimeout(b); gl.dispose(); };
  }, [on]);
  if (!on) return null;
  return (
    <div id="intro" className={out ? 'out' : ''} ref={box} aria-hidden="true">
      {name && <div className="intro-name" aria-hidden="true">{'Daji Cricket Ground'.split('').map((ch, i) => <span key={i} className="kin" style={{ animationDelay: `${i * 70}ms`, ['--tilt' as string]: `${i % 2 ? 14 : -14}deg`, color: CLAY[i % CLAY.length] }}>{ch === ' ' ? '\u00a0' : ch}</span>)}</div>}
      <button className="intro-skip" onClick={() => (box.current as HTMLElement & { finish?: () => void }).finish?.()}>Skip</button>
    </div>
  );
}
