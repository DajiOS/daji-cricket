import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from './api';
import { Badge, Chip, KV, Loading, Section, Segmented, Stat, Stats, s, todayIST } from './ui';
import { C, inr, niceDate } from './theme';

// All my businesses (server/src/combined.ts): the businesses the owner marked "Mine", side by side, with their branches. It only
// reads; each business keeps its own books. A business that could not be read says "Not available", never ₹0. The same view as
// Reports › All my businesses on the desk.

type Avail<T> = ({ status: 'ok' } & T) | { status: 'not_split' | 'unavailable'; why: string };
interface Books { revenuePaise: number; expensesPaise: number; netProfitPaise: number }
interface Biz {
  id: string; name: string; own: boolean; status: 'ok' | 'unavailable';
  books: Avail<Books>;
  cash: Avail<{ handedOutPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number }>;
  tasks: Avail<{ open: number; overdue: number; doneInRange: number }>;
  approvalsWaiting: Avail<{ count: number }>;
}
interface Row { businessId: string; businessName: string; areaId: string | null; areaName: string | null; restricted: boolean; spentConfirmedPaise: number; spentWaitingPaise: number; openTasks: number; overdueTasks: number }
interface Line { kind: 'spend' | 'task'; id: string; businessName: string; areaName: string | null; projectName: string | null; personName: string | null; date: string | null; title: string; amountPaise: number | null; status: string }
interface Total { currency: string; businesses: number; leftOut: string[]; books: Books | null; booksNote: string | null; handedOutPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number; openTasks: number; overdueTasks: number }
interface View_ { label: string; filters: { from: string; to: string }; options: { businesses: { id: string; name: string }[]; supported: number; areas: { id: string; name: string; businessId: string }[] }; businesses: Biz[]; byArea: Row[]; lines: Line[]; totals: Total[]; notes: string[] }

const NA = 'Not available';
const show = <T,>(a: Avail<T>, f: (x: T) => string) => (a.status === 'ok' ? f(a as T) : a.status === 'not_split' ? 'Not split' : NA);
const periodOf = (p: 'month' | 'last' | 'year'): { from: string; to: string } => {
  const t = todayIST();
  if (p === 'month') return { from: t.slice(0, 8) + '01', to: t };
  if (p === 'year') { const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return { from: `${m >= 4 ? y : y - 1}-04-01`, to: t }; }
  const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)); const last = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 0));
  return { from: d.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};

