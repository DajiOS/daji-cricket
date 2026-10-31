import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Btn, Chip, Field, Loading, s, ScreenHead } from './ui';
import { C, inr } from './theme';
import type { User } from './types';

interface Settings {
  requireApproval: boolean; advanceMode: 'percent' | 'fixed'; advanceValue: number; fullPaymentWithinHours: number;
  holdMinutesOnline: number; holdMinutesUpi: number; verifyMinutesUpi: number; graceMinutes: number; maxHoldExtensions: number;
  freeCancelHours: number; lateCancelCreditPercent: number; cashRefundPercent: number; creditExpiryDays: number; noShowGraceMinutes: number;
  contactName: string; contactPhone: string; contactEmail: string; upiId: string; upiPayee: string;
}
type NumKey = 'fullPaymentWithinHours' | 'holdMinutesOnline' | 'holdMinutesUpi' | 'verifyMinutesUpi' | 'graceMinutes' | 'maxHoldExtensions' | 'freeCancelHours' | 'lateCancelCreditPercent' | 'cashRefundPercent' | 'creditExpiryDays' | 'noShowGraceMinutes';
// label, what it means, unit, the server's allowed range
const NUMS: { group: string; items: [NumKey, string, string, number, number][] }[] = [
  { group: 'Holding a slot', items: [
    ['holdMinutesOnline', 'Hold for online payment', 'minutes', 5, 60],
    ['holdMinutesUpi', 'Hold for a UPI payment', 'minutes', 5, 240],
    ['verifyMinutesUpi', 'Time to check a UPI payment', 'minutes', 15, 1440],
    ['graceMinutes', 'Extra minutes when a hold runs out', 'minutes', 0, 120],
    ['maxHoldExtensions', 'Times a hold can be extended', 'times', 0, 10],
    ['fullPaymentWithinHours', 'Pay the balance within', 'hours', 0, 720],
  ] },
  { group: 'Cancelling', items: [
    ['freeCancelHours', 'Free cancellation up to', 'hours before', 0, 720],
    ['lateCancelCreditPercent', 'Late cancellation: account credit', '% of what was paid', 0, 100],
    ['cashRefundPercent', 'Refund as money instead of credit', '% of the credit', 0, 100],
    ['creditExpiryDays', 'Account credit lasts', 'days', 1, 3650],
    ['noShowGraceMinutes', 'No-show after', 'minutes late', 0, 600],
  ] },
];

