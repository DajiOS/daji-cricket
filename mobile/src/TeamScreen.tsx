import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import type { TeamMember } from './types';
import { Avatar, Badge, Btn, Chip, Field, Icon, ListCard, Loading, s, NameFields } from './ui';
import { C, formatPhone } from './theme';

const PRESET_LABEL: Record<string, string> = { admin: 'Admin', general_manager: 'General manager', coach: 'Coach', front_desk: 'Front desk', accountant: 'Accountant' };

/** Edit one member: name, email, mobile, a new password (signs them out everywhere), Read only, and resetting their two-step sign-in. */
function EditMember({ m, onSaved }: { m: TeamMember; onSaved: (note: string) => void }) {
  const [name, setName] = useState(m.name); const [email, setEmail] = useState(m.email ?? ''); const [phone, setPhone] = useState(m.phone ?? ''); const [pw, setPw] = useState('');
  const [readOnly, setReadOnly] = useState(!!m.readOnly); const [resetMfa, setResetMfa] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    const body: Record<string, unknown> = {};
    if (name.trim() !== m.name) body.name = name.trim();
    if (email.trim() !== (m.email ?? '')) body.email = email.trim();
    if (phone.trim() && phone.trim() !== (m.phone ?? '')) body.phone = phone.trim();
    if (pw) body.password = pw;
    if (readOnly !== !!m.readOnly) body.readOnly = readOnly;
    if (resetMfa) body.resetMfa = true;
    if (!name.trim() || !email.trim()) { setErr(!name.trim() ? 'Type their name.' : 'Type their email address.'); return; }
    if (!Object.keys(body).length) return;
    setErr(''); setBusy(true);
    try { await api(`/api/staff/team/${m.id}`, { method: 'PATCH', body }); setPw(''); setResetMfa(false); onSaved(pw || resetMfa ? 'Saved. Their old sign-ins have ended.' : 'Saved.'); }
    catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: 8 }}>
      <NameFields value={name} onChange={setName} /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Set a new password (leave empty to keep it)" value={pw} onChangeText={setPw} secureTextEntry />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="Read only" on={readOnly} onPress={() => setReadOnly(!readOnly)} />
        {m.mfa && <Chip label="Reset two-step sign-in" on={resetMfa} onPress={() => setResetMfa(!resetMfa)} />}
      </View>
      {readOnly && <Text style={s.muted}>Read only: they can look at everything their role opens, but cannot change anything.</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Save changes" onPress={save} busy={busy} disabled={busy} />
    </View>
  );
}

