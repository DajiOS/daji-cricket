import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Chip, Loading, Stat, Stats, s, todayIST, ScreenHead, Empty } from './ui';
import { C, MON, inr } from './theme';

const CATS: Record<string, string> = { hosting: 'Hosting', domain: 'Domain', website: 'Website', payments: 'Payments', messaging: 'Messages', banking: 'Bank feeds', ai: 'AI', app: 'App stores', tools: 'Tools', other: 'Other' };
const CYCLES: Record<string, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly', usage: 'By usage', one_time: 'One time' };
const STATUS: Record<string, [string, 'ok' | 'danger' | 'muted']> = { paid: ['Paid', 'ok'], due: ['To pay', 'danger'], expected: ['Expected', 'muted'] };
const money = (minor: number, cur: string) => (cur === 'USD' ? `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : inr(minor));
const day = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '-');

interface Billing { summary: { thisMonthPaise: number; last12MonthsPaise: number; yearlyRunRatePaise: number; oneTimePaise: number; gstPaise: number; perBookingPaise: number | null; bookingsLast12: number; months: { month: string; totalPaise: number }[] }; services: { id: string; name: string; vendor: string | null; category: string; cycle: string; currency: string; expectedMinor: number | null; gstPercent: number; source: string; nextDue: string | null; active: boolean; totalInrPaise: number }[] }
interface Invoice { id: string; serviceName: string; invoiceNo: string | null; invoiceDate: string; currency: string; amountMinor: number; gstMinor: number; inrPaise: number; status: 'paid' | 'due' | 'expected'; paidOn: string | null }

/** What the platform pays for its software and services: totals, the last 12 months, each service and its invoices. */
export function CostsScreen() {
  const [d, setD] = useState<Billing | null>(null); const [inv, setInv] = useState<Invoice[]>([]); const [tab, setTab] = useState<'invoices' | 'services'>('invoices');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try { const [b, i] = await Promise.all([api<Billing>('/api/admin/billing'), api<{ items: Invoice[] }>('/api/admin/billing/invoices')]); setD(b); setInv(i.items); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const paid = async (i: Invoice) => {
    setErr(''); setNote(''); setWorking(i.id);
    try { await api(`/api/admin/billing/invoices/${i.id}`, { method: 'PATCH', body: { status: 'paid', paidOn: todayIST() } }); setNote(`${i.serviceName} marked paid.`); void load(); } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  const sm = d?.summary; const max = Math.max(1, ...(sm?.months ?? []).map((m) => m.totalPaise));
  const open = inv.filter((i) => i.status !== 'paid');
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Money" title="Software costs" about="What the platform pays for hosting, messages, payments and other services. Add services and invoices on the desk under Platform." />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginVertical: 6 }]}>{note}</Text>}
      {!d || !sm ? (err ? null : <Loading />) : (<>
        <View style={{ height: 12 }} />
        <Stats>
          <Stat label="This month" value={inr(sm.thisMonthPaise)} foot="invoices dated this month" />
          <Stat label="Last 12 months" value={inr(sm.last12MonthsPaise)} foot={`${inr(sm.gstPaise)} GST`} />
          <Stat label="Yearly run rate" value={inr(sm.yearlyRunRatePaise)} foot="plans plus usage" />
          <Stat label="Per booking" value={sm.perBookingPaise === null ? '-' : inr(sm.perBookingPaise)} foot={`${sm.bookingsLast12} bookings in 12 months`} />
        </Stats>
        <View style={s.card}>
          <Text style={s.h2}>Last 12 months</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 4 }}>
            {sm.months.map((m) => (
              <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
                <View style={{ width: '100%', height: Math.max(2, (m.totalPaise / max) * 76), backgroundColor: m.totalPaise ? C.gold : C.line, borderRadius: 3 }} />
                <Text style={{ color: C.muted, fontSize: 9, marginTop: 4 }}>{MON[Number(m.month.slice(5, 7)) - 1]?.slice(0, 1)}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <Chip label={open.length ? `Invoices (${open.length} open)` : 'Invoices'} on={tab === 'invoices'} onPress={() => setTab('invoices')} />
          <Chip label={`Services (${d.services.length})`} on={tab === 'services'} onPress={() => setTab('services')} />
        </View>
        {tab === 'invoices' ? (!inv.length ? <Empty icon="receipt-outline" text="No invoices yet." /> : inv.map((i) => (
          <View key={i.id} style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[s.text, { fontWeight: '700', flex: 1, marginRight: 8 }]}>{i.serviceName}</Text>
              <Text style={s.text}>{money(i.amountMinor + i.gstMinor, i.currency)}</Text>
            </View>
            <Text style={[s.muted, { marginTop: 4 }]}>{day(i.invoiceDate)}{i.invoiceNo ? `  ·  No. ${i.invoiceNo}` : ''}{i.currency === 'USD' ? `  ·  ${inr(i.inrPaise)}` : ''}{i.paidOn ? `  ·  paid ${day(i.paidOn)}` : ''}</Text>
            <View style={{ flexDirection: 'row', marginTop: 6 }}><Badge label={STATUS[i.status]?.[0] ?? i.status} tone={STATUS[i.status]?.[1] ?? 'muted'} /></View>
            {i.status !== 'paid' && <Btn kind="outline" label="Mark paid today" busy={working === i.id} onPress={() => paid(i)} style={{ marginTop: 8, marginBottom: 0 }} />}
          </View>
        ))) : (!d.services.length ? <Empty icon="code-outline" text="No services yet. Add the usual services on the desk." /> : d.services.map((v) => (
          <View key={v.id} style={[s.card, v.active ? null : { opacity: 0.6 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[s.text, { fontWeight: '700', flex: 1, marginRight: 8 }]}>{v.name}</Text>
              <Text style={s.text}>{inr(v.totalInrPaise)}</Text>
            </View>
            <Text style={[s.muted, { marginTop: 4 }]}>{[v.vendor, CATS[v.category] ?? v.category, CYCLES[v.cycle] ?? v.cycle].filter(Boolean).join('  ·  ')}{v.expectedMinor ? `  ·  ${money(v.expectedMinor, v.currency)}${v.gstPercent ? ` + ${v.gstPercent}% GST` : ''}` : ''}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {v.nextDue && <Badge label={`Next due ${day(v.nextDue)}`} />}<Badge label={v.source === 'manual' ? 'Entered by hand' : `Automatic, ${v.source}`} tone={v.source === 'manual' ? 'muted' : 'ok'} />{!v.active && <Badge label="Off" />}
            </View>
          </View>
        )))}
      </>)}
    </ScrollView>
  );
}
