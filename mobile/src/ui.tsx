import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, tint } from './theme';
import { API_URL } from './api';

const build = () => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 18, paddingBottom: 40 },
  eyebrow: { color: C.onBg, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  h1: { color: C.head, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 6 },
  h2: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 10 },
  text: { color: C.text, fontSize: 15 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  note: { color: C.headMuted, fontSize: 13, lineHeight: 19 },
  err: { color: C.danger, fontSize: 13, marginVertical: 6 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#0B2A18', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 10 },
  input: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, padding: 12, fontSize: 15, marginBottom: 12 },
});
/** The shared styles. They are built again (in place) when the theme changes, see refreshStyles. */
export const s: ReturnType<typeof build> = build();
export function refreshStyles(): void { Object.assign(s, build()); }

export function Btn({ label, onPress, kind = 'primary', disabled, busy, style }: { label: string; onPress: () => void; kind?: 'primary' | 'outline' | 'ghost' | 'link'; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const p = kind === 'primary';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={[{ backgroundColor: p ? C.strong : 'transparent', borderColor: kind === 'ghost' || kind === 'link' ? 'transparent' : p ? C.strong : C.line, borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', opacity: disabled ? 0.45 : 1, marginBottom: 10 }, style]}>
      {busy ? <ActivityIndicator color={p ? C.onStrong : C.gold} /> : <Text style={{ color: p ? C.onStrong : kind === 'link' ? C.onBg : kind === 'ghost' ? C.gold : C.text, fontWeight: '700', fontSize: 15 }}>{label}</Text>}
    </Pressable>
  );
}

// A field draws its name inside its own box, so it reads the same on the green and inside a card.
const fieldBox = (): ViewStyle => ({ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, marginBottom: 12 });
const fieldLabel = () => ({ color: C.muted, fontSize: 11, fontWeight: '700' as const, marginBottom: 2 });
export function Field({ label, style, ...rest }: { label: string } & TextInputProps) {
  const f = (StyleSheet.flatten(style) ?? {}) as { minHeight?: number; textAlignVertical?: 'top' };
  return (
    <View style={fieldBox()}>
      <Text style={fieldLabel()}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} autoCapitalize="none" accessibilityLabel={label} style={{ color: C.text, fontSize: 15, paddingVertical: 4, paddingHorizontal: 0, minHeight: f.minHeight ? f.minHeight - 20 : undefined, textAlignVertical: f.textAlignVertical }} {...rest} />
    </View>
  );
}

/** A mobile number with its country code in front (+91 unless changed). Indian numbers are saved as 10 digits, others as +E.164. */
export function PhoneField({ label = 'Mobile number', code, number, onCode, onNumber }: { label?: string; code: string; number: string; onCode: (v: string) => void; onNumber: (v: string) => void }) {
  const inner = { color: C.text, fontSize: 15, paddingVertical: 4, paddingHorizontal: 0 };
  return (
    <View style={fieldBox()}>
      <Text style={fieldLabel()}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TextInput accessibilityLabel="Country code" placeholderTextColor={C.muted} keyboardType="phone-pad" maxLength={4} value={code} onChangeText={(v) => onCode(v.startsWith('+') ? v : `+${v.replace(/\D/g, '')}`)} style={[inner, { width: 48 }]} />
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: C.line }} />
        <TextInput accessibilityLabel={label} placeholder="98765 43210" placeholderTextColor={C.muted} keyboardType="phone-pad" autoComplete="tel" value={number} onChangeText={onNumber} style={[inner, { flex: 1 }]} />
      </View>
    </View>
  );
}
// Longest first, so +971 is not read as +9.
const COMMON_CODES = ['+971', '+966', '+974', '+968', '+965', '+973', '+977', '+880', '+254', '+353', '+44', '+61', '+64', '+65', '+94', '+60', '+27', '+49', '+1'];
/** Splits a saved number into its country code and the rest. Indian numbers are saved as 10 digits, others as +E.164. */
export function splitPhone(p: string | null | undefined): { code: string; number: string } {
  if (!p || !p.startsWith('+')) return { code: '+91', number: p ?? '' };
  const code = COMMON_CODES.find((c) => p.startsWith(c));
  return code ? { code, number: p.slice(code.length) } : { code: '+91', number: p };
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
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }} style={{ borderColor: on ? C.strong : C.line, backgroundColor: on ? C.strong : C.panel, borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14, marginRight: 8, marginBottom: 8, opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ color: on ? C.onStrong : C.text, fontSize: 13, fontWeight: on ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export const Loading = () => <View style={{ padding: 40 }}><ActivityIndicator color={C.gold} /></View>;
export const KV = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (<View style={s.row}><Text style={s.muted}>{k}</Text><Text style={[s.text, bold ? { fontWeight: '700' } : null]}>{v}</Text></View>);

export const Badge = ({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'gold' | 'ok' | 'danger' | 'warn' }) => {
  const col = tone === 'gold' ? C.gold : tone === 'ok' ? C.ok : tone === 'danger' ? C.danger : tone === 'warn' ? C.warn : C.muted;
  return <View style={{ backgroundColor: tint(col, 0.13), borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, marginRight: 6, marginBottom: 4 }}><Text style={{ color: col, fontSize: 11, fontWeight: '700' }}>{label}</Text></View>;
};

/** Where the customer is in booking: Select, Review, Pay, Confirm. at is the current step, 1 to 4. */
export function Steps({ at }: { at: number }) {
  return (
    <View accessibilityLabel={`Step ${at} of 4`} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
      {['Select', 'Review', 'Pay', 'Confirm'].map((name, i) => {
        const n = i + 1, done = n < at, on = n === at;
        return (
          <React.Fragment key={name}>
            {i > 0 && <View style={{ flex: 1, height: 2, marginHorizontal: 6, borderRadius: 1, backgroundColor: n <= at ? C.onBg : 'rgba(255,255,255,0.22)' }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done || on ? C.strong : 'transparent', borderWidth: 1.5, borderColor: done || on ? C.strong : 'rgba(255,255,255,0.3)' }}>
                <Text style={{ color: done || on ? C.onStrong : C.headMuted, fontSize: 12, fontWeight: '700' }}>{done ? '✓' : n}</Text>
              </View>
              {on && <Text style={{ color: C.head, fontSize: 13, fontWeight: '700', marginLeft: 6 }}>{name}</Text>}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** Guppi's face: a small robot on a green tile, drawn with plain views so it needs no picture or icon library. */
export const GuppiMark = ({ size = 36 }: { size?: number }) => {
  const u = size / 36;
  return (
    <View style={{ width: size, height: size, borderRadius: 10 * u, backgroundColor: C.strong, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', top: 5 * u, width: 2 * u, height: 5 * u, backgroundColor: C.onStrong, borderRadius: u }} />
      <View style={{ position: 'absolute', top: 3 * u, width: 5 * u, height: 5 * u, borderRadius: 3 * u, backgroundColor: C.onStrong }} />
      <View style={{ marginTop: 5 * u, width: 22 * u, height: 15 * u, borderRadius: 5 * u, backgroundColor: C.onStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
        <View style={{ width: 4 * u, height: 4 * u, borderRadius: 2 * u, backgroundColor: C.strong }} />
        <View style={{ width: 4 * u, height: 4 * u, borderRadius: 2 * u, backgroundColor: C.strong }} />
      </View>
    </View>
  );
};

/** The person's picture, or their initial on a green disc. */
export const Avatar = ({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {url ? <Image source={{ uri: /^(https?:|data:)/.test(url) ? url : API_URL + url }} style={{ width: size, height: size }} /> : <Text style={{ color: C.bg, fontWeight: '700', fontSize: size * 0.44 }}>{(name.trim()[0] || '?').toUpperCase()}</Text>}
  </View>
);

export const Section = ({ children }: { children: React.ReactNode }) => <Text style={[s.eyebrow, { marginTop: 18 }]}>{children}</Text>;

const showDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const isoDate = (txt: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt); if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]), dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const maskDate = (raw: string) => { const d = raw.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

/** A day typed as dd/mm/yyyy. value and onChange use yyyy-mm-dd; onChange gets an empty string until the date is complete and real. */
export function DateField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (iso: string) => void; placeholder?: string }) {
  const [txt, setTxt] = React.useState(showDate(value));
  React.useEffect(() => { if (isoDate(txt) !== value && !(txt.length > 0 && txt.length < 10)) setTxt(showDate(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<Field label={label} value={txt} placeholder={placeholder ?? 'dd/mm/yyyy'} keyboardType="number-pad" maxLength={10} onChangeText={(v) => { const t = maskDate(v); setTxt(t); onChange(isoDate(t)); }} />);
}

/** One figure with its label and a line under it, two to a row on the money screens. */
export const Stat = ({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone?: 'danger' | 'ok' }) => (
  <View style={[s.card, { flexBasis: '47%', flexGrow: 1, marginBottom: 10, padding: 14 }]}>
    <Text style={[s.muted, { fontSize: 12, fontWeight: '600' }]}>{label}</Text>
    <Text style={[s.text, { fontSize: 21, fontWeight: '700', marginVertical: 4 }, tone ? { color: tone === 'danger' ? C.danger : C.ok } : null]}>{value}</Text>
    {!!foot && <Text style={[s.muted, { fontSize: 12 }]}>{foot}</Text>}
  </View>
);
export const Stats = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>{children}</View>;

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 2026-10 as October 2026. */
export const monthName = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${FULL_MONTHS[(mo ?? 1) - 1]} ${y}`; };
/** The month (yyyy-mm) n months after m. */
export const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
/** Today's date in India, yyyy-mm-dd. */
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

/** The month shown, with arrows to step back and forward. */
export function MonthBar({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  const next = shiftMonth(month, 1);
  return (
    <View style={[s.row, { marginVertical: 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onChange(shiftMonth(month, -1))} style={{ padding: 10 }}><Text style={[s.text, { color: C.gold, fontSize: 20 }]}>‹</Text></Pressable>
      <Text style={[s.text, { fontWeight: '600' }]}>{monthName(month)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={!!max && next > max} onPress={() => onChange(next)} style={{ padding: 10, opacity: max && next > max ? 0.3 : 1 }}><Text style={[s.text, { color: C.gold, fontSize: 20 }]}>›</Text></Pressable>
    </View>
  );
}

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
/** One of the app's line icons (Ionicons, shipped inside the app, so nothing is fetched). */
export const Icon = ({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color ?? C.text} />;

/** Tabs inside a screen, drawn as one segmented bar; the open one is filled green. A long set scrolls sideways. */
export function Segmented<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  const row = (
    <View style={{ flexDirection: 'row', backgroundColor: C.soft, borderRadius: 12, padding: 4, gap: 4 }}>
      {items.map(([id, label]) => {
        const on = id === value;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(id)}
            style={{ flexGrow: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: on ? C.strong : 'transparent' }}>
            <Text style={{ color: on ? C.onStrong : C.muted, fontSize: 13, fontWeight: on ? '700' : '600' }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  return items.length > 4 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }}>{row}</ScrollView> : <View style={{ marginBottom: 12 }}>{row}</View>;
}

/** A row in a settings-style list: an icon on a soft tile, a title, a line under it, and an arrow (or whatever goes on the right). */
export function ListRow({ icon, title, sub, onPress, right, last, tone }: { icon: IconName; title: string; sub?: string; onPress?: () => void; right?: React.ReactNode; last?: boolean; tone?: 'danger' }) {
  const col = tone === 'danger' ? C.danger : C.gold;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tint(col, 0.12), alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={19} color={col} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: tone === 'danger' ? C.danger : C.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {!!sub && <Text style={[s.muted, { fontSize: 12.5, marginTop: 1 }]}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Icon name="chevron-forward" size={18} color={C.muted} /> : null)}
    </Pressable>
  );
}
/** A card that holds ListRows, edge to edge. */
export const ListCard = ({ children }: { children: React.ReactNode }) => <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>{children}</View>;

/** A square button with an icon over its name, four to a row on the home screens. */
export const ActionTile = ({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" onPress={onPress} style={[s.card, { flexBasis: '22%', flexGrow: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, marginBottom: 0 }]}>
    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}><Icon name={icon} size={22} color={C.gold} /></View>
    <Text style={{ color: C.text, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{label}</Text>
  </Pressable>
);

/** A figure on the home screens: an icon in a tinted circle, the number, and what it counts. */
export const StatTile = ({ icon, value, label, tone, onPress }: { icon: IconName; value: string; label: string; tone?: 'warn' | 'danger'; onPress?: () => void }) => {
  const col = tone === 'warn' ? C.warn : tone === 'danger' ? C.danger : C.gold;
  return (
    <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={[s.card, { flexBasis: '30%', flexGrow: 1, padding: 12, marginBottom: 0 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: tint(col, 0.14), alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={16} color={col} /></View>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{value}</Text>
      </View>
      <Text style={[s.muted, { fontSize: 12, lineHeight: 15, marginTop: 6 }]}>{label}</Text>
    </Pressable>
  );
};

/** A section title with an optional link on the right ("See all"). */
export const SectionHead = ({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) => (
  <View style={[s.row, { marginTop: 14, marginBottom: 6 }]}>
    <Text style={{ color: C.head, fontSize: 17, fontWeight: '800' }}>{title}</Text>
    {!!action && <Pressable accessibilityRole="button" onPress={onAction}><Text style={{ color: C.gold, fontSize: 13, fontWeight: '700' }}>{action}</Text></Pressable>}
  </View>
);

/** The top of an inner page: a back arrow and the page's name. */
export const BackBar = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
    <Icon name="chevron-back" size={24} color={C.head} />
    <Text style={{ color: C.head, fontSize: 20, fontWeight: '800' }}>{title}</Text>
  </Pressable>
);
