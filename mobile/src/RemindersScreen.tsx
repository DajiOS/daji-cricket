import React, { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Chip, Field, Loading, s, ScreenHead, Empty } from './ui';
import { C, formatPhone } from './theme';

type Kind = 'booking' | 'payment' | 'membership' | 'fixture';
interface Item { kind: Kind; key: string; name: string; phone: string | null; summary: string; message: string; link: string | null; sentAt: number | null }
interface Queue { items: Item[]; membershipsAvailable: boolean; counts: Record<string, number> }
interface Sent { id: string; kind: Kind; name: string; phone: string | null; message: string; sentAt: number; sentBy: string | null }
interface Template { kind: Kind; label: string }
const LABEL: Record<Kind, string> = { booking: 'Booking', payment: 'Payment due', membership: 'Membership', fixture: 'Fixture' };
const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
type View_ = 'pending' | 'all' | 'one' | 'history';

/** WhatsApp reminders: who to remind (tomorrow's games, balances, memberships), a one-off message, and what was sent. */
export function RemindersScreen() {
  const [view, setView] = useState<View_>('pending');
  const [q, setQ] = useState<Queue | null>(null); const [hist, setHist] = useState<Sent[] | null>(null); const [templates, setTemplates] = useState<Template[]>([]);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b, t] = await Promise.all([api<Queue>('/api/desk/reminders/queue'), api<{ items: Sent[] }>('/api/desk/reminders/history?limit=100'), api<{ items: Template[] }>('/api/desk/reminders/templates')]);
      setQ(a); setHist(b.items); setTemplates(t.items); setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = (link: string) => { Linking.openURL(link).catch(() => setErr('Could not open WhatsApp on this phone.')); };
  const mark = async (i: Item) => {
    setErr(''); setNote(''); setWorking(i.kind + i.key);
    try { await api('/api/desk/reminders/sent', { method: 'POST', body: { kind: i.kind, key: i.key } }); setNote(`Logged as sent to ${i.name}.`); void load(); } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  const items = q ? q.items.filter((i) => view === 'all' || !i.sentAt) : [];
  const tabs: [View_, string][] = [['pending', q?.counts.pending ? `To send (${q.counts.pending})` : 'To send'], ['all', 'All'], ['one', 'Send one'], ['history', 'Sent']];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="People" title="Reminders" about="Open WhatsApp, press send in the chat, then come back and mark it sent. Change the wording of each message on the desk under WhatsApp reminders." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 10 }}>{tabs.map(([k, label]) => <Chip key={k} label={label} on={view === k} onPress={() => setView(k)} />)}</View>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {view === 'one' ? <SendOne templates={templates} onOpen={open} onLogged={(m) => { setNote(m); void load(); }} />
        : view === 'history' ? (!hist ? <Loading /> : !hist.length ? <Empty icon="alarm-outline" text="Nothing has been marked as sent yet." /> : hist.map((h) => (
          <View key={h.id} style={s.card}>
            <View style={s.row}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{h.name}</Text><Badge label={LABEL[h.kind]} /></View>
            <Text style={s.muted}>{when(h.sentAt)}{h.sentBy ? `, by ${h.sentBy}` : ''}{h.phone ? `  ·  ${formatPhone(h.phone)}` : ''}</Text>
            <Text style={[s.text, { fontSize: 14, marginTop: 6 }]} numberOfLines={4}>{h.message}</Text>
          </View>
        )))
        : !q ? (err ? null : <Loading />) : !items.length ? <Text style={s.muted}>{view === 'pending' ? 'Everyone is reminded for now.' : 'Nothing in this list.'}</Text> : items.map((i) => (
          <View key={i.kind + i.key} style={s.card}>
            <View style={s.row}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{i.name}</Text><Badge label={LABEL[i.kind]} tone={i.kind === 'payment' ? 'danger' : 'gold'} /></View>
            <Text style={s.muted}>{i.phone ? formatPhone(i.phone) : 'No phone number'}  ·  {i.summary}</Text>
            <View style={{ backgroundColor: C.bg, borderRadius: 12, padding: 12, marginVertical: 8 }}><Text style={[s.text, { fontSize: 14 }]}>{i.message}</Text></View>
            {i.sentAt ? (<>
              <View style={{ flexDirection: 'row' }}><Badge tone="ok" label={`Sent ${when(i.sentAt)}`} /></View>
              {!!i.link && <Btn kind="ghost" label="Open WhatsApp again" onPress={() => open(i.link!)} style={{ marginBottom: 0 }} />}
            </>) : !i.link ? <Text style={[s.muted, { color: C.danger }]}>Cannot send: no usable WhatsApp number.</Text> : (<>
              <Btn label="Open WhatsApp" onPress={() => open(i.link!)} />
              <Btn kind="outline" label="Mark sent" busy={working === i.kind + i.key} onPress={() => mark(i)} style={{ marginBottom: 0 }} />
            </>)}
          </View>
        ))}
    </ScrollView>
  );
}

/** A one-off message from a template, such as a tournament fixture. */
function SendOne({ templates, onOpen, onLogged }: { templates: Template[]; onOpen: (link: string) => void; onLogged: (msg: string) => void }) {
  const [f, setF] = useState({ kind: 'fixture' as Kind, name: '', phone: '', date: '', time: '', amount: '' });
  const [pre, setPre] = useState<{ message: string; link: string | null } | null>(null); const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { api<{ message: string; link: string | null }>('/api/desk/reminders/preview', { method: 'POST', body: f }).then((r) => live && setPre(r)).catch(() => live && setPre(null)); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [f]);
  const log = async () => {
    if (!pre) return; setErr('');
    try { await api('/api/desk/reminders/sent', { method: 'POST', body: { kind: f.kind, name: f.name.trim(), phone: f.phone.trim(), message: pre.message } }); onLogged(`Logged as sent to ${f.name.trim()}.`); setF((x) => ({ ...x, name: '', phone: '' })); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>{templates.map((t) => <Chip key={t.kind} label={t.label} on={f.kind === t.kind} onPress={() => set('kind')(t.kind)} />)}</View>
      <Field label="Name" value={f.name} onChangeText={set('name')} autoCapitalize="words" placeholder="Team captain" />
      <Field label="WhatsApp number" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="98765 43210" />
      <Field label="Date" value={f.date} onChangeText={set('date')} placeholder="Sat 17 Oct" autoCapitalize="sentences" />
      <Field label="Time" value={f.time} onChangeText={set('time')} placeholder="9:00 am" />
      <Field label="Amount" value={f.amount} onChangeText={set('amount')} placeholder="₹1,500" />
      <Text style={[s.muted, { fontSize: 12, fontWeight: '600', marginBottom: 4 }]}>Message</Text>
      <View style={{ backgroundColor: C.bg, borderRadius: 12, padding: 12, marginBottom: 12 }}><Text style={[s.text, { fontSize: 14 }]}>{pre?.message || 'Fill in the details to see the message.'}</Text></View>
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Open WhatsApp" disabled={!pre?.link} onPress={() => pre?.link && onOpen(pre.link)} />
      <Btn kind="outline" label="Mark sent" disabled={!pre?.link || !f.name.trim()} onPress={log} style={{ marginBottom: 0 }} />
      {!pre?.link && <Text style={[s.muted, { marginTop: 8 }]}>Add a name and a 10-digit number to get the WhatsApp link.</Text>}
    </View>
  );
}
