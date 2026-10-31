import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Loading, Segmented, s, ScreenHead, Empty } from './ui';
import { C, formatPhone, inr } from './theme';

interface Row { id: string; title: string; sub?: string; right?: string; tag?: string; bad?: boolean }
interface Sec { id: string; label: string; path: string; head?: (r: any) => string; rows: (r: any) => Row[] }

/** 2026-01-10 as 10/01/2026. */
const day = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const words = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const SECTIONS: Sec[] = [
  {
    id: 'tournaments', label: 'Tournaments', path: '/api/staff/tournaments',
    rows: (r) => (r.items ?? []).map((t: any) => ({ id: t.id, title: t.name, sub: `${day(t.startDate)} to ${day(t.endDate)}  ·  ${t.teamCount} teams, ${t.playedCount} of ${t.fixtureCount} played${t.booking ? `  ·  ground ${inr(t.booking.paidPaise)} of ${inr(t.booking.totalPaise)} paid` : ''}`, right: inr(t.entryFeePaise) + ' entry', tag: words(String(t.status)) })),
  },
  {
    id: 'memberships', label: 'Memberships', path: '/api/desk/memberships/members',
    head: (r) => `${r.total ?? (r.items ?? []).length} members`,
    rows: (r) => (r.items ?? []).map((m: any) => ({ id: m.id, title: m.name, sub: `${m.planName}  ·  ${day(m.startDate)} to ${day(m.endDate)}  ·  ${formatPhone(m.phone)}`, right: inr(m.paidPaise), tag: words(String(m.status)), bad: m.status === 'expired' })),
  },
  {
    id: 'contacts', label: 'Contacts', path: '/api/staff/contacts?limit=100',
    head: (r) => `${r.total ?? (r.items ?? []).length} people`,
    rows: (r) => (r.items ?? []).map((c: any) => ({ id: c.id, title: c.name, sub: `${[formatPhone(c.phone), c.email].filter(Boolean).join('  ·  ')}  ·  played ${c.timesPlayed} time${c.timesPlayed === 1 ? '' : 's'}`, right: inr(c.paidPaise) })),
  },
  {
    id: 'bills', label: 'Bills', path: '/api/accounting/bills?limit=100',
    head: (r) => (r.stats ? `Overdue ${inr(r.stats.overduePaise)}  ·  waiting for approval ${inr(r.stats.pendingPaise)}  ·  approved, unpaid ${inr(r.stats.approvedPaise)}` : ''),
    rows: (r) => (r.items ?? []).map((b: any) => ({ id: b.id, title: b.vendorName, sub: `${b.billNo ? 'Bill ' + b.billNo + '  ·  ' : ''}due ${day(b.dueDate)}${b.categoryName ? '  ·  ' + b.categoryName : ''}`, right: inr(b.amountPaise), tag: b.overdue && b.status !== 'paid' ? 'Overdue' : words(String(b.status)), bad: !!b.overdue && b.status !== 'paid' })),
  },
  {
    id: 'transactions', label: 'Transactions', path: '/api/accounting/transactions?limit=100',
    head: (r) => (r.moneyInPaise != null ? `Money in ${inr(r.moneyInPaise)}  ·  money out ${inr(r.moneyOutPaise)}` : ''),
    rows: (r) => (r.items ?? []).map((t: any) => ({ id: t.id, title: t.description, sub: `${day(t.date)}${t.reference ? '  ·  ' + t.reference : ''}`, right: (t.amountPaise < 0 ? '- ' : '+ ') + inr(Math.abs(t.amountPaise)), bad: t.amountPaise < 0 })),
  },
];

/** Everything the website's desk lists, readable on the phone. Looks at the owner chosen under More. */
export function DeskScreen() {
  const [sec, setSec] = useState<Sec>(SECTIONS[0]!);
  const [data, setData] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api<any>(sec.path)); setErr(''); } catch (e: any) { setData(null); setErr(e.message); } finally { setBusy(false); }
  }, [sec]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const rows = data ? sec.rows(data) : [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Desk" title={sec.label} />
      <Segmented items={SECTIONS.map((x) => [x.id, x.label] as [string, string])} value={sec.id} onChange={(id) => setSec(SECTIONS.find((x) => x.id === id) ?? sec)} />
      {!!err && <Text style={s.err}>{err}</Text>}
      {!data ? (err ? null : <Loading />) : (<>
        {!!sec.head && !!sec.head(data) && <Text style={[s.muted, { marginBottom: 10 }]}>{sec.head(data)}</Text>}
        {!rows.length && <Empty icon="albums-outline" text="Nothing here yet." />}
        {rows.map((r) => (
          <View key={r.id} style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[s.text, { fontWeight: '700', flex: 1, marginRight: 8 }]}>{r.title}</Text>
              {!!r.right && <Text style={[s.text, r.bad ? { color: C.danger } : null]}>{r.right}</Text>}
            </View>
            {!!r.sub && <Text style={[s.muted, { marginTop: 4 }]}>{r.sub}</Text>}
            {!!r.tag && <View style={{ flexDirection: 'row', marginTop: 6 }}><Badge label={r.tag} tone={r.bad ? 'danger' : 'muted'} /></View>}
          </View>
        ))}
      </>)}
    </ScrollView>
  );
}