export function CombinedScreen() {
  const [period, setPeriod] = useState<'month' | 'last' | 'year'>('month');
  const [business, setBusiness] = useState('');
  const [area, setArea] = useState('');
  const [v, setV] = useState<View_ | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const p = periodOf(period);
    const q = new URLSearchParams({ ...p, ...(business ? { business } : {}), ...(area ? { area } : {}) }).toString();
    try { setV(await api<View_>(`/api/me/combined?${q}`)); setErr(''); }
    catch (e: any) { setErr(e instanceof ApiError && e.status === 403 ? 'This view is for the business owner.' : e.message); }
    finally { setBusy(false); }
  }, [period, business, area]);
  useEffect(() => { void load(); }, [load]);

  const t = v?.totals[0];
  const narrowed = !!area;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>Owner</Text><Text style={s.h1}>All my businesses</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>A combined view of the businesses you marked as yours. Each keeps its own books; nothing can be changed here.</Text>
      <Segmented items={[['month', 'This month'], ['last', 'Last month'], ['year', 'This year']]} value={period} onChange={setPeriod} />
      {v && v.options.businesses.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>
          <Chip label="All" on={!business} onPress={() => { setBusiness(''); setArea(''); }} />
          {v.options.businesses.map((b) => <Chip key={b.id} label={b.name} on={business === b.id} onPress={() => { setBusiness(b.id); setArea(''); }} />)}
        </View>)}
      {v && business && v.options.areas.some((a) => a.businessId === business) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          <Chip label="All branches" on={!area} onPress={() => setArea('')} />
          {v.options.areas.filter((a) => a.businessId === business).map((a) => <Chip key={a.id} label={a.name} on={area === a.id} onPress={() => setArea(a.id)} />)}
        </View>)}
      {!!err && <Text style={s.err}>{err}</Text>}
      {!v ? (err ? null : <Loading />) : <>
        {t && <>
          <Section>Together, {niceDate(v.filters.from)} to {niceDate(v.filters.to)}</Section>
          <Stats>
            <Stat label="Revenue in the books" value={t.books ? inr(t.books.revenuePaise) : narrowed ? 'Not split' : NA} foot={t.booksNote ?? undefined} />
            <Stat label="Expenses in the books" value={t.books ? inr(t.books.expensesPaise) : narrowed ? 'Not split' : NA} />
            <Stat label="Cash spent" value={inr(t.spentConfirmedPaise)} foot={t.spentWaitingPaise ? `${inr(t.spentWaitingPaise)} waiting` : 'Not in the books yet'} />
            <Stat label="Open jobs" value={String(t.openTasks)} foot={`${t.overdueTasks} late`} tone={t.overdueTasks ? 'danger' : undefined} />
          </Stats>
          {t.leftOut.length > 0 && <Text style={s.err}>Not available just now, so left out: {t.leftOut.join(', ')}.</Text>}
          {!narrowed && t.handedOutPaise !== 0 && <Text style={s.muted}>{inr(t.handedOutPaise)} handed to wallets: your own money moving, not spending.</Text>}
        </>}
        {v.businesses.map((b) => (
          <View key={b.id} style={s.card}>
            <View style={[s.row, { marginBottom: 6 }]}><Text style={[s.text, { fontWeight: '700' }]}>{b.name}</Text>{b.status !== 'ok' && <Badge tone="danger" label={NA} />}</View>
            <KV k="Revenue" v={show(b.books, (x) => inr(x.revenuePaise))} />
            <KV k="Expenses" v={show(b.books, (x) => inr(x.expensesPaise))} />
            <KV k="Cash spent" v={show(b.cash, (x) => `${inr(x.spentConfirmedPaise)}${x.spentWaitingPaise ? ` + ${inr(x.spentWaitingPaise)} waiting` : ''}`)} />
            <KV k="Open jobs" v={show(b.tasks, (x) => `${x.open}${x.overdue ? ` (${x.overdue} late)` : ''}`)} />
            <KV k="Approvals waiting" v={show(b.approvalsWaiting, (x) => String(x.count))} />
          </View>))}
        {v.byArea.length > 0 && <Section>By branch</Section>}
        {v.byArea.map((r) => (
          <View key={`${r.businessId}:${r.areaId ?? '-'}`} style={s.card}>
            <View style={s.row}><Text style={[s.text, { fontWeight: '700' }]}>{r.areaName ?? 'Not in a branch'}</Text>{r.restricted && <Badge tone="gold" label="Restricted" />}</View>
            <Text style={s.muted}>{r.businessName} · spent {inr(r.spentConfirmedPaise)}{r.spentWaitingPaise ? ` + ${inr(r.spentWaitingPaise)} waiting` : ''} · {r.openTasks} open{r.overdueTasks ? `, ${r.overdueTasks} late` : ''}</Text>
          </View>))}
        {v.lines.length > 0 && <Section>Lines</Section>}
        {v.lines.slice(0, 50).map((l) => (
          <View key={`${l.kind}:${l.id}`} style={s.card}>
            <View style={s.row}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{l.title}</Text>{l.amountPaise !== null && <Text style={s.text}>{inr(l.amountPaise)}</Text>}</View>
            <Text style={s.muted}>{l.kind === 'spend' ? 'Cash spend' : 'Open job'} · {[l.businessName, l.areaName, l.projectName].filter(Boolean).join(' · ')}{l.personName ? ` · ${l.personName}` : ''}{l.date ? ` · ${niceDate(l.date)}` : ''}</Text>
            {l.status === 'waiting' && <View style={{ marginTop: 6 }}><Badge tone="warn" label="Waiting for sign-off" /></View>}
          </View>))}
        {v.notes.map((n) => <Text key={n} style={[s.muted, { marginTop: 6 }]}>{n}</Text>)}
      </>}
    </ScrollView>
  );
}
