import React, { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { api } from './api';
import type { Booking, HoldResponse, PaymentInstructions } from './types';
import { Btn, Chip, s } from './ui';
import { C } from './theme';

// Guppi booking, in any language. This screen only shows what the server's booking conversation returns and passes the customer's words, choices and taps back. It has no
// booking rules of its own: the date, time, price, advance and availability on screen are the booking system's. It stops at the existing secure payment screen; it
// never takes, confirms or marks a payment.

interface Offer { optionId?: string; text: string; tag: string; totalPaise: number; advancePaise: number }
interface Need { field: string; reason: string; choices?: { label: string; patch: Record<string, unknown> }[] }
interface Labels { title: string; placeholder: string; send: string; option: string; total: string; advance: string; hold: string; change: string; secure: string; reset: string; signIn: string; example: string }
interface Reply {
  command: string | null; status: 'clarify' | 'options' | 'selected' | 'ready_to_hold' | 'rejected' | 'info' | 'refused' | 'normal_flow'; language: string; message: string; labels: Labels;
  draft: Record<string, unknown>; needs?: Need[]; offers?: Offer[]; option?: Offer; next?: { command: 'CREATE_HOLD'; optionId: string; groundId: string };
}
interface Turn { who: 'me' | 'guppi'; text: string }

const FIRST: Labels = { title: 'Guppi booking assistant', placeholder: 'Tell Guppi what you need, in any language', send: 'Send', option: 'Option', total: 'Total', advance: 'Advance', hold: 'Hold and go to secure payment', change: 'Change', secure: 'Guppi never takes payment. Payment happens only on the secure payment screen.', reset: 'Start over', signIn: 'Sign in to book with Guppi.', example: 'Example: Sunday 7 PM for 3 hours' };
const newActionId = (): string => `guppi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const inr = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function GuppiBookScreen({ onHold, onBack, signedIn, onNeedSignIn }: { onHold: (h: HoldResponse) => void; onBack: () => void; signedIn: boolean; onNeedSignIn?: () => void }) {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reply, setReply] = useState<Reply | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const action = useRef<{ optionId: string; id: string } | null>(null); // the same tap repeated reuses one action id, so a retry cannot hold twice
  const L = reply?.labels ?? FIRST;

  const turn = async (body: { text?: string; patch?: Record<string, unknown> }, shown?: string) => {
    if (!signedIn) { onNeedSignIn?.(); return; }
    setErr(''); setBusy(true);
    try {
      const r = await api<Reply>('/api/guppi/understand', { method: 'POST', body: { ...body, draft, offers: (reply?.offers ?? []).map((o) => o.optionId).filter(Boolean) } });
      setTurns((t) => [...t, ...(shown ?? body.text ? [{ who: 'me' as const, text: shown ?? body.text! }] : []), { who: 'guppi', text: r.message }]);
      setReply(r); setDraft(r.draft);
      if (r.status === 'ready_to_hold' && r.next) await holdIt(r.next.optionId, r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const holdIt = async (optionId: string, r: Reply) => {
    if (!action.current || action.current.optionId !== optionId) action.current = { optionId, id: newActionId() };
    const id = action.current.id;
    const h = await api<{ hold: Booking; creditAppliedPaise: number }>('/api/guppi/hold', { method: 'POST', body: { optionId, actionId: id }, headers: { 'Idempotency-Key': id } });
    const pay = await api<{ payment: PaymentInstructions }>(`/api/bookings/${h.hold.id}/payment-instructions`);
    setDraft({ ...r.draft, holdBookingId: h.hold.id });
    onHold({ booking: h.hold, payment: pay.payment, creditAppliedPaise: h.creditAppliedPaise });
  };

  const send = () => { const t = text.trim(); if (!t) return; setText(''); void turn({ text: t }); };
  const reset = () => { setTurns([]); setReply(null); setDraft({}); setErr(''); action.current = null; };
  const picked = reply?.status === 'selected' ? reply.option : undefined;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>{L.title}</Text>
      <Text style={[s.muted, { marginBottom: 10 }]}>{turns.length ? '' : L.example}</Text>
      {turns.map((t, i) => (
        <View key={i} style={{ alignSelf: t.who === 'me' ? 'flex-end' : 'flex-start', maxWidth: '88%', marginBottom: 8, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: t.who === 'me' ? 'rgba(201,169,107,.14)' : 'transparent' }}>
          <Text style={s.text}>{t.text}</Text>
        </View>
      ))}
      {!!reply?.needs?.length && reply.needs.some((n) => n.choices?.length) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {reply.needs.flatMap((n) => n.choices ?? []).map((c, i) => <Chip key={i} label={c.label} onPress={() => void turn({ patch: c.patch }, c.label)} disabled={busy} />)}
        </View>
      )}
      {(reply?.status === 'options' || reply?.status === 'selected') && !!reply.offers?.length && reply.offers.map((o, i) => (
        <View key={o.optionId ?? i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, marginBottom: 8 }}>
          <Text style={s.text}>{L.option} {i + 1}</Text>
          <Text style={s.text}>{o.text}</Text>
          <Btn label={`${L.option} ${i + 1}`} kind="outline" onPress={() => void turn({ text: `#${i + 1}` }, `${L.option} ${i + 1}`)} disabled={busy} style={{ marginTop: 8, marginBottom: 0 }} />
        </View>
      ))}
      {!!picked && (
        <View style={{ borderWidth: 1, borderColor: C.gold, borderRadius: 14, padding: 12, marginBottom: 8 }}>
          <Text style={s.text}>{picked.text}</Text>
          <Text style={s.muted}>{L.total} {inr(picked.totalPaise)} · {L.advance} {inr(picked.advancePaise)}</Text>
          <Btn label={L.hold} onPress={() => { setErr(''); setBusy(true); void holdIt(picked.optionId!, reply!).catch((e: any) => setErr(e.message)).finally(() => setBusy(false)); }} busy={busy} style={{ marginTop: 10, marginBottom: 0 }} />
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
      <TextInput value={text} onChangeText={setText} onSubmitEditing={send} placeholder={L.placeholder} placeholderTextColor={C.muted} style={s.input} multiline editable={!busy} />
      <Btn label={L.send} onPress={send} busy={busy} disabled={!text.trim()} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Btn label={L.reset} kind="ghost" onPress={reset} />
        <Btn label="←" kind="ghost" onPress={onBack} />
      </View>
      <Text style={[s.muted, { textAlign: 'center' }]}>{L.secure}</Text>
    </ScrollView>
  );
}
