import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from './api';
import type { AppConfig, Booking, Child, Dashboard, User } from './types';
import { Btn, Chip, KV, Loading, s } from './ui';
import { AutoDebit } from './AutoDebit';
import { PayScreen } from './PayScreen';
import { DepositScreen, RescheduleScreen, differenceAsHold } from './ManageBooking';
import type { HoldResponse } from './types';
import { C, inr, MON, niceDate } from './theme';

const label = (st: Booking['status']): string => ({ confirmed: 'Confirmed', held: 'Held', cancelled: 'Cancelled', expired: 'Expired', no_show: 'No show', completed: 'Played' }[st]);

export function MeScreen({ onSignOut, user }: { onSignOut: () => void; user: User }) {
  const [view, setView] = useState<'ground' | 'academy'>('ground');
  const [dash, setDash] = useState<Dashboard | null>(null); const [books, setBooks] = useState<Booking[]>([]); const [kids, setKids] = useState<Child[]>([]);
  const [flags, setFlags] = useState<{ deposit: boolean; reschedule: boolean }>({ deposit: false, reschedule: false });
  const [manage, setManage] = useState<{ kind: 'reschedule' | 'deposit'; b: Booking } | null>(null); const [payDiff, setPayDiff] = useState<HoldResponse | null>(null);
  const [kid, setKid] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setErr(''); setBusy(true);
    try {
      const [d, b, k, cfg] = await Promise.all([api<Dashboard>('/api/my/dashboard'), api<{ items: Booking[] }>('/api/bookings?limit=50'), api<{ items: Child[] }>('/api/me/children'), api<AppConfig>('/api/config')]);
      setFlags({ deposit: !!cfg.securityDepositEnabled, reschedule: !!cfg.customerRescheduleEnabled });
      setDash(d); setBooks(b.items); setKids(k.items); setKid((cur) => cur || k.items[0]?.id || '');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cancel = async (b: Booking) => {
    setErr(''); setNote('');
    try {
      const pv = await api<{ message: string; kind: 'free' | 'credit' | 'none' }>(`/api/bookings/${b.id}/cancel-preview`);
      setConfirm({ b, message: pv.message });
    } catch (e: any) { setErr(e.message); }
  };
  const cancelRepeats = async (b: Booking) => {
    setErr(''); setNote('');
    try { const r = await api<{ cancelled: number; kept: number }>(`/api/bookings/${b.id}/cancel-series`, { method: 'POST', body: {} }); setNote(`${r.cancelled} dates cancelled${r.kept ? `, ${r.kept} paid date kept` : ''}.`); void load(); } catch (e: any) { setErr(e.message); }
  };
  const [confirm, setConfirm] = useState<{ b: Booking; message: string } | null>(null);
  const doCancel = async () => {
    if (!confirm) return;
    try { await api(`/api/bookings/${confirm.b.id}/cancel`, { method: 'POST', body: {} }); setNote('Booking cancelled.'); setConfirm(null); void load(); } catch (e: any) { setErr(e.message); setConfirm(null); }
  };

  /** Pays the exact amount a dearer move added, through the same payment path as a new booking. The server's state is read again when the person comes back. */
  const startDifference = async (b: Booking) => {
    setErr(''); setNote('');
    try { const r = await api<{ payment: HoldResponse['payment']; booking: Booking }>(`/api/bookings/${b.id}/pay-difference`, { method: 'POST', body: {} }); setManage(null); setPayDiff(differenceAsHold(r)); }
    catch (e: any) { setErr(e.message); void load(); }
  };
  if (payDiff) return <PayScreen balance hold={payDiff} user={user} onBack={() => { setPayDiff(null); void load(); }} onDone={(_b, paid) => { setPayDiff(null); setNote(paid ? 'Payment received. Thank you.' : 'Reference sent. The ground will check it and confirm.'); void load(); }} />;
  if (manage?.kind === 'reschedule') return <RescheduleScreen booking={manage.b} onBack={() => { setManage(null); void load(); }} onPayDifference={startDifference} />;
  if (manage?.kind === 'deposit') return <DepositScreen booking={manage.b} onBack={() => setManage(null)} />;
  if (!dash) return err ? <View style={[s.screen, s.pad, { paddingTop: 60 }]}><Text style={s.err}>{err}</Text><Btn label="Try again" onPress={load} /></View> : <Loading />;
  const child = kids.find((c) => c.id === kid);
  const maxM = Math.max(1, ...dash.byMonth.map((m) => m.spentPaise));
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>My dashboard</Text>
      {kids.length > 0 && (<View style={{ flexDirection: 'row', marginBottom: 10 }}><Chip label="Ground" on={view === 'ground'} onPress={() => setView('ground')} /><Chip label="Academy" on={view === 'academy'} onPress={() => setView('academy')} /></View>)}
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}

      {view === 'ground' && (<>
        <View style={s.card}>
          <KV k="Spent at the ground" v={inr(dash.spentPaise)} bold /><KV k="Sessions played" v={String(dash.sessions)} /><KV k="Upcoming" v={String(dash.upcoming)} />
          {dash.paidAheadPaise > 0 && <KV k="Paid ahead" v={inr(dash.paidAheadPaise)} />}{dash.creditPaise > 0 && <KV k="Account credit" v={inr(dash.creditPaise)} />}
          {dash.firstPlayed && <KV k="Playing with us since" v={niceDate(dash.firstPlayed)} />}
        </View>
        <Text style={s.h2}>Last 12 months</Text>
        <View style={[s.card, { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 4 }]}>
          {dash.byMonth.map((m) => (<View key={m.month} style={{ flex: 1, alignItems: 'center' }}><View style={{ width: '100%', height: Math.max(2, (m.spentPaise / maxM) * 80), backgroundColor: C.gold, borderRadius: 2 }} /><Text style={{ color: C.muted, fontSize: 8, marginTop: 4 }}>{MON[Number(m.month.slice(5, 7)) - 1]}</Text></View>))}
        </View>
        {dash.byGround.length > 0 && <View style={s.card}>{dash.byGround.map((g) => <KV key={g.groundId} k={`${g.groundName} · ${g.sessions} sessions`} v={inr(g.spentPaise)} />)}</View>}
        <AutoDebit user={user} />
        <Text style={s.h2}>Your bookings</Text>
        {confirm && (<View style={[s.card, { borderColor: C.gold }]}><Text style={s.text}>{confirm.message}</Text><View style={{ height: 12 }} /><Btn label="Cancel this booking" onPress={doCancel} /><Btn kind="ghost" label="Keep it" onPress={() => setConfirm(null)} /></View>)}
        {books.length === 0 && <Text style={s.muted}>No bookings yet.</Text>}
        {books.map((b) => (
          <View key={b.id} style={s.card}>
            <View style={s.row}><Text style={s.text}>{b.groundName}</Text><Text style={[s.muted, { color: b.status === 'confirmed' ? C.ok : C.muted }]}>{label(b.status)}</Text></View>
            <Text style={s.muted}>{niceDate(b.date)} · {new Date(b.startAt + 330 * 60000).toISOString().slice(11, 16)} · {b.slotCount} slot{b.slotCount > 1 ? 's' : ''} · {inr(b.totalPaise)}</Text>
            {b.seriesId ? <Text style={s.muted}>Repeat booking · date {(b.seriesIndex ?? 0) + 1}</Text> : null}
            {b.balancePaise > 0 && b.status === 'confirmed' && <Text style={s.muted}>Balance at the ground: {inr(b.balancePaise)}</Text>}
            {(b.moveDifferenceDuePaise ?? 0) > 0 && <Text style={s.muted}>{inr(b.moveDifferenceDuePaise!)} of it is for your move and can be paid online.</Text>}
            {(b.moveDifferenceDuePaise ?? 0) > 0 && <Btn label={`Pay ${inr(b.moveDifferenceDuePaise!)} online`} onPress={() => startDifference(b)} style={{ marginTop: 10, marginBottom: 0 }} />}
            {flags.reschedule && b.status === 'confirmed' && b.startAt > Date.now() && !b.seriesId && <Btn kind="outline" label="Change time" onPress={() => setManage({ kind: 'reschedule', b })} style={{ marginTop: 10, marginBottom: 0 }} />}
            {flags.deposit && ['confirmed', 'completed', 'no_show'].includes(b.status) && <Btn kind="ghost" label="Security deposit" onPress={() => setManage({ kind: 'deposit', b })} style={{ marginBottom: 0 }} />}
            {((b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now()) && <Btn kind="outline" label="Cancel" onPress={() => cancel(b)} style={{ marginTop: 10, marginBottom: 0 }} />}
            {b.seriesId && (b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now() && <Btn kind="ghost" label="Cancel unpaid repeats" onPress={() => cancelRepeats(b)} style={{ marginBottom: 0 }} />}
          </View>
        ))}
      </>)}

      {view === 'academy' && (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{kids.map((k) => <Chip key={k.id} label={k.name} on={k.id === kid} onPress={() => setKid(k.id)} />)}</View>
        {child && (<>
          <View style={s.card}><Text style={s.h2}>{child.name}</Text><Text style={s.muted}>{child.academy}{child.batch ? ` · ${child.batch}` : ''}</Text>
            <KV k="Attendance" v={child.attendance.percent === null ? 'No sessions yet' : `${child.attendance.present} of ${child.attendance.sessions} (${child.attendance.percent}%)`} /></View>
          {child.cards.length === 0 && <Text style={s.muted}>No progress cards have been shared yet.</Text>}
          {child.cards.map((c) => (
            <View key={c.id} style={s.card}><Text style={s.eyebrow}>{MON[Number(c.month.slice(5, 7)) - 1]} {c.month.slice(0, 4)}</Text>
              {c.ratings.map((r) => <KV key={r.skill} k={r.skill} v={`${'●'.repeat(r.rating)}${'○'.repeat(Math.max(0, 5 - r.rating))}`} />)}
              {c.comment && <Text style={[s.muted, { marginTop: 8 }]}>{c.comment}</Text>}</View>
          ))}
        </>)}
      </>)}
      <Btn kind="ghost" label="Sign out" onPress={onSignOut} style={{ marginTop: 20 }} />
    </ScrollView>
  );
}
