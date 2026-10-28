import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { api } from './api';
import type { HoldResponse } from './types';
import { Badge, Btn, Chip, s } from './ui';
import { C, inr, niceDate } from './theme';

// The weekly waitlist (Sunday leather ball unless the ground changed it), under My Bookings: join for a session, see where each request
// stands, leave, and accept a session offered to you. The server decides what is free and who wins; accepting goes to the normal payment,
// or, while prices are on enquiry, sends the ground a pricing enquiry for that slot.
interface Entry { id: string; groundName: string; session: string; everyWeek: boolean; status: 'waiting' | 'won' | 'booked' | 'withdrawn' | 'ended'; nextDate: string; rollovers: number }
interface Offer { id: string; groundName: string; session: string; date: string; time: string; endTime: string; yours: boolean; bookingId: string | null }
interface Session { groundId: string; groundName: string; ruleId: string; label: string; from: string; to: string; pricePaise: number | null }
interface Mine { settings: { name: string; confirmHours: number }; entries: Entry[]; offers: Offer[]; sessions: Session[]; games: number; tier: string | null }

export function Waitlist({ onPay }: { onPay: (h: HoldResponse) => void }) {
  const [w, setW] = useState<Mine | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0); const [every, setEvery] = useState(false);
  const load = useCallback(async () => { setErr(''); try { setW(await api<Mine>('/api/waitlist')); } catch (e: any) { setErr(`We could not load your waitlist just now (${e.message}).`); } }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<void>) => { setErr(''); setNote(''); setBusy(true); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); void load(); } };
  const accept = (o: Offer) => act(async () => {
    const r = await api<{ via: 'booking' | 'enquiry'; hold?: HoldResponse }>(`/api/waitlist/offers/${o.id}/accept`, { method: 'POST', body: {} });
    if (r.via === 'enquiry' || !r.hold) setNote('Sent. The ground will confirm the price and the booking with you.');
    else if (r.hold.payment.mode === 'none') setNote('It is booked. You will find it in your bookings.');
    else onPay(r.hold);
  });
  const join = () => act(async () => {
    const x = w!.sessions[pick]!;
    const r = await api<{ entry: Entry }>('/api/waitlist', { method: 'POST', body: { groundId: x.groundId, ruleId: x.ruleId, everyWeek: every } });
    setNote(`You are on the waitlist for ${niceDate(r.entry.nextDate)}.`);
  });
  const leave = (e: Entry) => act(async () => { await api(`/api/waitlist/${e.id}/withdraw`, { method: 'POST', body: {} }); setNote('You have left the waitlist.'); });
  if (!w) return err ? <View style={s.card}><Text style={s.err}>{err}</Text><Btn kind="outline" label="Try again" onPress={load} /></View> : null;
  const live = w.entries.filter((e) => e.status === 'waiting' || e.status === 'won');
  return (
    <View style={s.card} accessibilityLabel={`${w.settings.name} waitlist`}>
      <Text style={[s.text, { fontWeight: '800', fontSize: 16 }]}>{w.settings.name} waitlist</Text>
      <Text style={[s.muted, { marginTop: 4 }]}>If the session you want is booked, you move to the next week, for up to a year. A session still free {w.settings.confirmHours} hours before it starts is offered to everyone waiting, and the first to accept gets it.{w.tier ? ` You have played ${w.games} games here in the last 12 months, so you are ${w.tier} and hear early.` : ''}</Text>
      {w.offers.map((o) => (
        <View key={o.id} style={[s.card, { borderColor: C.gold, marginTop: 10, marginBottom: 0 }]}>
          <Badge label={o.yours ? 'Yours' : 'Free for you now'} tone="gold" />
          <Text style={[s.text, { marginTop: 6 }]}>{o.session} at {o.groundName}, {niceDate(o.date)}, {o.time} – {o.endTime}</Text>
          {!o.yours && <Btn label="Accept" busy={busy} onPress={() => accept(o)} style={{ marginTop: 10, marginBottom: 0 }} />}
          {o.yours && o.bookingId && <Btn label="Pay for it" busy={busy} onPress={() => accept(o)} style={{ marginTop: 10, marginBottom: 0 }} />}
          {o.yours && !o.bookingId && <Text style={s.muted}>Waiting for the ground to confirm the price.</Text>}
        </View>
      ))}
      {live.map((e) => (
        <View key={e.id} style={[s.row, { marginTop: 10, alignItems: 'center' }]}>
          <Text style={[s.text, { flex: 1 }]}>{e.session}, {e.groundName}: {e.status === 'won' ? 'you accepted a slot for' : 'waiting for'} {niceDate(e.nextDate)}{e.everyWeek ? ', every week' : ''}{e.rollovers ? ` (moved on ${e.rollovers} ${e.rollovers === 1 ? 'week' : 'weeks'})` : ''}</Text>
          <Btn kind="ghost" label="Leave" disabled={busy} onPress={() => leave(e)} style={{ marginBottom: 0 }} />
        </View>
      ))}
      {!w.sessions.length ? <Text style={[s.note, { marginTop: 8 }]}>No ground has a {w.settings.name} session on its price list right now.</Text> : live.length < 3 && (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>{w.sessions.map((x, i) => <Chip key={`${x.groundId}:${x.ruleId}`} label={`${x.label}, ${x.from} – ${x.to}${x.pricePaise !== null ? ` · ${inr(x.pricePaise)}` : ''}`} on={i === pick} onPress={() => setPick(i)} />)}</View>
        <View style={[s.row, { alignItems: 'center', marginVertical: 8 }]}><Text style={[s.text, { flex: 1 }]}>Every week</Text><Switch accessibilityLabel="Every week" value={every} onValueChange={setEvery} trackColor={{ true: C.gold }} /></View>
        <Btn label="Join the waitlist" busy={busy} onPress={join} style={{ marginBottom: 0 }} />
      </>)}
      {!!err && <Text style={[s.err, { marginTop: 8 }]}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginTop: 8 }]}>{note}</Text>}
    </View>
  );
}
