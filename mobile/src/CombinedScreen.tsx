import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from './api';
import { Avatar, Badge, Btn, Chip, Icon, KV, Loading, Section, Segmented, s, todayIST, ScreenHead } from './ui';
import { C, inr, niceDate } from './theme';

// All my businesses (server/src/combined.ts): the businesses the owner marked "Mine", side by side, with their branches. It only
// reads; each business keeps its own books. A business that could not be read says "Not available", never ₹0. The same view as
// Reports › All my businesses on the desk.

type Avail<T> = ({ status: 'ok' } & T) | { status: 'not_split' | 'unavailable'; why: string };
interface Books { revenuePaise: number; expensesPaise: number; netProfitPaise: number }
interface Biz {
  id: string; name: string; own: boolean; status: 'ok' | 'unavailable';
  books: Avail<Books>;
  cash: Avail<{ handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number }>;
  tasks: Avail<{ open: number; overdue: number; doneInRange: number }>;
  approvalsWaiting: Avail<{ count: number }>;
}
interface Row { businessId: string; businessName: string; areaId: string | null; areaName: string | null; restricted: boolean; spentConfirmedPaise: number; spentWaitingPaise: number; openTasks: number; overdueTasks: number }
interface Line { kind: 'spend' | 'task'; id: string; businessName: string; areaName: string | null; projectName: string | null; personName: string | null; date: string | null; title: string; amountPaise: number | null; status: string }
interface Part<T> { value: T | null; leftOut: string[]; partial: boolean; notSplit: boolean }
interface Total { currency: string; books: Part<Books>; cash: Part<{ handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number }>; tasks: Part<{ open: number; overdue: number; done: number }>; leftOut: string[]; booksNote: string | null }
interface View_ { label: string; filters: { from: string; to: string }; options: { businesses: { id: string; name: string }[]; supported: number; areas: { id: string; name: string; businessId: string }[] }; businesses: Biz[]; byArea: Row[]; lines: Line[]; linesCut: boolean; totals: Total[]; notes: string[] }

const NA = 'Not available';
/** Cash handed to wallets and cash given back, each as itself: a return may be for an advance from before these dates. */
const moves = (c: { handedOutPaise: number; returnedPaise: number }) =>
  [c.handedOutPaise ? `${inr(c.handedOutPaise)} handed to wallets` : '', c.returnedPaise ? `${inr(c.returnedPaise)} given back` : ''].filter(Boolean).join(', ') + ' in these dates';
