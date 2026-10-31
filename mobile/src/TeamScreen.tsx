import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './Text';
import { api } from './api';
import type { TeamMember } from './types';
import { Avatar, BackBar, Btn, Chip, Field, Glow, Icon, type IconName, ListCard, Loading, s, Section, NameFields, hueOf } from './ui';
import { C, HUES, formatPhone, tint } from './theme';

const PRESET_LABEL: Record<string, string> = { admin: 'Admin', general_manager: 'General manager', coach: 'Coach', front_desk: 'Front desk', accountant: 'Accountant' };

// The permissions grouped the way an owner thinks about them, each with an icon and one line on what it opens.
type PermRow = [string, IconName, string, string];
const PERM_GROUPS: { title: string; hue?: number; items: PermRow[] }[] = [
  { title: 'Bookings', hue: 0, items: [['manage_bookings', 'calendar-outline', 'Bookings', 'Make, move and cancel bookings'], ['manage_enquiries', 'chatbubble-outline', 'Enquiries', 'Answer and follow up enquiries'], ['manage_grounds', 'baseball-outline', 'Grounds', 'Grounds and their slots']] },
  { title: 'Money', hue: 6, items: [['verify_payments', 'checkmark-circle-outline', 'Check payments', 'Confirm payments customers sent'], ['record_payments', 'cash-outline', 'Record payments', 'Take cash and other payments'], ['view_revenue', 'wallet-outline', 'Revenue', 'See money taken'], ['view_reports', 'podium-outline', 'Reports', 'Read reports'], ['manage_accounting', 'receipt-outline', 'Books', 'Work in the accounts']] },
  { title: 'People', hue: 1, items: [['view_customers', 'people-outline', 'Customers', 'See customer details'], ['send_broadcasts', 'send-outline', 'Messages', 'Send WhatsApp reminders and broadcasts'], ['manage_tasks', 'checkbox-outline', 'Tasks', 'Give out and sign off tasks']] },
  { title: 'Cricket', hue: 2, items: [['manage_academy', 'school-outline', 'Academy', 'Students, batches and progress cards'], ['manage_matches', 'trophy-outline', 'Matches', 'Score matches and run tournaments'], ['view_cameras', 'videocam-outline', 'Cameras', 'Watch the ground cameras']] },
];

