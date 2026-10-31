import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Chip, Field, Loading, Section, s, DateField, ScreenHead } from './ui';
import { C, niceDate } from './theme';

interface Settings { razorpayEnabled: boolean; bookingsOpenFrom: string; bookingsCloseFrom: string; autoDebitEnabled: boolean; autoDebitHoursBefore: number }
interface Closure { date: string; scope: 'ground' | 'practice' | 'academy'; reason: string | null }
const SCOPES: [string, string][] = [['all', 'Everything'], ['ground', 'Ground'], ['practice', 'Practice'], ['academy', 'Academy']];
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const addDays = (d: string, n: number): string => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Platform controls: when customers can book, closing days for everything or one area, and the online-payments switch. */
export function PlatformScreen() {
  const [st, setSt] = useState<Settings | null>(null); const [closed, setClosed] = useState<Closure[]>([]);
  const [openFrom, setOpenFrom] = useState(''); const [closeFrom, setCloseFrom] = useState('');
  const [scope, setScope] = useState('all'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [why, setWhy] = useState('');
  const [hours, setHours] = useState('24');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b] = await Promise.all([api<Settings>('/api/admin/settings'), api<{ items: Closure[] }>('/api/admin/closed-dates')]);
      setSt(a); setOpenFrom(a.bookingsOpenFrom ?? ''); setCloseFrom(a.bookingsCloseFrom ?? ''); setHours(String(a.autoDebitHoursBefore ?? 24)); setClosed(b.items); setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const put = async (body: Partial<Settings>, ok: string) => { setErr(''); setNote(''); try { await api('/api/admin/settings', { method: 'PUT', body }); setNote(ok); void load(); } catch (e: any) { setErr(e.message); } };
  const mark = async (val: boolean) => {
    setErr(''); setNote('');
    if (!isDate(from) || !isDate(to || from) || (to || from) < from) { setErr('Enter the days as 2026-12-25 (start, then end).'); return; }
    const end = to || from, dates: string[] = []; for (let d = from; d <= end && dates.length < 400; d = addDays(d, 1)) dates.push(d);
    try { await api('/api/admin/closed-dates', { method: 'POST', body: { dates, closed: val, reason: why.trim() || undefined, ...(scope === 'all' ? {} : { scopes: [scope] }) } }); setNote(val ? 'Days closed.' : 'Days opened.'); void load(); } catch (e: any) { setErr(e.message); }
  };
  // group the closures by day for a short readable list
  const byDay = new Map<string, Closure[]>(); for (const c of closed) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);

  if (!st) return <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}>{err ? <Text style={s.err}>{err}</Text> : <Loading />}</ScrollView>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <ScreenHead eyebrow="Platform" title="Booking controls" />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      <Section>When customers can book</Section>
      <View style={s.card}>
        <DateField label="Bookings open from" value={openFrom} onChange={setOpenFrom} placeholder="14/11/2026" />
        <Btn kind="outline" label="Save opening day" onPress={() => put({ bookingsOpenFrom: openFrom.trim() }, openFrom.trim() ? `Customers can book from ${niceDate(openFrom.trim())}.` : 'Bookings are open now.')} />
        <DateField label="Bookings closed from" value={closeFrom} onChange={setCloseFrom} placeholder="01/06/2027" />
        <Btn kind="outline" label="Save closing day" onPress={() => put({ bookingsCloseFrom: closeFrom.trim() }, closeFrom.trim() ? `Customers cannot book from ${niceDate(closeFrom.trim())}.` : 'No closing day.')} />
      </View>
      <Section>Close or open days</Section>
      <View style={s.card}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{SCOPES.map(([k, l]) => <Chip key={k} label={l} on={scope === k} onPress={() => setScope(k)} />)}</View>
        <DateField label="From day" value={from} onChange={setFrom} /><DateField label="To day (leave empty for one day)" value={to} onChange={setTo} /><Field label="Reason (optional)" value={why} onChangeText={setWhy} autoCapitalize="sentences" />
        <Btn label={scope === 'all' ? 'Close everything' : `Close ${scope}`} onPress={() => mark(true)} /><Btn kind="outline" label={scope === 'all' ? 'Open everything' : `Open ${scope}`} onPress={() => mark(false)} />
      </View>
      {[...byDay.entries()].slice(0, 40).map(([d, cs]) => (<View key={d} style={s.row}><Text style={s.text}>{niceDate(d)}</Text><View style={{ flexDirection: 'row' }}>{cs.length === 3 ? <Badge tone="danger" label="Everything" /> : cs.map((c) => <Badge key={c.scope} tone="danger" label={c.scope} />)}</View></View>))}
      {!closed.length && <Text style={s.muted}>No days are closed.</Text>}
      <Section>Online payments</Section>
      <View style={s.card}>
        <Text style={s.text}>Razorpay is {st.razorpayEnabled ? 'ON' : 'OFF'}</Text><Text style={[s.muted, { marginBottom: 8 }]}>{st.razorpayEnabled ? 'Customers pay by card, UPI or netbanking.' : 'Customers pay by UPI and staff check each payment.'}</Text>
        <Btn kind="outline" label={st.razorpayEnabled ? 'Turn Razorpay OFF' : 'Turn Razorpay ON'} onPress={() => put({ razorpayEnabled: !st.razorpayEnabled }, `Online payments are now ${!st.razorpayEnabled ? 'ON' : 'OFF'}.`)} />
      </View>
      <Section>Auto-debit</Section>
      <View style={s.card}>
        <Text style={s.text}>Auto-debit is {st.autoDebitEnabled ? 'ON' : 'OFF'}</Text>
        <Text style={[s.muted, { marginBottom: 8 }]}>Customers approve their bank once (UPI AutoPay) and the balance of each booking is charged automatically before it starts. Needs Recurring Payments on the Razorpay account; try it in test mode first.</Text>
        <Btn kind="outline" label={st.autoDebitEnabled ? 'Turn auto-debit OFF' : 'Turn auto-debit ON'} onPress={() => put({ autoDebitEnabled: !st.autoDebitEnabled }, `Auto-debit is now ${!st.autoDebitEnabled ? 'ON' : 'OFF'}.`)} />
        <Field label="Charge this many hours before the start" value={hours} onChangeText={setHours} keyboardType="number-pad" />
        <Btn kind="outline" label="Save hours" onPress={() => put({ autoDebitHoursBefore: Number(hours) || 24 }, 'Saved.')} />
      </View>
    </ScrollView>
  );
}
