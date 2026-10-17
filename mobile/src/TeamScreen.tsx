import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from './api';
import type { TeamMember } from './types';
import { Badge, Btn, Chip, Field, Loading, Section, s, NameFields } from './ui';
import { C } from './theme';

const PRESET_LABEL: Record<string, string> = { admin: 'Admin', general_manager: 'General manager', coach: 'Coach', front_desk: 'Front desk', accountant: 'Accountant' };

/** The owner's team: add a person from a ready-made role, adjust their permissions, or switch them off. */
export function TeamScreen() {
  const [items, setItems] = useState<TeamMember[] | null>(null); const [perms, setPerms] = useState<string[]>([]); const [presets, setPresets] = useState<Record<string, { title: string; permissions: string[] }>>({});
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [pw, setPw] = useState(''); const [preset, setPreset] = useState('front_desk');
  const [open, setOpen] = useState(''); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await api<{ items: TeamMember[]; allPermissions: string[]; presets: Record<string, { title: string; permissions: string[] }> }>('/api/staff/team'); setItems(r.items); setPerms(r.allPermissions); setPresets(r.presets); setErr(''); }
    catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setErr(''); setNote('');
    try { await api('/api/staff/team', { method: 'POST', body: { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, password: pw, preset } }); setName(''); setEmail(''); setPhone(''); setPw(''); setNote('Team member added.'); void load(); }
    catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  const patch = async (id: string, body: unknown) => { setErr(''); try { await api(`/api/staff/team/${id}`, { method: 'PATCH', body }); void load(); } catch (e: any) { setErr(e.message); } };
  const toggle = (m: TeamMember, p: string) => patch(m.id, { permissions: m.permissions.includes(p) ? m.permissions.filter((x) => x !== p) : [...m.permissions, p] });

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>Owner</Text><Text style={s.h1}>Your team</Text>
      <Text style={s.muted}>An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports. Prices, promo codes, the team and settings stay with you.</Text>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {items === null ? <Loading /> : items.map((m) => (
        <View key={m.id} style={[s.card, { marginTop: 12 }]}>
          <Text style={s.h2}>{m.name}</Text><Text style={s.muted}>{m.email}{m.phone ? `  ·  ${m.phone}` : ''}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>{m.active === false ? <Badge tone="danger" label="Switched off" /> : <Badge tone="ok" label="Active" />}<Badge label={`${m.permissions.length} permissions`} /></View>
          <Btn kind="ghost" label={open === m.id ? 'Hide permissions' : 'Permissions'} onPress={() => setOpen(open === m.id ? '' : m.id)} />
          {open === m.id && (<><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{perms.map((p) => <Chip key={p} label={p.replace('_', ' ')} on={m.permissions.includes(p)} onPress={() => toggle(m, p)} />)}</View>
            <Btn kind="outline" label={m.active === false ? 'Switch on' : 'Switch off'} onPress={() => patch(m.id, { active: m.active === false })} /></>)}
        </View>
      ))}
      <Section>Add a team member</Section>
      <NameFields value={name} onChange={setName} /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Password (at least 10 characters)" value={pw} onChangeText={setPw} secureTextEntry />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.keys(presets).map((k) => <Chip key={k} label={PRESET_LABEL[k] ?? presets[k]!.title} on={preset === k} onPress={() => setPreset(k)} />)}</View>
      <Btn label="Add team member" onPress={add} disabled={!name.trim() || !email.trim() || !pw} />
    </ScrollView>
  );
}
