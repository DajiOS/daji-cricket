import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { PaymentRow, StaffBooking, User } from './types';
import { Badge, Btn, Chip, Field, Icon, KV, Loading, MiniStat, RoundBtn, Segmented, s, ScreenHead } from './ui';
import { C, formatPhone, inr, niceDate } from './theme';
import { BlockForm } from './BlockForm';

const hhmm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);
export type View_ = 'today' | 'upcoming' | 'approvals' | 'payments' | 'block';
const can = (u: User, perm: string) => u.role !== 'staff' || (u.permissions ?? []).includes(perm);

/** Bookings for the team: today, what is coming, approvals, and UPI payments waiting to be checked. */
export function StaffScreen({ user, start = 'today' }: { user: User; start?: View_ }) {
  const [view, setView] = useState<View_>(start);
  const [books, setBooks] = useState<StaffBooking[] | null>(null); const [pays, setPays] = useState<PaymentRow[]>([]);
  const [open, setOpen] = useState(''); const [mode, setMode] = useState<'' | 'pay' | 'cancel'>('');
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState<'cash' | 'upi' | 'card' | 'bank_transfer'>('cash');
  const [reason, setReason] = useState(''); const [offers, setOffers] = useState<string[]>(['refund', 'credit']); const [settle, setSettle] = useState<'refund' | 'credit'>('refund');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState({ awaiting: 0, review: 0 });

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      if (view === 'block') { setBooks([]); return; }
      if (view === 'payments') setPays((await api<{ items: PaymentRow[] }>('/api/staff/payments?status=submitted&limit=50')).items);
      else if (view === 'today') { const r = await api<{ bookings: StaffBooking[]; awaitingVerification: number; needsReview: number }>('/api/staff/today'); setBooks(r.bookings); setCounts({ awaiting: r.awaitingVerification, review: r.needsReview }); }
      else if (view === 'approvals') setBooks((await api<{ items: StaffBooking[] }>('/api/staff/bookings?approval=pending&limit=50')).items);
      else { const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); setBooks((await api<{ items: StaffBooking[] }>(`/api/staff/bookings?group=1&from=${today}&limit=60`)).items.filter((b) => b.status !== 'cancelled' && b.status !== 'expired')); }
    } catch (e: any) { setErr(e.message); setBooks([]); } finally { setBusy(false); }
  }, [view]);
  useEffect(() => { setBooks(null); setOpen(''); setMode(''); void load(); }, [load]);

  const run = async (path: string, body: unknown, ok: string) => {
    setErr(''); setNote('');
    try { await api(path, { method: 'POST', body }); setNote(ok); setMode(''); setOpen(''); setReason(''); void load(); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  const flip = (k: string) => setOffers((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  const card = (b: StaffBooking) => {
    const on = open === b.id, blk = b.block ?? null, money = (b.block ? b.block.paidPaise : b.paidPaise) > 0, balance = blk ? blk.balancePaise : b.balancePaise;
    return (
      <View key={b.id} style={[s.card, { paddingVertical: 14 }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${b.customerName}, ${on ? 'close' : 'open actions'}`}
          onPress={() => { setOpen(on ? '' : b.id); setMode(''); setAmount(balance > 0 ? String(balance / 100) : ''); setErr(''); }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.7 : 1 })}>
          <View style={{ width: 54 }}>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.4 }}>{blk ? niceDate(blk.fromDate) : hhmm(b.startAt)}</Text>
            <Text style={[s.muted, { fontSize: 12 }]}>{blk ? `${blk.days} days` : hhmm(b.endAt)}</Text>
          </View>
          <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: b.approval === 'pending' ? C.gold : b.status === 'cancelled' || b.status === 'no_show' ? C.danger : balance > 0 ? C.warn : C.ok }} />
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{b.customerName}</Text>
            <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={1}>{view === 'today' || blk ? '' : `${niceDate(b.date)} · `}{b.groundName}{blk ? ` · ${blk.tournament ? `${blk.tournament.name} · ` : ''}${hhmm(b.startAt)} – ${hhmm(b.endAt)} daily` : b.formatLabel ? ` · ${b.formatLabel}` : ''}</Text>
          </View>
          <Icon name={on ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginLeft: 71 }}>
          <Badge tone={b.status === 'confirmed' ? 'ok' : b.status === 'cancelled' || b.status === 'no_show' ? 'danger' : 'muted'} label={b.status.replace('_', ' ')} />
          {b.approval === 'pending' && <Badge tone="gold" label="Needs approval" />}{b.needsReview && <Badge tone="danger" label="Review" />}{!!b.promoCode && <Badge label={b.promoCode} />}
          {balance > 0 && b.status === 'confirmed' && <Badge tone="gold" label={`Balance ${inr(balance)}`} />}
        </View>
        {on && (<View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {([['Total', inr(blk ? blk.totalPaise : b.totalPaise)], ['Paid', inr(blk ? blk.paidPaise : b.paidPaise)]] as const).map(([k, v]) => (
              <View key={k} style={{ flex: 1, backgroundColor: C.soft, borderRadius: 18, padding: 12 }}><Text style={[s.muted, { fontSize: 12 }]}>{k}</Text><Text style={{ color: C.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.3 }}>{v}</Text></View>
            ))}
          </View>
          <Text style={[s.muted, { marginBottom: 8 }]}>{b.ref}{b.customerPhone ? `  ·  ${formatPhone(b.customerPhone)}` : ''}{blk ? '' : `  ·  ${niceDate(b.date)}`}</Text>
        </View>)}
        {on && !mode && (<>
          {!blk && b.approval === 'pending' && b.status !== 'cancelled' && can(user, 'manage_bookings') && <Btn label="Approve booking" onPress={() => run(`/api/staff/bookings/${b.id}/approve`, {}, 'Approved.')} />}
          {b.status === 'confirmed' && balance > 0 && can(user, 'record_payments') && <Btn kind="outline" label="Record a payment" onPress={() => setMode('pay')} />}
          {!blk && b.status === 'confirmed' && can(user, 'manage_bookings') && <Btn kind="outline" label="Mark no-show" onPress={() => run(`/api/staff/bookings/${b.id}/no-show`, {}, 'Marked as no-show.')} />}
          {b.status !== 'cancelled' && b.status !== 'expired' && can(user, 'manage_bookings') && <Btn kind="ghost" label={blk ? 'Cancel all days' : 'Cancel booking'} onPress={() => setMode('cancel')} />}
        </>)}
        {on && mode === 'pay' && (<>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{(['cash', 'upi', 'card', 'bank_transfer'] as const).map((m) => <Chip key={m} label={m.replace('_', ' ')} on={method === m} onPress={() => setMethod(m)} />)}</View>
          <Field label="Amount received (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <Btn label="Save payment" disabled={!Number(amount)} onPress={() => run(blk ? `/api/staff/bookings/block/${blk.seriesId}/payments` : `/api/staff/bookings/${b.id}/payments`, { method, amountPaise: Math.round(Number(amount) * 100) }, 'Payment recorded.')} />
          <Btn kind="ghost" label="Back" onPress={() => setMode('')} />
        </>)}
        {on && mode === 'cancel' && blk && (<>
          <Text style={s.muted}>This cancels every day that has not started. Explain why (at least 10 characters if money was paid) and choose what happens to the money.</Text>
          <Field label="Reason for the customer" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          {money && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['refund', 'Refund now'], ['credit', 'Credit now']].map(([k, l]) => <Chip key={k} label={l!} on={settle === k} onPress={() => setSettle(k as 'refund' | 'credit')} />)}</View>}
          <Btn label="Cancel all days" disabled={money && reason.trim().length < 10} onPress={() => run(`/api/staff/bookings/block/${blk.seriesId}/cancel`, { reason: reason.trim() || undefined, ...(money ? { settle } : {}) }, 'All days cancelled.')} />
          <Btn kind="ghost" label="Back" onPress={() => setMode('')} />
        </>)}
        {on && mode === 'cancel' && !blk && (<>
          {money && <Text style={s.muted}>Money has been paid on this booking. Explain why (at least 10 characters) and choose what the customer may pick: a full refund, half back, or credit. Terms and conditions apply.</Text>}
          <Field label={money ? 'Reason for the customer' : 'Reason (optional)'} value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          {money && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['refund', 'Full refund'], ['half', '50% refund'], ['credit', 'Credit']].map(([k, l]) => <Chip key={k} label={l!} on={offers.includes(k!)} onPress={() => flip(k!)} />)}</View>}
          <Btn label="Cancel this booking" disabled={money && (reason.trim().length < 10 || !offers.length)} onPress={() => run(`/api/staff/bookings/${b.id}/cancel`, { reason: reason.trim() || undefined, ...(money ? { offers } : {}) }, 'Booking cancelled.')} />
          <Btn kind="ghost" label="Back" onPress={() => setMode('')} />
        </>)}
      </View>
    );
  };

  const tabs: [View_, string][] = [['today', 'Today'], ['upcoming', 'Upcoming'], ['approvals', 'Approvals'], ['payments', 'Payments']];
  if (can(user, 'manage_bookings')) tabs.push(['block', 'Multi-day']);
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      {user.readOnly && <View style={[s.card, { marginBottom: 10 }]} accessibilityRole="summary"><Text style={s.h2}>View-only account</Text><Text style={s.muted}>You can open and read everything your role allows. Changes are switched off.</Text></View>}
      <ScreenHead eyebrow="Bookings" title={view === 'today' ? 'Today' : view === 'upcoming' ? 'Coming up' : view === 'approvals' ? 'Waiting for approval' : view === 'block' ? 'Multi-day booking' : 'Payments to check'}
        right={can(user, 'manage_bookings') && view !== 'block' ? <RoundBtn dark icon="add" label="New multi-day booking" onPress={() => setView('block')} size={42} /> : undefined} />
      <Segmented items={tabs} value={view} onChange={setView} />
      {view === 'today' && books !== null && (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <MiniStat n={String(books.length)} label="Bookings today" hue={0} />
          <MiniStat n={String(counts.awaiting)} label="Payments to check" hue={1} onPress={counts.awaiting ? () => setView('payments') : undefined} />
          <MiniStat n={String(counts.review)} label="To review" hue={4} />
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {view === 'block' ? <BlockForm onDone={(m) => { setNote(m); setView('upcoming'); }} /> : view === 'payments' ? (!pays.length ? <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}><Icon name="checkmark-circle-outline" size={28} color={C.ok} /><Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>Nothing waiting. All UPI payments are checked.</Text></View> : pays.map((p) => (
        <View key={p.id} style={s.card}>
          <Text style={[s.muted, { fontSize: 12.5 }]}>{p.purpose}</Text>
          <Text style={{ color: C.text, fontSize: 30, fontWeight: '600', letterSpacing: -0.8, marginBottom: 6 }}>{inr(p.amountPaise)}</Text>
          <View style={{ backgroundColor: C.soft, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10 }}><KV k="UPI reference" v={p.reference ?? 'none'} /></View>
          {can(user, 'verify_payments') && (<><Btn label="Money received" onPress={() => run(`/api/staff/payments/${p.id}/verify`, { approve: true }, 'Payment confirmed.')} /><Btn kind="outline" label="Not received" onPress={() => run(`/api/staff/payments/${p.id}/verify`, { approve: false, reason: 'Money not found in the account' }, 'Payment rejected.')} /></>)}
        </View>
      ))) : books === null ? <Loading /> : !books.length ? <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}><Icon name="calendar-outline" size={28} color={C.muted} /><Text style={[s.muted, { marginTop: 8 }]}>Nothing here.</Text></View> : books.map(card)}
    </ScrollView>
  );
}
