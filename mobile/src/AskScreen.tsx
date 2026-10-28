import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { api } from './api';
import type { User } from './types';
import { Btn, Chip, Field, s } from './ui';
import { C } from './theme';
import { addToSiri, canAddToSiri, VOICE_ACTIONS } from './voice';

interface Answer { question: string; answer: string; details?: { label: string; text: string }[]; suggestions?: string[] }

/** The assistant (Platform AI), under the name this person picked. Customers ask about their own bookings; the team about the business,
 *  limited to what their login may see. `voice` is a question that came by a voice shortcut: it is asked once, and the answer is shown, never spoken. */
export function AskScreen({ user, voice }: { user: User; onUser?: (u: User) => void; voice?: { q: string; n: number } | null }) {
  const customer = user.role === 'customer';
  const base = customer ? '/api/ask' : '/api/staff/ask';
  const name = user.aiName || 'Ask AI';
  const [q, setQ] = useState(''); const [out, setOut] = useState<Answer | null>(null); const [examples, setExamples] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  useEffect(() => { api<{ items: string[] }>(`${base}/examples`).then((r) => setExamples(r.items)).catch(() => {}); }, [base]);
  const ask = async (text: string, via: 'typed' | 'voice' = 'typed') => {
    if (text.trim().length < 2) return;
    setErr(''); setBusy(true);
    try { setOut(await api<Answer>(base, { method: 'POST', body: { question: text.trim(), via } })); setQ(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (voice?.q) void ask(voice.q, 'voice'); }, [voice?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const askAction = VOICE_ACTIONS.find((a) => a.id === 'ask');
  const siri = async () => { setNote(''); try { if (askAction) { const r = await addToSiri(askAction, name); if (r === 'added' || r === 'updated') setNote('Saved with Siri.'); } } catch (e: any) { setErr(e.message); } };
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.eyebrow}>{name}</Text>
        <Text style={s.h1}>{customer ? 'Ask about your bookings' : 'Ask about the business'}</Text>
        {!!user.aiNameNotice && <Text style={[s.muted, { color: C.gold, marginBottom: 8 }]}>{user.aiNameNotice}</Text>}
        <Text style={[s.muted, { marginBottom: 14 }]}>{customer ? 'Your next booking, your credit, what you owe, availability, prices and the cancellation rules.' : 'Bookings, money, jobs or the team, in your own words. Only what your login may see, and it never changes anything.'}</Text>
        {canAddToSiri() && ( // under the intro, not in the title row: the day/night switch sits in the top-right corner of every screen
          <Pressable accessibilityRole="button" accessibilityLabel={`Add ${name} to Siri`} onPress={siri} style={{ alignSelf: 'flex-start', borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 14 }}>
            <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '700' }}>Add to Siri</Text>
          </Pressable>)}
        <Field label="Your question" value={q} onChangeText={setQ} placeholder={customer ? 'When is my next booking?' : "What's booked for today?"} returnKeyType="send" onSubmitEditing={() => ask(q)} autoCapitalize="sentences" />
        <Btn label="Ask" onPress={() => ask(q)} busy={busy} />
        {examples.slice(0, 6).map((e) => <Chip key={e} label={e} onPress={() => ask(e)} />)}
        {!!err && <Text style={s.err}>{err}</Text>}
        {!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
        {out && (<>
          <Text style={[s.muted, { marginTop: 18 }]}>{out.question}</Text>
          <Text style={[s.text, { marginVertical: 8, lineHeight: 22 }]}>{out.answer}</Text>
          {out.details?.slice(0, 6).map((d) => <Text key={`${d.label}:${d.text}`} style={[s.muted, { color: C.muted }]}>• {d.label}: {d.text}</Text>)}
          {out.suggestions?.slice(0, 3).map((x) => <Chip key={x} label={x} onPress={() => ask(x)} />)}
        </>)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
