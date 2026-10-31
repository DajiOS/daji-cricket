import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Empty, Field, Loading, Segmented, s, ScreenHead } from './ui';
import { C, inr } from './theme';

interface Refund { id: string; bookingId: string; amountPaise: number; status: string; mode: 'gateway' | 'manual'; reference: string | null; reason: string | null; createdAt: number; completedAt: number | null; approvedAt: number | null; paymentMethod: string | null }
const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const VIEWS: [string, string][] = [['awaiting', 'Waiting for you'], ['pending', 'Authorised, not paid yet'], ['done', 'Paid back'], ['failed', 'Declined or failed']];

/** Every refund waits for the super admin before any money moves. */
export function RefundsScreen() {
  const [view, setView] = useState('awaiting');
  const [items, setItems] = useState<Refund[] | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const [declining, setDeclining] = useState(''); const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = (await api<{ items: Refund[] }>(`/api/admin/refunds?status=${view}`)).items;
      setItems(view === 'pending' ? r.filter((x) => x.approvedAt) : r); // pending also holds the ones still waiting
      setErr('');
    } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [view]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  const act = async (id: string, path: 'approve' | 'decline', body: object, msg: string) => {
    setErr(''); setNote(''); setWorking(id);
    try { await api(`/api/admin/refunds/${id}/${path}`, { method: 'POST', body }); setNote(msg); setDeclining(''); setReason(''); void load(); } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Money" title="Refunds" about="Nothing is paid back until you authorise it. Online refunds go back to the card or UPI within a minute of approval; UPI and cash refunds are then paid by staff and marked done." />
      <Segmented items={VIEWS.map(([k, label]) => [k, label] as [typeof k, string])} value={view} onChange={setView} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {items === null ? <Loading /> : !items.length ? <Empty icon="return-down-back-outline" text={view === 'awaiting' ? 'No refunds are waiting.' : 'Nothing here.'} /> : items.map((r) => (
        <View key={r.id} style={s.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[s.text, { fontWeight: '700', fontSize: 18 }]}>{inr(r.amountPaise)}</Text>
            <Text style={s.muted}>{when(r.createdAt)}</Text>
          </View>
          <Text style={[s.muted, { marginTop: 4 }]}>{r.mode === 'gateway' ? 'Back to the card or UPI through Razorpay' : `Paid by hand${r.paymentMethod ? ` (paid by ${r.paymentMethod})` : ''}`}</Text>
          {!!r.reason && <Text style={[s.text, { marginTop: 6, fontSize: 14 }]}>{r.reason}</Text>}
          {!!r.reference && <Text style={[s.muted, { marginTop: 4 }]}>Reference {r.reference}</Text>}
          {view !== 'awaiting' && <View style={{ flexDirection: 'row', marginTop: 6 }}><Badge label={r.status === 'done' ? 'Paid back' : r.status === 'failed' ? 'Declined or failed' : 'Authorised'} tone={r.status === 'done' ? 'ok' : r.status === 'failed' ? 'danger' : 'gold'} /></View>}
          {view === 'awaiting' && (declining === r.id ? (
            <View style={{ marginTop: 10 }}>
              <Field label="Why is it declined?" value={reason} onChangeText={setReason} autoCapitalize="sentences" maxLength={200} />
              <Btn label="Decline refund" busy={working === r.id} disabled={!reason.trim()} onPress={() => act(r.id, 'decline', { reason: reason.trim() }, 'Refund declined.')} />
              <Btn kind="ghost" label="Back" onPress={() => { setDeclining(''); setReason(''); }} />
            </View>
          ) : (
            <View style={{ marginTop: 10 }}>
              <Btn label={`Authorise ${inr(r.amountPaise)}`} busy={working === r.id} onPress={() => act(r.id, 'approve', {}, 'Refund authorised.')} />
              <Btn kind="ghost" label="Decline" onPress={() => { setDeclining(r.id); setReason(''); }} />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