/** The booking rules and contact details behind the website. They apply to every booking, so changes are saved one section at a time. */
export function SettingsScreen({ user }: { user: User }) {
  const sa = user.role === 'super_admin';
  const [st, setSt] = useState<Settings | null>(null); const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState('');
  const fill = (x: Settings) => setF({
    ...Object.fromEntries(NUMS.flatMap((g) => g.items.map(([k]) => [k, String(x[k])]))),
    advanceValue: x.advanceMode === 'fixed' ? String(x.advanceValue / 100) : String(x.advanceValue),
    contactName: x.contactName, contactPhone: x.contactPhone, contactEmail: x.contactEmail, upiId: x.upiId, upiPayee: x.upiPayee,
  });
  const load = useCallback(async () => {
    setBusy(true);
    try { const x = await api<Settings>('/api/admin/settings'); setSt(x); fill(x); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const put = async (section: string, body: Partial<Settings>) => {
    setErr(''); setNote(''); setSaving(section);
    try { const x = await api<Settings>('/api/admin/settings', { method: 'PUT', body }); setSt(x); fill(x); setNote('Saved.'); }
    catch (e: any) { setErr(e.details?.fields?.map((q: any) => q.message).join(' ') || e.message); }
    finally { setSaving(''); }
  };
  const nums = (keys: NumKey[]) => Object.fromEntries(keys.map((k) => [k, Number(f[k])])) as Partial<Settings>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Settings" title="Booking rules" about="How bookings are held, paid and cancelled on the website and the app. They apply to every booking. The opening and closing days, closed days and the Razorpay switch are under Booking controls." />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginVertical: 6 }]}>{note}</Text>}
      {!st ? (err ? null : <Loading />) : (<>
        <View style={[s.card, { marginTop: 14 }]}>
          <Text style={s.h2}>Approval and advance</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>New bookings {st.requireApproval ? 'wait for the team to approve them.' : 'are confirmed straight away once paid.'}</Text>
          <Btn kind="outline" label={st.requireApproval ? 'Confirm bookings without approval' : 'Ask for approval on new bookings'} busy={saving === 'approval'} onPress={() => put('approval', { requireApproval: !st.requireApproval })} />
          <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>Advance to hold a booking</Text>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Percent of the price" on={st.advanceMode === 'percent'} onPress={() => setSt({ ...st, advanceMode: 'percent' })} />
            <Chip label="Fixed amount" on={st.advanceMode === 'fixed'} onPress={() => setSt({ ...st, advanceMode: 'fixed' })} />
          </View>
          <Field label={st.advanceMode === 'percent' ? 'Advance (%)' : 'Advance (₹)'} value={f.advanceValue} onChangeText={set('advanceValue')} keyboardType="numeric" />
          <Btn label="Save advance" busy={saving === 'advance'} onPress={() => put('advance', { advanceMode: st.advanceMode, advanceValue: st.advanceMode === 'fixed' ? Math.round(Number(f.advanceValue) * 100) : Number(f.advanceValue) })} style={{ marginBottom: 0 }} />
          {st.advanceMode === 'fixed' && Number(f.advanceValue) > 0 && <Text style={[s.muted, { marginTop: 6 }]}>Customers pay {inr(Math.round(Number(f.advanceValue) * 100))} to hold a booking.</Text>}
        </View>

        {NUMS.map((g) => (
          <View key={g.group} style={s.card}>
            <Text style={s.h2}>{g.group}</Text>
            {g.items.map(([k, label, unit, lo, hi]) => <Field key={k} label={`${label} (${unit})`} value={f[k]} onChangeText={set(k)} keyboardType="numeric" placeholder={`${lo} to ${hi}`} />)}
            <Btn label={`Save ${g.group.toLowerCase()}`} busy={saving === g.group} onPress={() => put(g.group, nums(g.items.map(([k]) => k)))} style={{ marginBottom: 0 }} />
          </View>
        ))}

        <View style={s.card}>
          <Text style={s.h2}>Contact and UPI</Text>
          <Text style={[s.muted, { marginBottom: 10 }]}>Shown to customers on the website and on payment pages.{sa ? '' : ' The phone number and UPI ID are shared by every business, so only the software owner changes them.'}</Text>
          <Field label="Contact person" value={f.contactName} onChangeText={set('contactName')} autoCapitalize="words" />
          <Field label="Contact email" value={f.contactEmail} onChangeText={set('contactEmail')} keyboardType="email-address" />
          <Field label="Contact mobile" value={f.contactPhone} onChangeText={set('contactPhone')} keyboardType="phone-pad" editable={sa} />
          <Field label="UPI ID" value={f.upiId} onChangeText={set('upiId')} editable={sa} placeholder="name@bank" />
          <Field label="UPI payee name" value={f.upiPayee} onChangeText={set('upiPayee')} autoCapitalize="words" />
          <Btn label="Save contact and UPI" busy={saving === 'contact'} onPress={() => put('contact', {
            contactName: f.contactName?.trim(), contactEmail: f.contactEmail?.trim(), upiPayee: f.upiPayee?.trim(),
            ...(sa && f.contactPhone !== st.contactPhone ? { contactPhone: f.contactPhone.trim() } : {}),
            ...(sa && f.upiId !== st.upiId ? { upiId: f.upiId.trim() } : {}),
          })} style={{ marginBottom: 0 }} />
        </View>
      </>)}
    </ScrollView>
  );
}
