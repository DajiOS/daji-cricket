import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { Promo } from './types';
import { Badge, Btn, Chip, Field, Loading, Section, s, ScreenHead, Empty } from './ui';
import { C, inr } from './theme';

const describe = (p: Promo): string => (p.kind === 'percent' ? `${p.value}% off` : `${inr(p.value)} off`) + (p.usageLimit ? `  ·  ${p.used ?? 0} of ${p.usageLimit} used` : '');

/** Promo codes: make one by hand, or generate a batch of one-time codes. */
export function PromoScreen() {
  const [items, setItems] = useState<Promo[] | null>(null);
  const [auto, setAuto] = useState(true); const [code, setCode] = useState(''); const [prefix, setPrefix] = useState('DAJI'); const [count, setCount] = useState('1'); const [oneTime, setOneTime] = useState(true);
  const [kind, setKind] = useState<'percent' | 'flat'>('percent'); const [value, setValue] = useState('10'); const [label, setLabel] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [fresh, setFresh] = useState<string[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await api<{ items: Promo[] }>('/api/staff/promos')).items); setErr(''); } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const make = async () => {
    setErr(''); setNote(''); setFresh([]);
    try {
      const body: any = { label: label.trim() || undefined, kind, value: kind === 'percent' ? Math.round(Number(value)) : Math.round(Number(value) * 100) };
      if (auto) Object.assign(body, { auto: true, count: Number(count) || 1, prefix: prefix.trim() || undefined, oneTime }); else body.code = code.trim();
      const r = await api<{ items: Promo[] }>('/api/staff/promos', { method: 'POST', body });
      setFresh(r.items.map((p) => p.code)); setNote(r.items.length === 1 ? 'Promo code created.' : `${r.items.length} promo codes created.`); setCode(''); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  const flip = async (p: Promo) => { try { await api(`/api/staff/promos/${p.id}/active`, { method: 'POST', body: { active: !p.active } }); void load(); } catch (e: any) { setErr(e.message); } };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <ScreenHead eyebrow="Owner" title="Promo codes" />
      <View style={[s.card, { marginTop: 10 }]}>
        <View style={{ flexDirection: 'row' }}><Chip label="Generate codes" on={auto} onPress={() => setAuto(true)} /><Chip label="My own code" on={!auto} onPress={() => setAuto(false)} /></View>
        {auto ? (<><Field label="Starts with" value={prefix} onChangeText={setPrefix} /><Field label="How many (up to 50)" value={count} onChangeText={setCount} keyboardType="numeric" /><Chip label={`${oneTime ? '✓ ' : ''}One time use each`} on={oneTime} onPress={() => setOneTime(!oneTime)} /></>) : <Field label="Code" value={code} onChangeText={setCode} />}
        <View style={{ flexDirection: 'row' }}><Chip label="% off" on={kind === 'percent'} onPress={() => setKind('percent')} /><Chip label="₹ off" on={kind === 'flat'} onPress={() => setKind('flat')} /></View>
        <Field label={kind === 'percent' ? 'Percent off' : 'Rupees off'} value={value} onChangeText={setValue} keyboardType="numeric" /><Field label="Name (optional)" value={label} onChangeText={setLabel} autoCapitalize="sentences" />
        <Btn label={auto ? 'Generate' : 'Create code'} onPress={make} disabled={!Number(value) || (!auto && !code.trim())} />
        {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
        {fresh.map((c) => <Text key={c} selectable style={[s.text, { letterSpacing: 2, fontWeight: '700', marginTop: 4 }]}>{c}</Text>)}
      </View>
      <Section>Your codes</Section>
      {items === null ? <Loading /> : !items.length ? <Empty icon="pricetag-outline" text="No promo codes yet." /> : items.map((p) => (
        <View key={p.id} style={s.card}>
          <View style={s.row}><Text selectable style={[s.text, { fontWeight: '700', letterSpacing: 1.5 }]}>{p.code}</Text><Badge tone={p.active ? 'ok' : 'muted'} label={p.active ? 'Active' : 'Off'} /></View>
          <Text style={s.muted}>{describe(p)}{p.label ? `  ·  ${p.label}` : ''}</Text>
          <Btn kind="ghost" label={p.active ? 'Switch off' : 'Switch on'} onPress={() => flip(p)} />
        </View>
      ))}
    </ScrollView>
  );
}
