import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { AppConfig, Booking, Child, Dashboard, User } from './types';
import { Badge, Btn, Chip, KV, Loading, MiniStat, ScreenHead, SectionHead, Segmented, s } from './ui';
import { AutoDebit } from './AutoDebit';
import { Waitlist } from './Waitlist';
import { MyTeamGames, TeamList } from './TeamList';
import { MyCricket } from './MyCricket';
import { PayScreen } from './PayScreen';
import { DepositScreen, RescheduleScreen, differenceAsHold } from './ManageBooking';
import type { HoldResponse } from './types';
import { C, inr, MON, niceDate } from './theme';
import { useT, type T } from './lang';

const label = (t: T, st: Booking['status']): string => ({ confirmed: t('status.confirmed'), held: t('status.held'), cancelled: t('status.cancelled'), expired: t('status.expired'), no_show: t('status.no_show'), completed: t('status.completed') }[st]);
const tone = (st: Booking['status']) => (st === 'confirmed' || st === 'completed' ? 'ok' : st === 'held' ? 'warn' : st === 'no_show' ? 'danger' : 'muted') as 'ok' | 'warn' | 'danger' | 'muted';
type Kind = 'upcoming' | 'completed' | 'cancelled' | 'all';
/** Which tab a booking sits under: still to come, played (or missed), or called off. */
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
// a multi-day booking is one card: upcoming until its last day, whatever its first day says
const kindOf = (b: Booking): Exclude<Kind, 'all'> => (b.block ? (b.block.cancelled ? 'cancelled' : b.block.toDate >= todayIst() ? 'upcoming' : 'completed')
  : b.status === 'cancelled' || b.status === 'expired' ? 'cancelled' : (b.status === 'confirmed' || b.status === 'held') && b.endAt > Date.now() ? 'upcoming' : 'completed');
const kinds = (t: T): [Kind, string][] => [['upcoming', t('me.upcoming')], ['completed', t('me.completed')], ['cancelled', t('me.cancelled')], ['all', t('me.all')]];

