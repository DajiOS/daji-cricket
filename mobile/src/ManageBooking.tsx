import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { Booking, BookingOption, DepositView, HoldResponse, RescheduleOutcome, ReschedulePreview, RescheduleStatus } from './types';
import { Btn, DateField, Field, KV, Loading, s, ScreenHead } from './ui';
import { C, inr, MON } from './theme';

// Change a booking's time and read its security deposit (iOS and Android). Everything shown comes from the server and is sent back to it: whether the booking may be moved and why not,
// the replacement options and their prices, what a move would do, the move, and the amount still owed online after a dearer move. No cut-off, price or refund rule lives here.

const KINDS: Record<string, string> = { collect: 'Collected', deduct: 'Kept by the ground', refund: 'Returned to you', reverse: 'Deduction reversed' };
const ist = (ms: number) => new Date(ms + 330 * 60000);
const hm = (ms: number) => ist(ms).toISOString().slice(11, 16);
const dayTime = (ms: number) => { const d = ist(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${hm(ms)}`; };
const todayIST = () => ist(Date.now()).toISOString().slice(0, 10);

/** The read-only security deposit of a booking, shown apart from the booking advance. */
export function DepositScreen({ booking: b, onBack }: { booking: Booking; onBack: () => void }) {
  const [d, setD] = useState<DepositView | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<{ deposit: DepositView }>(`/api/bookings/${b.id}/security-deposit`).then((r) => setD(r.deposit)).catch((e) => setErr(e.message)); }, [b.id]);
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}>
      <ScreenHead eyebrow={`Booking ${b.ref}`} title="Security deposit" />
      <Text style={[s.muted, { marginBottom: 14 }]}>Your booking advance is part of the price of the booking. A security deposit is a separate amount the ground may hold against damage. It is returned to you, less anything kept with a reason you can see here.</Text>
      <View style={s.card} testID="deposit-booking"><KV k="Booking advance (part of the price)" v={inr(b.advancePaise ?? 0)} /><KV k="Paid towards the booking so far" v={inr(b.paidPaise)} /></View>
      {!!err && <Text style={s.err}>{err}</Text>}
      {!d && !err && <Loading />}
      {d && (d.entries.length === 0 ? <Text style={s.muted} testID="deposit-none">No security deposit has been taken for this booking.</Text> : (<>
        <View style={s.card} testID="deposit-held">
          <KV k="Security deposit held now" v={inr(d.heldPaise)} bold /><KV k="Collected" v={inr(d.collectedPaise)} />
          {d.deductedPaise > 0 && <KV k="Kept by the ground" v={inr(d.keptPaise)} />}{d.refundedPaise > 0 && <KV k="Returned to you" v={inr(d.refundedPaise)} />}
        </View>
        <View style={s.card}>{d.entries.map((e) => <KV key={e.id} k={`${KINDS[e.kind] ?? e.kind} · ${dayTime(e.createdAt)}${e.reason ? ` · ${e.reason}` : ''}`} v={inr(e.amountPaise)} />)}</View>
      </>))}
      <Text style={s.muted}>Only the ground can change the security deposit. You can view it here.</Text>
      <Btn kind="ghost" label="Back" onPress={onBack} />
    </ScrollView>
  );
}

/** Change a booking's time: eligibility, options, a preview of the effect, then the move. A dearer move offers to pay the difference at once. */
export function RescheduleScreen({ booking: b, onBack, onPayDifference }: { booking: Booking; onBack: () => void; onPayDifference: (b: Booking) => void }) {
  const [st, setSt] = useState<RescheduleStatus | null>(null); const [err, setErr] = useState('');
  const [date, setDate] = useState(b.date); const [time, setTime] = useState(hm(b.startAt));
  const [offers, setOffers] = useState<BookingOption[] | null>(null); const [offerNote, setOfferNote] = useState('');
  const [pick, setPick] = useState<BookingOption | null>(null); const [pv, setPv] = useState<ReschedulePreview | null>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<RescheduleOutcome | null>(null);
  // prices on enquiry: the customer asks the ground to move the booking; one key per open screen so a resend after a lost answer files it once
  const [note, setNote] = useState(''); const [asked, setAsked] = useState(false); const [askKey] = useState(() => `mv-${b.id.slice(-20)}-${Date.now().toString(36)}`);
  const askToMove = async () => {
    setErr(''); setBusy(true);
    try {
      await api('/api/enquiries', { method: 'POST', headers: { 'Idempotency-Key': askKey }, body: { groundId: b.groundId, moveBookingId: b.id, preferredDate: date, preferredTime: time, preferredSlots: b.slotCount,
        message: `Please move booking ${b.ref} to ${date} at ${time}.${note.trim() ? ' ' + note.trim() : ''}` } });
      setAsked(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { api<{ status: RescheduleStatus }>(`/api/bookings/${b.id}/reschedule`).then((r) => setSt(r.status)).catch((e) => setErr(e.message)); }, [b.id]);

  const show = async () => {
    setErr(''); setPick(null); setPv(null); setOffers(null); setBusy(true);
    try {
      const r = await api<{ exact: BookingOption | null; alternatives: BookingOption[]; reason: string | null }>('/api/availability/options', { method: 'POST', body: { ...st!.optionsRequest, date, startTime: time } });
      const list = [r.exact, ...r.alternatives].filter(Boolean) as BookingOption[];
      setOffers(list); setOfferNote(list.length ? (r.exact ? '' : `${r.reason ?? 'That time is not free.'} Nearest times that are:`) : (r.reason ?? 'Nothing is free then. Try another day or time.'));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const choose = async (o: BookingOption) => {
    setErr(''); setPick(o); setPv(null);
    try { setPv((await api<{ preview: ReschedulePreview }>(`/api/bookings/${b.id}/reschedule-preview`, { method: 'POST', body: { optionId: o.optionId } })).preview); } catch (e: any) { setErr(e.message); setPick(null); }
  };
  const confirm = async () => {
    if (!pick) return;
    setErr(''); setBusy(true);
    try { setDone(await api<RescheduleOutcome>(`/api/bookings/${b.id}/reschedule`, { method: 'POST', body: { optionId: pick.optionId }, headers: { 'idempotency-key': `rs-${b.id}-${pick.optionId!.slice(-24)}` } })); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const verdict = (p: ReschedulePreview) => p.direction === 'dearer' ? `This time costs ${inr(p.differencePaise)} more. You can pay that difference online right after you confirm.`
    : p.direction === 'cheaper' ? (p.settlement ? (p.settlement.treatment === 'credit' ? `This time costs less. ${inr(p.settlement.paiseSettled)} that you already paid comes back as account credit.` : `This time costs less. A refund request for ${inr(p.settlement.paiseSettled)} that you already paid goes to the ground for approval.`) : 'This time costs less. You have not paid more than the new price, so nothing needs returning.')
    : 'This time costs the same.';

  if (!st) return <View style={s.screen}>{err ? <View style={[s.pad, { paddingTop: 60 }]}><Text style={s.err}>{err}</Text><Btn kind="ghost" label="Back" onPress={onBack} /></View> : <Loading />}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
      <ScreenHead eyebrow={`Booking ${b.ref}`} title={st.askToMove ? 'Ask to move' : 'Change the time'} />
      <View style={s.card}>
        <KV k="Now" v={`${b.date.slice(8)} ${MON[Number(b.date.slice(5, 7)) - 1]}, ${hm(b.startAt)} – ${hm(b.endAt)}`} />
        {!st.askToMove && st.maxMoves != null && <KV k="Moves left" v={`${st.movesLeft} of ${st.maxMoves}`} />}{!st.askToMove && st.cutoffHours != null && <KV k="Allowed until" v={`${st.cutoffHours} hours before the start`} />}
      </View>
      {done ? (<>
        <Text style={s.text} testID="reschedule-done">Moved to {dayTime(done.toStartAt)}.</Text>
        {done.settlement && <Text style={s.muted}>{done.settlement.treatment === 'credit' ? `${inr(done.settlement.creditPaise ?? 0)} was added to your account credit.` : `A refund request for ${inr(done.settlement.refundRequestedPaise ?? 0)} was sent to the ground.`}</Text>}
        {(done.booking.moveDifferenceDuePaise ?? 0) > 0 && <Btn label={`Pay the ${inr(done.booking.moveDifferenceDuePaise!)} difference online`} onPress={() => onPayDifference(done.booking)} style={{ marginTop: 12 }} />}
        <Btn kind="ghost" label="Close" onPress={onBack} />
      </>) : st.askToMove ? (asked ? (<>
        <Text style={s.text} testID="move-asked">Sent. The ground will move your booking and let you know.</Text>
        <Btn kind="ghost" label="Close" onPress={onBack} />
      </>) : (<>
        <Text style={[s.muted, { marginBottom: 12 }]}>Prices are given on enquiry, so the ground moves bookings for you. Tell them when you would like to play instead.</Text>
        <DateField label="New date" value={date} onChange={setDate} />
        <Field label="New start time (HH:MM)" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
        <Field label="Anything else (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Btn label="Ask the ground to move it" onPress={askToMove} busy={busy} disabled={!date || !/^\d{2}:\d{2}$/.test(time) || date < todayIST()} />
        {!!err && <Text style={s.err}>{err}</Text>}
        <Btn kind="ghost" label="Back" onPress={onBack} />
      </>)) : !st.allowed ? (<>
        <Text style={s.err} testID="reschedule-blocked">{st.message ?? 'This booking cannot be changed online.'}</Text>
        <Btn kind="ghost" label="Back" onPress={onBack} />
      </>) : (<>
        <DateField label="New date" value={date} onChange={setDate} />
        <Field label="Preferred start time (HH:MM)" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
        <Btn label="Show times" onPress={show} busy={busy && !pick} disabled={!date || !/^\d{2}:\d{2}$/.test(time) || date < todayIST()} />
        {!!offerNote && <Text style={s.muted}>{offerNote}</Text>}
        {offers?.map((o) => (<Btn key={o.optionId} kind={pick?.optionId === o.optionId ? 'primary' : 'outline'} label={`${o.date.slice(8)} ${MON[Number(o.date.slice(5, 7)) - 1]}, ${o.startTime} – ${o.endTime}${o.label ? ' · ' + o.label : ''} · ${inr(o.totalPaise)}`} onPress={() => choose(o)} />))}
        {pv && (<>
          <View style={s.card} testID="reschedule-summary">
            <KV k="From" v={`${dayTime(pv.fromStartAt)} · ${inr(pv.fromTotalPaise)}`} /><KV k="To" v={`${dayTime(pv.toStartAt)} · ${inr(pv.toTotalPaise)}`} />
            <KV k="Left to pay on this booking after the move" v={inr(pv.balanceAfterPaise)} />{pv.movesLeftAfter != null && <KV k="Moves left after this one" v={String(pv.movesLeftAfter)} />}
          </View>
          <Text style={[s.text, { marginBottom: 12 }]}>{verdict(pv)}</Text>
          <Btn label="Confirm the move" onPress={confirm} busy={busy} />
        </>)}
        {!!err && <Text style={s.err}>{err}</Text>}
        <Btn kind="ghost" label="Back" onPress={onBack} />
      </>)}
      {!!err && (done || !st.allowed) && <Text style={[s.err, { color: C.danger }]}>{err}</Text>}
    </ScrollView>
  );
}

/** What the pay-difference route returns, in the shape PayScreen already takes. */
export const differenceAsHold = (r: { payment: HoldResponse['payment']; booking: Booking }): HoldResponse => ({ booking: r.booking, payment: r.payment, creditAppliedPaise: 0 });
