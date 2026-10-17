import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from './api';
import { Btn, Chip, Field, NameFields, splitName, s, DateField } from './ui';
import { inr } from './theme';

interface Ground { id: string; name: string; active: boolean }
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const lab = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** A custom programme over several days (camp, tournament): the same hours each day for one agreed total. Entered by staff once the customer has agreed. */
export function BlockForm({ onDone }: { onDone: (message: string) => void }) {
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [groundId, setGroundId] = useState('');
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today());
  const [start, setStart] = useState(7); const [end, setEnd] = useState(19);
  const [total, setTotal] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank_transfer' | 'card' | 'cash'>('upi'); const [amount, setAmount] = useState(''); const [ref, setRef] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [isT, setIsT] = useState(false); const [tName, setTName] = useState('');
  const [match, setMatch] = useState<{ known: boolean; hasAccount: boolean; name?: string } | null>(null);
  // An existing customer is found by phone; their name is filled in and, if they already have an account, staff are told not to make another.
  useEffect(() => {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) { setMatch(null); return; }
    let live = true;
    api<{ found: boolean; known: boolean; hasAccount: boolean; name?: string }>('/api/staff/customers/lookup?phone=' + digits)
      .then((r) => { if (!live) return; setMatch(r.found ? r : null); if (r.found && r.known && r.name) setName((cur) => cur.trim() ? cur : r.name!); })
      .catch(() => { if (live) setMatch(null); });
    return () => { live = false; };
  }, [phone]);
  useEffect(() => { api<{ items: Ground[] }>('/api/staff/grounds').then((r) => { const g = r.items.filter((x) => x.active); setGrounds(g); if (g[0]) setGroundId(g[0].id); }).catch((e: any) => setErr(e.message)); }, []);

  const n = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? days(from, to) : 0;
  const totalPaise = Math.round(Number(total) * 100), payPaise = Math.round(Number(amount) * 100);
  const cashTooHigh = method === 'cash' && payPaise >= 20_000_000;
  const ready = n >= 1 && n <= 31 && totalPaise >= 100 && amount.trim() !== '' && payPaise >= 0 && splitName(name).first && splitName(name).last && phone.trim() && (!isT || tName.trim().length >= 3) && groundId && !cashTooHigh;

  async function save() {
    setErr(''); setBusy(true);
    try {
      const r = await api<{ bookings: { id: string }[] }>('/api/staff/bookings/block', { method: 'POST', body: { groundId, fromDate: from, toDate: to, startTime: hh(start), endTime: hh(end), totalPaise, customer: { firstName: splitName(name).first, lastName: splitName(name).last, phone: phone.trim() }, ...(isT ? { tournament: { name: tName.trim() } } : {}), payment: { method, amountPaise: payPaise, reference: ref.trim() || undefined } } });
      onDone(`${r.bookings.length} days booked.`);
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); } finally { setBusy(false); }
  }

  return (
    <View>
      <Text style={s.muted}>For a custom programme agreed with the customer. One booking is made for each day and the agreed total is shared across the days. Enter 0 in Received now if nothing has been received yet; the whole amount then stays due.</Text>
      <Text style={[s.muted, { marginTop: 10 }]}>Ground</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{grounds.map((g) => <Chip key={g.id} label={g.name} on={groundId === g.id} onPress={() => setGroundId(g.id)} />)}</View>
      <DateField label="First day" value={from} onChange={(v) => { setFrom(v); if (v && to < v) setTo(v); }} />
      <DateField label="Last day" value={to} onChange={setTo} />
      <Text style={s.muted}>From</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>{HOURS.map((h) => <Chip key={h} label={lab(h)} on={start === h} onPress={() => { setStart(h); if (end <= h) setEnd(h + 1); }} />)}</ScrollView>
      <Text style={s.muted}>Until</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>{HOURS.filter((h) => h > start).map((h) => <Chip key={h} label={lab(h)} on={end === h} onPress={() => setEnd(h)} />)}</ScrollView>
      <Field label="Agreed total for all days (₹)" value={total} onChangeText={setTotal} keyboardType="numeric" />
      {n > 0 && totalPaise > 0 && <Text style={s.muted}>{n} day{n === 1 ? '' : 's'}, about {inr(Math.round(totalPaise / n))} a day</Text>}
      <NameFields value={name} onChange={setName} firstLabel="Customer first name" lastLabel="Customer last name" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Chip label={isT ? 'This is a tournament: also added to Tournaments' : 'Mark as a tournament'} on={isT} onPress={() => setIsT(!isT)} />
      {isT && <Field label="Tournament name" value={tName} onChangeText={setTName} autoCapitalize="words" />}
      {match && <Text style={s.muted}>{match.known ? `Existing customer: ${match.name}. Details filled in.` : 'This number already belongs to a customer.'}{match.hasAccount ? ' They already have an account: ask them to sign in with a mobile code or reset their password, do not make a new one.' : ''}</Text>}
      <Text style={s.muted}>Paid by</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{(['upi', 'bank_transfer', 'card', 'cash'] as const).map((m) => <Chip key={m} label={m.replace('_', ' ')} on={method === m} onPress={() => setMethod(m)} />)}</View>
      <Field label="Received now (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      {method !== 'cash' && <Field label="Reference (UTR)" value={ref} onChangeText={setRef} />}
      {cashTooHigh && <Text style={[s.err, { marginBottom: 8 }]}>Cash of ₹2,00,000 or more cannot be taken (Income-tax Act). Use UPI, bank transfer or cheque.</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label={`Book ${n || ''} day${n === 1 ? '' : 's'}`} disabled={!ready} busy={busy} onPress={save} />
    </View>
  );
}
