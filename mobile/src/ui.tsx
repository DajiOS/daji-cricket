import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { C } from './theme';
import { API_URL } from './api';

const build = () => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 18, paddingBottom: 40 },
  eyebrow: { color: C.gold, fontSize: 11, letterSpacing: 2.4, textTransform: 'uppercase', marginBottom: 8 },
  h1: { color: C.text, fontSize: 30, fontWeight: '700', marginBottom: 6 },
  h2: { color: C.text, fontSize: 19, fontWeight: '600', marginBottom: 10 },
  text: { color: C.text, fontSize: 15 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  err: { color: C.danger, fontSize: 13, marginVertical: 6 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 10 },
  input: { backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 8, color: C.text, padding: 12, fontSize: 15, marginBottom: 12 },
});
/** The shared styles. They are built again (in place) when the theme changes, see refreshStyles. */
export const s: ReturnType<typeof build> = build();
export function refreshStyles(): void { Object.assign(s, build()); }

export function Btn({ label, onPress, kind = 'primary', disabled, busy, style }: { label: string; onPress: () => void; kind?: 'primary' | 'outline' | 'ghost'; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const p = kind === 'primary';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={[{ backgroundColor: p ? C.gold : 'transparent', borderColor: kind === 'ghost' ? 'transparent' : C.gold, borderWidth: 1, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', opacity: disabled ? 0.45 : 1, marginBottom: 10 }, style]}>
      {busy ? <ActivityIndicator color={p ? C.bg : C.gold} /> : <Text style={{ color: p ? C.bg : C.gold, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 13 }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...rest }: { label: string } & TextInputProps) {
  return (<View><Text style={[s.muted, { marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1.4, fontSize: 11 }]}>{label}</Text><TextInput placeholderTextColor={C.muted} autoCapitalize="none" style={s.input} {...rest} /></View>);
}

/** "Asha Rao" is first "Asha", last "Rao"; the last word is the surname. */
export const splitName = (full: string): { first: string; last: string } => {
  const p = (full || '').trim().split(/\s+/).filter(Boolean);
  return p.length < 2 ? { first: p[0] || '', last: '' } : { first: p.slice(0, -1).join(' '), last: p[p.length - 1]! };
};
export const joinName = (first: string, last: string) => `${first.trim()} ${last.trim()}`.trim();

/** First name and Last name as two fields wherever a form asks for a person. Reports the full name. */
export function NameFields({ value, onChange, firstLabel = 'First name', lastLabel = 'Last name' }: { value: string; onChange: (full: string) => void; firstLabel?: string; lastLabel?: string }) {
  const [p, setP] = React.useState(() => splitName(value));
  React.useEffect(() => { if (joinName(p.first, p.last) !== (value || '').trim()) setP(splitName(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: 'first' | 'last') => (v: string) => { const n = { ...p, [k]: v }; setP(n); onChange(joinName(n.first, n.last)); };
  return (<><Field label={firstLabel} value={p.first} onChangeText={set('first')} autoCapitalize="words" autoComplete="name-given" /><Field label={lastLabel} value={p.last} onChangeText={set('last')} autoCapitalize="words" autoComplete="name-family" /></>);
}

export function Chip({ label, on, onPress, disabled }: { label: string; on?: boolean; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ borderColor: on ? C.gold : C.line, backgroundColor: on ? 'rgba(201,169,107,.14)' : 'transparent', borderWidth: 1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 13, marginRight: 8, marginBottom: 8, opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ color: on ? C.gold : C.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export const Loading = () => <View style={{ padding: 40 }}><ActivityIndicator color={C.gold} /></View>;
export const KV = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (<View style={s.row}><Text style={s.muted}>{k}</Text><Text style={[s.text, bold ? { fontWeight: '700' } : null]}>{v}</Text></View>);

export const Badge = ({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'gold' | 'ok' | 'danger' }) => {
  const col = tone === 'gold' ? C.gold : tone === 'ok' ? C.ok : tone === 'danger' ? C.danger : C.muted;
  return <View style={{ borderColor: col, borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, marginRight: 6, marginBottom: 4 }}><Text style={{ color: col, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }}>{label}</Text></View>;
};

/** The person's picture, or their initial on a gold disc. */
export const Avatar = ({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {url ? <Image source={{ uri: /^(https?:|data:)/.test(url) ? url : API_URL + url }} style={{ width: size, height: size }} /> : <Text style={{ color: C.bg, fontWeight: '700', fontSize: size * 0.44 }}>{(name.trim()[0] || '?').toUpperCase()}</Text>}
  </View>
);

export const Section = ({ children }: { children: React.ReactNode }) => <Text style={[s.eyebrow, { marginTop: 18 }]}>{children}</Text>;