/** A part of the total: its figure, "Not split" or "Not available" (never ₹0), and "partial" when some business is left out. */
const partValue = <T,>(p: Part<T>, f: (x: T) => string) => (p.notSplit ? 'Not split' : p.value === null ? NA : f(p.value) + (p.partial ? ' (partial)' : ''));
const partFoot = <T,>(p: Part<T>, ok: string | undefined) => (p.partial ? `Leaves out ${p.leftOut.join(', ')}` : p.value === null && !p.notSplit ? 'Could not be read just now' : ok);
const PAGE = 50;
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
  // the business and branch choices from the last good answer: they stay on screen while a new selection loads or after it fails
  const [opts, setOpts] = useState<View_['options'] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [howOpen, setHowOpen] = useState(false);
  // each request has a number; an answer to an older one (the owner tapped another filter meanwhile) is thrown away
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true); setShown(PAGE);
    // the figures on screen belong to the old selection: clear them, so a slow or failed load never shows them under the new one
    setV(null); setErr('');
    const p = periodOf(period);
    const q = new URLSearchParams({ ...p, ...(business ? { business } : {}), ...(area ? { area } : {}) }).toString();
    try { const r = await api<View_>(`/api/me/combined?${q}`); if (mine === seq.current) { setV(r); setOpts(r.options); } }
    catch (e: any) { if (mine === seq.current) setErr(e instanceof ApiError && e.status === 403 ? 'This view is for the business owner.' : `Could not load these figures: ${e.message}`); }
    finally { if (mine === seq.current) setBusy(false); }
  }, [period, business, area]);
  useEffect(() => { void load(); }, [load]);

  const t = v?.totals[0];
  const narrowed = !!area;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Owner" title="All my businesses" about="The businesses you marked as yours, together. Read only: each keeps its own books." />
      <Segmented items={[['month', 'This month'], ['last', 'Last month'], ['year', 'This year']]} value={period} onChange={setPeriod} />
      {opts && opts.businesses.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>
          <Chip label="All" on={!business} onPress={() => { setBusiness(''); setArea(''); }} />
          {opts.businesses.map((b) => <Chip key={b.id} label={b.name} on={business === b.id} onPress={() => { setBusiness(b.id); setArea(''); }} />)}
        </View>)}
      {opts && business && opts.areas.some((a) => a.businessId === business) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          <Chip label="All branches" on={!area} onPress={() => setArea('')} />
          {opts.areas.filter((a) => a.businessId === business).map((a) => <Chip key={a.id} label={a.name} on={area === a.id} onPress={() => setArea(a.id)} />)}
        </View>)}
      {!!err && <>
        <Text style={s.err}>{err}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>
          <Btn kind="outline" label="Try again" onPress={load} />
          {(!!business || !!area || period !== 'month') && <Btn kind="outline" label="Back to all businesses" onPress={() => { setBusiness(''); setArea(''); setPeriod('month'); }} />}
        </View>
      </>}
      {!v ? (err ? null : <Loading />) : <>
        {t && <>
          <Section>Together, {niceDate(v.filters.from)} to {niceDate(v.filters.to)}</Section>
          <View style={{ borderRadius: 32, overflow: 'hidden', backgroundColor: C.ink, padding: 22, marginBottom: 14 }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' }}>Revenue in the books</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 42, fontWeight: '600', letterSpacing: -1, marginTop: 4 }}>{partValue(t.books, (x) => inr(x.revenuePaise))}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' }}>Expenses {partValue(t.books, (x) => inr(x.expensesPaise))}</Text>
            {!!t.booksNote && <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12 }}>{t.booksNote}</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {([
                ['Cash spent', partValue(t.cash, (x) => inr(x.spentConfirmedPaise)), partFoot(t.cash, t.cash.value?.spentWaitingPaise ? `${inr(t.cash.value.spentWaitingPaise)} waiting` : 'Not in the books yet'), false],
                ['Open jobs', partValue(t.tasks, (x) => String(x.open)), partFoot(t.tasks, t.tasks.value ? `${t.tasks.value.overdue} late` : undefined), !!t.tasks.value?.overdue],
              ] as [string, string, string | undefined, boolean][]).map(([label, value, foot, hot]) => (
                <View key={label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 22, padding: 14 }}>
                  <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12, fontWeight: '600' }}>{label}</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6} style={{ color: hot ? '#F28C38' : '#FFFFFF', fontSize: 20, fontWeight: '600', letterSpacing: -0.4, marginTop: 4 }}>{value}</Text>
                  {!!foot && <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 }}>{foot}</Text>}
                </View>
              ))}
            </View>
          </View>
          {t.leftOut.length > 0 && <Text style={s.err}>Not available just now, so left out: {t.leftOut.join('; ')}.</Text>}
          {!narrowed && !!t.cash.value && (!!t.cash.value.handedOutPaise || !!t.cash.value.returnedPaise) && <Text style={[s.muted, { marginBottom: 4 }]}>{moves(t.cash.value)}{t.cash.partial ? ' (partial)' : ''}: your own money moving, not spending.</Text>}
          <Section>Each business</Section>
        </>}
        {v.businesses.map((b) => (
          <View key={b.id} style={s.card}>
            <View style={[s.row, { marginBottom: 6, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}><Avatar name={b.name} size={34} /><Text style={[s.text, { fontWeight: '700', fontSize: 16, flex: 1 }]} numberOfLines={1}>{b.name}</Text></View>
              {b.status !== 'ok' && <Badge tone="danger" label={NA} />}
            </View>
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
        {v.lines.length > 0 && <Text style={s.muted}>Showing {Math.min(shown, v.lines.length)} of {v.lines.length}{v.linesCut ? ' (the list from the server is cut short too: narrow the dates or filters to see the rest)' : ''}.</Text>}
        {v.lines.slice(0, shown).map((l) => (
          <View key={`${l.kind}:${l.id}`} style={s.card}>
            <View style={s.row}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{l.title}</Text>{l.amountPaise !== null && <Text style={s.text}>{inr(l.amountPaise)}</Text>}</View>
            <Text style={s.muted}>{l.kind === 'spend' ? 'Cash spend' : 'Open job'} · {[l.businessName, l.areaName, l.projectName].filter(Boolean).join(' · ')}{l.personName ? ` · ${l.personName}` : ''}{l.date ? ` · ${niceDate(l.date)}` : ''}</Text>
            {l.status === 'waiting' && <View style={{ marginTop: 6 }}><Badge tone="warn" label="Waiting for sign-off" /></View>}
          </View>))}
        {v.lines.length > shown && <Btn kind="outline" label={`Show ${Math.min(PAGE, v.lines.length - shown)} more`} onPress={() => setShown((n) => n + PAGE)} />}
        {v.notes.length > 0 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: howOpen }} onPress={() => setHowOpen(!howOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingVertical: 6 }}>
          <Icon name="information-circle-outline" size={18} color={C.muted} /><Text style={[s.muted, { fontWeight: '600', flex: 1 }]}>How this is counted</Text><Icon name={howOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
        </Pressable>}
        {howOpen && v.notes.map((n) => <Text key={n} style={[s.muted, { marginTop: 6, fontSize: 12.5 }]}>{n}</Text>)}
      </>}
    </ScrollView>
  );
}