const Pill = ({ label, tone, on }: { label: string; tone: string; on?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: tint(tone, 0.18), borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 }}>
    {on && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />}<Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{label}</Text>
  </View>
);
const QuickAction = ({ icon, label, onPress, on, danger }: { icon: IconName; label: string; onPress: () => void; on?: boolean; danger?: boolean }) => (
  <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, { flex: 1, alignItems: 'center', paddingVertical: 14, marginBottom: 0, backgroundColor: on ? C.strong : C.panel, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <Icon name={icon} size={22} color={on ? C.onStrong : danger ? C.danger : C.gold} />
    <Text style={{ color: on ? C.onStrong : danger ? C.danger : C.text, fontSize: 13, fontWeight: '700', marginTop: 6 }}>{label}</Text>
  </Pressable>
);
const SumTile = ({ n, label, hue }: { n: string; label: string; hue: number }) => (
  <View style={[s.card, { flex: 1, padding: 14, marginBottom: 0 }]}>
    <Text style={{ color: HUES[hue], fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>{n}</Text>
    <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
  </View>
);

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
  const [open, setOpen] = useState(''); const [adding, setAdding] = useState(false); const [search, setSearch] = useState(''); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);

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

  const roleOf = (m: TeamMember) => { const k = Object.keys(presets).find((p) => { const want = presets[p]!.permissions; return want.length === m.permissions.length && want.every((x) => m.permissions.includes(x)); }); return k ? PRESET_LABEL[k] ?? presets[k]!.title : 'Custom role'; };
  const people = items ?? [];
  const sel = people.find((m) => m.id === open.replace(/^edit:/, ''));

  // One person's own page: a profile card, quick actions, and their permissions as grouped switches.
  if (sel) {
    const off = sel.active === false;
    const editing = open === `edit:${sel.id}`;
    const known = new Set(PERM_GROUPS.flatMap((g) => g.items.map((i) => i[0])));
    const groups = [...PERM_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => perms.includes(i[0])) })), { title: 'Other', items: perms.filter((p) => !known.has(p)).map((p): PermRow => [p, 'ellipse-outline', p.replace(/_/g, ' '), '']) }].filter((g) => g.items.length);
    return (
      <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
        <BackBar title="Team" onBack={() => setOpen('')} />
        <View style={{ borderRadius: 30, overflow: 'hidden', backgroundColor: C.ink, padding: 22, alignItems: 'center', marginBottom: 16 }}>
          <Glow color={hueOf(sel.name)} size={280} top={-170} left={40} opacity={0.55} />
          <View style={{ opacity: off ? 0.5 : 1 }}><Avatar name={sel.name} size={84} /></View>
          <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 12 }}>{sel.name}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>{roleOf(sel)}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Pill on={!off} label={off ? 'Switched off' : 'Active'} tone={off ? '#F0796E' : '#5CC98A'} />
            {sel.mfa && <Pill on label="2FA on" tone="#4C9BF5" />}
            {sel.readOnly && <Pill on label="Read only" tone="#F2B544" />}
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{sel.email}{sel.phone ? `  ·  ${formatPhone(sel.phone)}` : ''}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
          <QuickAction icon="create-outline" label={editing ? 'Close' : 'Edit details'} on={editing} onPress={() => setOpen(editing ? sel.id : `edit:${sel.id}`)} />
          <QuickAction icon={off ? 'power' : 'power-outline'} label={off ? 'Switch on' : 'Switch off'} danger={!off} onPress={() => patch(sel.id, { active: off })} />
        </View>
        {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
        {editing && <View style={[s.card, { marginTop: 8 }]}><EditMember m={sel} onSaved={(n) => { setNote(n); setOpen(sel.id); void load(); }} /></View>}
        {groups.map((g) => (
          <View key={g.title}>
            <Section>{g.title}</Section>
            <ListCard>
              {g.items.map(([p, icon, title, sub], i) => (
                <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: i === g.items.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: tint(HUES[g.hue ?? 0]!, 0.16), alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} color={HUES[g.hue ?? 0]} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: '600' }]}>{title}</Text>
                    {!!sub && <Text style={[s.muted, { fontSize: 12.5 }]}>{sub}</Text>}
                  </View>
                  <Switch accessibilityLabel={title} value={sel.permissions.includes(p)} onValueChange={() => toggle(sel, p)} trackColor={{ false: C.soft, true: C.strong }} thumbColor="#FFFFFF" ios_backgroundColor={C.soft} />
                </View>
              ))}
            </ListCard>
          </View>
        ))}
      </ScrollView>
    );
  }

  const q = search.trim().toLowerCase();
  const shown = people.filter((m) => !q || m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q));
  const activeN = people.filter((m) => m.active !== false).length;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { paddingVertical: 0, marginBottom: 4 }]}>
        <Text style={[s.h1, { marginBottom: 0 }]}>Team</Text>
        {!adding && <Pressable accessibilityRole="button" accessibilityLabel="Add a team member" onPress={() => { setAdding(true); setNote(''); }} style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: C.strong, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}><Icon name="add" size={24} color={C.onStrong} /></Pressable>}
      </View>
      <Text style={[s.muted, { marginBottom: 16 }]}>Prices, promo codes, the team and settings stay with you.</Text>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        <SumTile n={items === null ? '–' : String(activeN)} label="Active" hue={6} />
        <SumTile n={items === null ? '–' : String(people.length - activeN)} label="Switched off" hue={4} />
        <SumTile n={items === null ? '–' : String(people.filter((m) => m.mfa).length)} label="With 2FA" hue={1} />
      </View>

      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}

      {adding && (
        <View style={s.card}>
          <View style={[s.row, { paddingVertical: 0, marginBottom: 10 }]}><Text style={[s.h2, { marginBottom: 0 }]}>New team member</Text><Btn size="sm" kind="ghost" label="Cancel" onPress={() => setAdding(false)} /></View>
          <NameFields value={name} onChange={setName} /><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Password (at least 10 characters)" value={pw} onChangeText={setPw} secureTextEntry />
          <Text style={[s.muted, { fontSize: 12, fontWeight: '600', marginBottom: 6 }]}>Role</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.keys(presets).map((k) => <Chip key={k} label={PRESET_LABEL[k] ?? presets[k]!.title} on={preset === k} onPress={() => setPreset(k)} />)}</View>
          {preset === 'admin' && <Text style={[s.muted, { marginBottom: 8 }]}>An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports.</Text>}
          <Btn label="Add team member" onPress={add} disabled={!name.trim() || !email.trim() || !pw} style={{ marginTop: 4, marginBottom: 0 }} />
        </View>
      )}

      {people.length > 3 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.soft, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 14 }}>
          <Icon name="search-outline" size={18} color={C.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search the team" placeholderTextColor={C.muted} autoCapitalize="none" accessibilityLabel="Search the team" style={{ flex: 1, color: C.text, fontSize: 15, padding: 0 }} />
        </View>
      )}

      {items === null ? <Loading /> : !people.length ? <Text style={s.muted}>No one on the team yet.</Text> : !shown.length ? <Text style={s.muted}>No one matches “{search.trim()}”.</Text> : (
        <ListCard>
          {shown.map((m, i) => (
            <Pressable key={m.id} accessibilityRole="button" onPress={() => { setOpen(m.id); setNote(''); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: i === shown.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })}>
              <View style={{ opacity: m.active === false ? 0.45 : 1 }}>
                <Avatar name={m.name} size={48} />
                {m.active !== false && <View style={{ position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: C.ok, borderWidth: 2, borderColor: C.panel }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '700', fontSize: 16 }]} numberOfLines={1}>{m.name}</Text>
                <Text style={[s.muted, { fontSize: 13 }]} numberOfLines={1}>{m.active === false ? 'Switched off' : roleOf(m)}{m.readOnly ? ' · Read only' : ''}</Text>
              </View>
              {m.mfa && <Icon name="shield-checkmark-outline" size={18} color={C.muted} />}
              <Icon name="chevron-forward" size={18} color={C.muted} />
            </Pressable>
          ))}
        </ListCard>
      )}
    </ScrollView>
  );
}