export function MeScreen({ onSignOut, user, start }: { onSignOut: () => void; user: User; start?: 'ground' | 'academy' }) {
  const t = useT();
  const [view, setView] = useState<'ground' | 'academy'>(start ?? 'ground');
  const [dash, setDash] = useState<Dashboard | null>(null); const [books, setBooks] = useState<Booking[]>([]); const [kids, setKids] = useState<Child[]>([]);
  const [flags, setFlags] = useState<{ deposit: boolean; reschedule: boolean; askToMove: boolean; waitlist: boolean }>({ deposit: false, reschedule: false, askToMove: false, waitlist: false });
  const [manage, setManage] = useState<{ kind: 'reschedule' | 'deposit'; b: Booking } | null>(null); const [payDiff, setPayDiff] = useState<HoldResponse | null>(null);
  const [show, setShow] = useState<Kind>('upcoming');
  const [payHold, setPayHold] = useState<HoldResponse | null>(null);
  const [kid, setKid] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setErr(''); setBusy(true);
    try {
      const [d, b, k, cfg] = await Promise.all([api<Dashboard>('/api/my/dashboard'), api<{ items: Booking[] }>('/api/bookings?limit=50&group=1'), api<{ items: Child[] }>('/api/me/children'), api<AppConfig>('/api/config')]);
      setFlags({ deposit: !!cfg.securityDepositEnabled, reschedule: !!(cfg.customerRescheduleEnabled || cfg.pricesOnEnquiry), askToMove: !!cfg.pricesOnEnquiry, waitlist: !!cfg.waitlistEnabled });
      setDash(d); setBooks(b.items); if (!b.items.some((x) => kindOf(x) === 'upcoming')) setShow((cur) => (cur === 'upcoming' ? 'all' : cur)); setKids(k.items); setKid((cur) => cur || k.items[0]?.id || '');
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
    try { const r = await api<{ cancelled: number; kept: number }>(`/api/bookings/${b.id}/cancel-series`, { method: 'POST', body: {} }); setNote([t('me.seriesCancelled', { n: r.cancelled }), r.kept ? t('me.seriesKept', { n: r.kept }) : ''].filter(Boolean).join(' ')); void load(); } catch (e: any) { setErr(e.message); }
  };
  const [confirm, setConfirm] = useState<{ b: Booking; message: string } | null>(null);
  const doCancel = async () => {
    if (!confirm) return;
    try { await api(`/api/bookings/${confirm.b.id}/cancel`, { method: 'POST', body: {} }); setNote(t('me.cancelledNote')); setConfirm(null); void load(); } catch (e: any) { setErr(e.message); setConfirm(null); }
  };

  /** Pays the exact amount a dearer move added, through the same payment path as a new booking. The server's state is read again when the person comes back. */
  const startDifference = async (b: Booking) => {
    setErr(''); setNote('');
    try { const r = await api<{ payment: HoldResponse['payment']; booking: Booking }>(`/api/bookings/${b.id}/pay-difference`, { method: 'POST', body: {} }); setManage(null); setPayDiff(differenceAsHold(r)); }
    catch (e: any) { setErr(e.message); void load(); }
  };
  // a session accepted from the waitlist is paid like any new booking
  if (payHold) return <PayScreen hold={payHold} user={user} onBack={() => { setPayHold(null); void load(); }} onDone={(_b, paid) => { setPayHold(null); setNote(paid ? t('me.paidNote') : t('me.refNote')); void load(); }} />;
  if (payDiff) return <PayScreen balance hold={payDiff} user={user} onBack={() => { setPayDiff(null); void load(); }} onDone={(_b, paid) => { setPayDiff(null); setNote(paid ? t('me.paidNote') : t('me.refNote')); void load(); }} />;
  if (manage?.kind === 'reschedule') return <RescheduleScreen booking={manage.b} onBack={() => { setManage(null); void load(); }} onPayDifference={startDifference} />;
  if (manage?.kind === 'deposit') return <DepositScreen booking={manage.b} onBack={() => setManage(null)} />;
  if (!dash) return err ? <View style={[s.screen, s.pad, { paddingTop: 60 }]}><Text style={s.err}>{err}</Text><Btn label={t('common.tryAgain')} onPress={load} /></View> : <Loading />;
  const child = kids.find((c) => c.id === kid);
  const shown = show === 'all' ? books : books.filter((b) => kindOf(b) === show);
  const maxM = Math.max(1, ...dash.byMonth.map((m) => m.spentPaise));
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow={t('me.eyebrow')} title={t('me.title')} />
      {(kids.length > 0 || view === 'academy') && <Segmented items={[['ground', t('me.ground')], ['academy', t('me.academy')]]} value={view} onChange={setView} />}
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}

      {view === 'ground' && (<>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <MiniStat n={String(dash.upcoming)} label={t('me.upcoming')} hue={0} on={show === 'upcoming'} onPress={() => setShow('upcoming')} />
          <MiniStat n={String(dash.sessions)} label={t('me.sessions')} hue={2} />
          <MiniStat n={dash.spentPaise >= 1000000 ? `₹${(dash.spentPaise / 10000000).toFixed(1)}L`.replace('.0L', 'L') : inr(dash.spentPaise)} label={t('me.spent')} hue={4} />
        </View>
        <Segmented items={kinds(t).map(([k, name]) => [k, `${name} ${k === 'all' ? books.length : books.filter((b) => kindOf(b) === k).length}`] as [Kind, string])} value={show} onChange={setShow} />
        {confirm && (<View style={[s.card, { borderColor: C.gold }]}><Text style={s.text}>{confirm.message}</Text><View style={{ height: 12 }} /><Btn label={t('me.cancelThis')} onPress={doCancel} /><Btn kind="ghost" label={t('me.keep')} onPress={() => setConfirm(null)} /></View>)}
        {books.length === 0 ? <Text style={[s.note, { marginBottom: 14 }]}>{t('me.none')}</Text> : !shown.length && <Text style={[s.note, { marginBottom: 14 }]}>{t('me.empty')}</Text>}
        {shown.map((b) => (
          <View key={b.id} style={s.card}>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 8 }}>
              <View style={{ width: 56, height: 60, borderRadius: 18, backgroundColor: kindOf(b) === 'upcoming' ? C.strong : C.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: kindOf(b) === 'upcoming' ? C.onStrong : C.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.5, lineHeight: 26 }}>{(b.block ? b.block.fromDate : b.date).slice(8, 10)}</Text>
                <Text style={{ color: kindOf(b) === 'upcoming' ? C.onStrong : C.muted, opacity: 0.75, fontSize: 11.5, fontWeight: '600' }}>{MON[Number((b.block ? b.block.fromDate : b.date).slice(5, 7)) - 1]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '700', fontSize: 16.5 }]} numberOfLines={1}>{b.groundName}</Text>
                <Text style={[s.muted, { fontSize: 13 }]}>{niceDate(b.date)} · {new Date(b.startAt + 330 * 60000).toISOString().slice(11, 16)} – {new Date(b.endAt + 330 * 60000).toISOString().slice(11, 16)}</Text>
              </View>
              <Badge label={kindOf(b) === 'upcoming' && (b.status === 'confirmed' || (!!b.block && b.status !== 'held')) ? t('status.upcoming') : label(t, b.status)} tone={tone(b.block && kindOf(b) === 'upcoming' && b.status !== 'held' ? 'confirmed' : b.status)} />
            </View>
            {!!b.block && <Text style={s.text}>{`${niceDate(b.block.fromDate)} – ${niceDate(b.block.toDate)}`} · {new Date(b.startAt + 330 * 60000).toISOString().slice(11, 16)} – {new Date(b.endAt + 330 * 60000).toISOString().slice(11, 16)} {t('me.daily')}</Text>}
            <Text style={s.muted}>{b.block ? t('me.days', { n: b.block.days }) : t(b.slotCount > 1 ? 'me.slotMany' : 'me.slotOne', { n: b.slotCount })} · {inr(b.block ? b.block.totalPaise : b.totalPaise)} · {t('me.ref', { ref: b.ref })}</Text>
            {b.block ? <Text style={s.muted}>{t('me.multiDay')}</Text> : b.seriesId ? <Text style={s.muted}>{t('me.repeatDate', { n: (b.seriesIndex ?? 0) + 1 })}</Text> : null}
            {b.block ? (!b.block.cancelled && b.block.balancePaise > 0 && <Text style={s.muted}>{t('me.balance', { amount: inr(b.block.balancePaise) })}</Text>) : b.balancePaise > 0 && b.status === 'confirmed' && <Text style={s.muted}>{t('me.balance', { amount: inr(b.balancePaise) })}</Text>}
            {(b.moveDifferenceDuePaise ?? 0) > 0 && <Text style={s.muted}>{t('me.moveDue', { amount: inr(b.moveDifferenceDuePaise!) })}</Text>}
            {(b.moveDifferenceDuePaise ?? 0) > 0 && <Btn label={t('me.payOnline', { amount: inr(b.moveDifferenceDuePaise!) })} onPress={() => startDifference(b)} style={{ marginTop: 10, marginBottom: 0 }} />}
            {flags.reschedule && b.status === 'confirmed' && b.startAt > Date.now() && !b.seriesId && <Btn kind="outline" label={flags.askToMove ? t('me.askMove') : t('me.changeTime')} onPress={() => setManage({ kind: 'reschedule', b })} style={{ marginTop: 10, marginBottom: 0 }} />}
            {flags.deposit && ['confirmed', 'completed', 'no_show'].includes(b.status) && <Btn kind="ghost" label={t('me.deposit')} onPress={() => setManage({ kind: 'deposit', b })} style={{ marginBottom: 0 }} />}
            {!b.block && ((b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now()) && <Btn kind="outline" label={t('me.cancel')} onPress={() => cancel(b)} style={{ marginTop: 10, marginBottom: 0 }} />}
            {b.seriesId && !b.block && (b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now() && <Btn kind="ghost" label={t('me.cancelRepeats')} onPress={() => cancelRepeats(b)} style={{ marginBottom: 0 }} />}
            {!b.block && b.status === 'confirmed' && b.endAt > Date.now() && <TeamList bookingId={b.id} />}
          </View>
        ))}
        <MyTeamGames />
        {flags.waitlist && <Waitlist onPay={setPayHold} />}
        {(dash.paidAheadPaise > 0 || dash.creditPaise > 0 || !!dash.firstPlayed) && <SectionHead title={t('me.yourCricket')} />}
        {(dash.paidAheadPaise > 0 || dash.creditPaise > 0 || !!dash.firstPlayed) && <View style={s.card}>
          {dash.paidAheadPaise > 0 && <KV k={t('me.paidAhead')} v={inr(dash.paidAheadPaise)} />}{dash.creditPaise > 0 && <KV k={t('me.credit')} v={inr(dash.creditPaise)} />}
          {dash.firstPlayed && <KV k={t('me.since')} v={niceDate(dash.firstPlayed)} />}
        </View>}
        <SectionHead title={t('me.career')} />
        <MyCricket />
        <SectionHead title={t('me.last12')} />
        <View style={[s.card, { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 5 }]}>
          {dash.byMonth.map((m) => (<View key={m.month} style={{ flex: 1, alignItems: 'center' }}><View style={{ width: '100%', height: Math.max(6, (m.spentPaise / maxM) * 92), backgroundColor: m.spentPaise === maxM ? C.gold : C.soft, borderRadius: 8 }} /><Text style={{ color: C.muted, fontSize: 8, marginTop: 4 }}>{MON[Number(m.month.slice(5, 7)) - 1]}</Text></View>))}
        </View>
        {dash.byGround.length > 0 && <View style={s.card}>{dash.byGround.map((g) => <KV key={g.groundId} k={t('me.groundSessions', { ground: g.groundName, n: g.sessions })} v={inr(g.spentPaise)} />)}</View>}
        <AutoDebit user={user} />
      </>)}

      {view === 'academy' && (<>
        {!kids.length && <View style={s.card}><Text style={[s.text, { fontWeight: '700' }]}>{t('me.noKid')}</Text><Text style={[s.muted, { marginTop: 4 }]}>{t('me.noKidSub')}</Text></View>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{kids.map((k) => <Chip key={k.id} label={k.name} on={k.id === kid} onPress={() => setKid(k.id)} />)}</View>
        {child && (<>
          <View style={s.card}><Text style={s.h2}>{child.name}</Text><Text style={s.muted}>{child.academy}{child.batch ? ` · ${child.batch}` : ''}</Text>
            <KV k={t('me.attendance')} v={child.attendance.percent === null ? t('me.noSessions') : t('me.attendanceOf', { present: child.attendance.present, sessions: child.attendance.sessions, pct: child.attendance.percent })} /></View>
          {child.cards.length === 0 && <Text style={s.note}>{t('me.noCards')}</Text>}
          {child.cards.map((c) => (
            <View key={c.id} style={s.card}><Text style={[s.eyebrow, { color: C.gold }]}>{MON[Number(c.month.slice(5, 7)) - 1]} {c.month.slice(0, 4)}</Text>
              {c.ratings.map((r) => <KV key={r.skill} k={r.skill} v={`${'●'.repeat(r.rating)}${'○'.repeat(Math.max(0, 5 - r.rating))}`} />)}
              {c.comment && <Text style={[s.muted, { marginTop: 8 }]}>{c.comment}</Text>}</View>
          ))}
        </>)}
      </>)}
    </ScrollView>
  );
}