/** The owner's team: add a person from a ready-made role, adjust their permissions, or switch them off. */
export function TeamScreen() {
  const [items, setItems] = useState<TeamMember[] | null>(null); const [perms, setPerms] = useState<string[]>([]); const [presets, setPresets] = useState<Record<string, { title: string; permissions: string[] }>>({});
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [pw, setPw] = useState(''); const [preset, setPreset] = useState('front_desk');
  const [open, setOpen] = useState(''); const [adding, setAdding] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await api<{ items: TeamMember[]; allPermissions: string[]; presets: Record<string, { title: string; permissions: string[] }> }>('/api/staff/team'); setItems(r.items); setPerms(r.allPermissions); setPresets(r.presets); setErr(''); }
    catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setErr(''); setNote('');
    try { await api('/api/staff/team', { method: 'POST', body: { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, password: pw, preset } }); setName(''); setEmail(''); setPhone(''); setPw(''); setAdding(false); setNote('Team member added.'); void load(); }
    catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  const patch = async (id: string, body: unknown) => { setErr(''); try { await api(`/api/staff/team/${id}`, { method: 'PATCH', body }); void load(); } catch (e: any) { setErr(e.message); } };
  const toggle = (m: TeamMember, p: string) => patch(m.id, { permissions: m.permissions.includes(p) ? m.permissions.filter((x) => x !== p) : [...m.permissions, p] });

  const roleOf = (m: TeamMember) => { const k = Object.keys(presets).find((p) => { const want = presets[p]!.permissions; return want.length === m.permissions.length && want.every((x) => m.permissions.includes(x)); }); return k ? PRESET_LABEL[k] ?? presets[k]!.title : `${m.permissions.length} permissions`; };
  const people = items ?? [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>Owner</Text>
      <View style={[s.row, { paddingVertical: 0, alignItems: 'flex-end' }]}>
        <Text style={[s.h1, { marginBottom: 0 }]}>Your team</Text>
        {!adding && <Btn size="sm" icon="add" label="Add" onPress={() => { setAdding(true); setNote(''); }} style={{ marginBottom: 4 }} />}
      </View>
      <Text style={[s.muted, { marginTop: 6, marginBottom: 14 }]}>{items === null ? ' ' : `${people.filter((m) => m.active !== false).length} active · ${people.length} in all`}. Prices, promo codes, the team and settings stay with you.</Text>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}

      {adding && (
        <View style={s.card}>
          <View style={[s.row, { paddingVertical: 0, marginBottom: 10 }]}><Text style={[s.h2, { marginBottom: 0 }]}>Add a team member</Text><Btn size="sm" kind="ghost" label="Cancel" onPress={() => setAdding(false)} /></View>
          <NameFields value={name} onChange={setName} /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Password (at least 10 characters)" value={pw} onChangeText={setPw} secureTextEntry />
          <Text style={[s.muted, { fontSize: 12, fontWeight: '600', marginBottom: 6 }]}>Role</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.keys(presets).map((k) => <Chip key={k} label={PRESET_LABEL[k] ?? presets[k]!.title} on={preset === k} onPress={() => setPreset(k)} />)}</View>
          {preset === 'admin' && <Text style={[s.muted, { marginBottom: 8 }]}>An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports.</Text>}
          <Btn label="Add team member" onPress={add} disabled={!name.trim() || !email.trim() || !pw} style={{ marginTop: 4, marginBottom: 0 }} />
        </View>
      )}

      {items === null ? <Loading /> : !people.length ? <Text style={s.muted}>No one on the team yet.</Text> : (
        <ListCard>
          {people.map((m, i) => {
            const on = open === m.id || open === `edit:${m.id}`;
            return (
              <View key={m.id} style={{ borderBottomWidth: i === people.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOpen(on ? '' : m.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ opacity: m.active === false ? 0.45 : 1 }}><Avatar name={m.name} size={42} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{m.name}</Text>
                    <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={1}>{roleOf(m)}{m.readOnly ? ' · Read only' : ''}{m.mfa ? ' · 2FA' : ''}</Text>
                  </View>
                  {m.active === false ? <Badge tone="danger" label="Off" /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.ok }} />}
                  <Icon name={on ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
                </Pressable>
                {on && (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                    <Text style={[s.muted, { marginBottom: 10 }]}>{m.email}{m.phone ? `  ·  ${formatPhone(m.phone)}` : ''}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                      <Btn size="sm" kind={open === `edit:${m.id}` ? 'primary' : 'ghost'} icon="create-outline" label="Edit details" onPress={() => setOpen(`edit:${m.id}`)} />
                      <Btn size="sm" kind={open === m.id ? 'primary' : 'ghost'} icon="key-outline" label="Permissions" onPress={() => setOpen(m.id)} />
                      <Btn size="sm" kind="outline" icon={m.active === false ? 'power' : 'power-outline'} label={m.active === false ? 'Switch on' : 'Switch off'} onPress={() => patch(m.id, { active: m.active === false })} />
                    </View>
                    {open === `edit:${m.id}` && <EditMember m={m} onSaved={(n) => { setNote(n); void load(); }} />}
                    {open === m.id && <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>{perms.map((p) => <Chip key={p} label={p.replace(/_/g, ' ')} on={m.permissions.includes(p)} onPress={() => toggle(m, p)} />)}</View>}
                  </View>
                )}
              </View>
            );
          })}
        </ListCard>
      )}
    </ScrollView>
  );
}
