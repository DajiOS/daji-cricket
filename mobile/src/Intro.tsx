import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

// The opening animation: a white screen, clay stumps and a clay ball moved by hand one frame at a time (12 a second, with a little
// wobble on every frame), and the name spelled out in kinetic type that pops, overshoots and settles. It plays once per launch.
let played = false;
const FRAME = 83, HIT = 1500, WORDS = 2100, END = 5200;
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const jit = (f: number, k: number, amp: number) => (hash(f * 7 + k) - 0.5) * 2 * amp;
const CLAY = ['#e2574c', '#f2b134', '#2f9e8f', '#4a7fd1', '#e2574c', '#f2b134', '#2f9e8f'];

/** A clay lump: a base colour, a darker underside, and a pale thumb-smudge highlight. */
function Lump({ x, y, w, h, r, color, dark, rot = 0, alpha = 1 }: { x: number; y: number; w: number; h: number; r: number; color: string; dark: string; rot?: number; alpha?: number }) {
  return (
    <View style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: alpha, transform: [{ rotate: `${rot}deg` }] }}>
      <View style={{ flex: 1, backgroundColor: color, borderRadius: r, borderBottomWidth: Math.max(3, w * 0.07), borderRightWidth: Math.max(2, w * 0.04), borderColor: dark, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: '14%', top: '8%', width: '30%', height: '22%', borderRadius: 99, backgroundColor: 'rgba(255,255,255,.38)' }} />
      </View>
    </View>
  );
}

export function Intro({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const [t, setT] = useState(0);
  const [on, setOn] = useState(!played);
  useEffect(() => {
    if (!on) return;
    played = true;
    const t0 = Date.now();
    const id = setInterval(() => { const n = Date.now() - t0; setT(Math.floor(n / FRAME) * FRAME); if (n > END) { clearInterval(id); setOn(false); onDone(); } }, FRAME);
    return () => clearInterval(id);
  }, [on, onDone]);
  if (!on) return null;

  const f = Math.floor(t / FRAME), u = Math.min(W, H) / 100, cx = W / 2, base = H * 0.5, sH = 26 * u, sW = 5 * u, gap = 9 * u, D = 14 * u;
  const out = clamp((t - (END - 500)) / 500);
  const stumps = [-1, 0, 1].map((i, k) => {
    const rise = ease((t - k * 120) / 600), fall = clamp((t - HIT - k * 60) / 900);
    return <Lump key={'s' + k} x={cx + i * gap - sW / 2 + jit(f, k, 0.8)} y={base - sH * rise + fall * 3 * u} w={sW} h={Math.max(1, sH * rise)} r={sW / 2.2} color="#f2d9a0" dark="#c79d4f" rot={fall * [-24, -8, 26][k]! * 1.6 + jit(f, k + 9, 1.1)} alpha={t < 80 ? 0 : 1 - ease(fall)} />;
  });
  const fly = ease((t - HIT) / 900);
  const bails = [-0.5, 0.5].map((i, k) => (
    <Lump key={'b' + k} x={cx + i * gap - gap * 0.4 + (k ? 20 : -22) * u * fly} y={base - sH - 3 * u - (k ? 22 : 16) * u * fly + 12 * u * fly * fly} w={gap * 0.8} h={2.4 * u} r={u} color="#2f9e8f" dark="#1b6b60" rot={(k ? 540 : -620) * fly + jit(f, k + 3, 1.5)} alpha={t < 700 ? 0 : 1 - fly} />
  ));
  const a = clamp((t - 500) / (HIT - 500)), bounce = clamp((t - HIT) / 1500);
  const squash = t > HIT && t < HIT + 300 ? 1 - Math.abs(Math.sin(((t - HIT) / 300) * Math.PI)) * 0.25 : 1;
  const bx = t < HIT ? cx + (1 - ease(a)) * W * 0.4 : cx + 20 * u * ease(bounce);
  const by = t < HIT ? base - sH * 0.8 - (1 - ease(a)) * 30 * u : base - sH * 0.8 + 18 * u * ease(bounce) - 18 * u * Math.sin(Math.PI * bounce);
  const ballA = t < 500 ? 0 : 1;
  const word = (text: string, from: number, size: number, top: number) => {
    const n = text.length, gapPx = size * 0.62, left = cx - (n * gapPx) / 2;
    return text.split('').map((ch, i) => {
      const s0 = (t - from - i * 120) / 520;
      if (s0 <= 0 || ch === ' ') return null;
      const p = clamp(s0), over = p < 0.55 ? ease(p / 0.55) * 1.25 : p < 0.8 ? 1.25 - ((p - 0.55) / 0.25) * 0.3 : 0.95 + ((p - 0.8) / 0.2) * 0.05;
      const lift = p < 0.55 ? (1 - ease(p / 0.55)) * -size * 1.6 : 0;
      const wob = p >= 1 ? jit(f, i + 40, 0.9) : 0;
      return (
        <Text key={text + i} style={{ position: 'absolute', left: left + i * gapPx, top: top + lift, width: gapPx * 1.1, textAlign: 'center', fontSize: size, fontWeight: '900', color: CLAY[i % CLAY.length], opacity: p < 0.12 ? 0 : 1, transform: [{ scale: over }, { rotate: `${(1 - p) * (i % 2 ? 22 : -22) + wob * 2}deg` }], textShadowColor: 'rgba(60,30,10,.35)', textShadowOffset: { width: 2, height: 4 }, textShadowRadius: 0 }}>{ch}</Text>
      );
    });
  };
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#ffffff', opacity: 1 - out, zIndex: 100 }} pointerEvents={out > 0.98 ? 'none' : 'auto'}>
      <View style={{ position: 'absolute', left: cx - 24 * u, top: base - 1 * u, width: 48 * u, height: 4 * u, borderRadius: 99, backgroundColor: 'rgba(15,61,46,.12)' }} />
      {stumps}{bails}
      <Lump x={bx - D / 2 + jit(f, 1, 0.6)} y={by - (D * squash) / 2 + (D * (1 - squash)) / 2} w={D * (2 - squash)} h={D * squash} r={D} color="#e2574c" dark="#9c2820" rot={t * 0.35} alpha={ballA * (t > HIT + 1600 ? 0 : 1)} />
      {t >= WORDS - 200 && word('DAJI', WORDS, 14 * u, H * 0.2)}
      {t >= WORDS + 300 && word('CRICKET GROUND', WORDS + 700, 6.4 * u, H * 0.68)}
      <Pressable onPress={() => { setOn(false); onDone(); }} accessibilityRole="button" style={{ position: 'absolute', right: 16, bottom: 36, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(15,61,46,.45)', backgroundColor: 'rgba(255,255,255,.9)' }}>
        <Text style={{ color: '#0f3d2e', fontWeight: '700', letterSpacing: 1.2, fontSize: 12 }}>SKIP</Text>
      </Pressable>
    </View>
  );
}
