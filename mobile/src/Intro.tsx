import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { mode } from './theme';

// The opening film, matching the website: thin brass arcs, three short lines that rise into place with one word in brass,
// a phone showing the booking screen, then the name. Eased throughout and in the app's current theme. It plays once per launch.
let played = false;
const FRAME = 33, END = 10400;
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const inOut = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

type Phrase = { words: [string, boolean][]; at: number; out: number; top?: boolean };
const PHRASES: Phrase[] = [
  { words: [['Floodlit', true], ['ground.', false]], at: 300, out: 2100 },
  { words: [['Pick', false], ['your', false], ['time.', true]], at: 2800, out: 5500, top: true },
  { words: [['Held', true], ['in', false], ['your', false], ['name.', true]], at: 6300, out: 7700 },
];

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

  const dark = mode === 'dark';
  const bg = dark ? '#07090a' : '#fbfaf7', fg = dark ? '#f3eee3' : '#16130c', ac = dark ? '#d6b36a' : '#8c6f2a';
  const line = dark ? 'rgba(214,179,106,.28)' : 'rgba(140,111,42,.28)', chip = dark ? '#1a1d20' : '#efeadc', scr = dark ? '#0d0f11' : '#fffdf8';
  const u = Math.min(W, H) / 100;

  const arcIn = ease((t - 100) / 2600), arcOut = 1 - clamp((t - 8200) / 900);
  const arcs = [46, 62, 80, 100].map((r, i) => (
    <View key={'a' + i} style={{ position: 'absolute', left: W / 2 - r * u, top: H / 2 - r * u, width: r * 2 * u, height: r * 2 * u, borderRadius: r * u, borderWidth: 1, borderColor: line, opacity: arcIn * arcOut, transform: [{ scale: 0.85 + 0.15 * arcIn }] }} />
  ));

  const phrase = (p: Phrase, k: number) => {
    if (t < p.at || t > p.out + 700) return null;
    const size = Math.max(26, Math.min(W * 0.1, 40));
    return (
      <View key={'p' + k} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: p.top ? H * 0.1 : 0, bottom: p.top ? undefined : 0, alignItems: 'center', justifyContent: p.top ? 'flex-start' : 'center', paddingHorizontal: 5 * u }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          {p.words.map(([w, a], i) => {
            const inn = ease((t - p.at - i * 110) / 800), o = ease((t - p.out - i * 40) / 420), v = inn * (1 - o);
            return <Text key={i} style={{ fontSize: size, fontWeight: '600', letterSpacing: -0.6, color: a ? ac : fg, opacity: v, marginRight: size * 0.28, transform: [{ translateY: (1 - inn) * size * 0.5 - o * size * 0.3 }] }}>{w}</Text>;
          })}
        </View>
      </View>
    );
  };

  // the phone: rises in, holds, lifts away
  const pIn = ease((t - 2500) / 2400), pOut = ease((t - 5700) / 700);
  const pw = Math.min(W * 0.52, H * 0.3), ph = pw * 2.0;
  const slot = t > 4000, btn = t > 4500;
  const phone = t >= 2500 && t <= 6500 ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: W / 2 - pw / 2, top: H - ph - H * 0.07 + (1 - pIn) * H * 0.6 - pOut * H * 0.14, width: pw, height: ph, borderRadius: pw * 0.15, padding: 4, backgroundColor: dark ? '#23272b' : '#d9d3c3', opacity: pIn * (1 - pOut), shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12 }}>
      <View style={{ flex: 1, borderRadius: pw * 0.12, backgroundColor: scr, padding: pw * 0.07, paddingTop: pw * 0.2, gap: pw * 0.05, overflow: 'hidden' }}>
        <Text style={{ fontSize: pw * 0.05, letterSpacing: 1.4, color: ac, fontWeight: '700' }}>RESERVE</Text>
        <Text style={{ fontSize: pw * 0.1, fontWeight: '700', color: fg, lineHeight: pw * 0.115 }}>Pick a day{'\n'}and a time</Text>
        <View style={{ flexDirection: 'row', gap: pw * 0.03 }}>
          {['13', '14', '15'].map((d, i) => <View key={d} style={{ flex: 1, borderRadius: 8, paddingVertical: pw * 0.03, alignItems: 'center', backgroundColor: i === 1 ? ac : chip }}><Text style={{ fontWeight: '700', fontSize: pw * 0.075, color: i === 1 ? bg : fg }}>{d}</Text></View>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: pw * 0.03 }}>
          {['7 am', '8 am', '4 pm', '5 pm', '6 pm', '7 pm'].map((s, i) => { const sel = slot && i === 3; return <View key={s} style={{ width: '30%', borderRadius: 7, paddingVertical: pw * 0.035, alignItems: 'center', backgroundColor: sel ? ac : chip }}><Text style={{ fontSize: pw * 0.055, fontWeight: '600', color: sel ? bg : fg }}>{s}</Text></View>; })}
        </View>
        <View style={{ marginTop: 'auto', borderRadius: 9, paddingVertical: pw * 0.045, alignItems: 'center', backgroundColor: btn ? ac : chip }}><Text style={{ fontSize: pw * 0.056, fontWeight: '700', color: btn ? bg : fg }}>{btn ? 'Pay the advance' : 'Choose your slot'}</Text></View>
      </View>
    </View>
  ) : null;

  const lg = inOut((t - 8100) / 1400), logoOut = 1 - clamp((t - 9800) / 600);
  const logo = t >= 8100 ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: lg * logoOut, transform: [{ scale: 0.94 + 0.06 * lg }] }}>
      <Text style={{ fontFamily: 'serif', fontStyle: 'italic', fontSize: Math.min(W * 0.26, 110), color: ac }}>Daji</Text>
      <Text style={{ fontWeight: '800', letterSpacing: 2, fontSize: Math.min(W * 0.075, 30), color: ac }}>CRICKET GROUND</Text>
      <Text style={{ marginTop: 10, fontWeight: '700', letterSpacing: 3, fontSize: 10, color: dark ? '#9b9484' : '#7a7260' }}>PROJECT BY DAJI PARIVAR</Text>
    </View>
  ) : null;

  const out = clamp((t - (END - 500)) / 500);
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: bg, opacity: 1 - out, zIndex: 100 }} pointerEvents={out > 0.98 ? 'none' : 'auto'}>
      {arcs}
      {PHRASES.map(phrase)}
      {phone}
      {logo}
      <Pressable onPress={() => { setOn(false); onDone(); }} accessibilityRole="button" style={{ position: 'absolute', right: 16, bottom: 36, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 99, borderWidth: 1, borderColor: line, backgroundColor: dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.9)' }}>
        <Text style={{ color: fg, fontWeight: '700', letterSpacing: 1.2, fontSize: 12 }}>SKIP</Text>
      </Pressable>
    </View>
  );
}
