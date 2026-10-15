import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { api } from './api';
import { Btn, Chip, Field, s } from './ui';
import { C } from './theme';

interface Answer { question: string; answer: string; details?: string[]; suggestions?: string[] }

export function AskScreen() {
  const [q, setQ] = useState(''); const [out, setOut] = useState<Answer | null>(null); const [examples, setExamples] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ items: string[] }>('/api/ask/examples').then((r) => setExamples(r.items)).catch(() => {}); }, []);
  const ask = async (text: string) => {
    if (text.trim().length < 3) return;
    setErr(''); setBusy(true);
    try { setOut(await api<Answer>('/api/ask', { method: 'POST', body: { question: text.trim() } })); setQ(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.eyebrow}>Ask AI</Text>
        <Text style={s.h1}>Ask about your bookings</Text>
        <Text style={[s.muted, { marginBottom: 14 }]}>Your next booking, your credit, what you owe, availability, prices and the cancellation rules.</Text>
        <Field label="Your question" value={q} onChangeText={setQ} placeholder="When is my next booking?" returnKeyType="send" onSubmitEditing={() => ask(q)} autoCapitalize="sentences" />
        <Btn label="Ask" onPress={() => ask(q)} busy={busy} />
        {examples.slice(0, 6).map((e) => <Chip key={e} label={e} onPress={() => ask(e)} />)}
        {!!err && <Text style={s.err}>{err}</Text>}
        {out && (<>
          <Text style={[s.muted, { marginTop: 18 }]}>{out.question}</Text>
          <Text style={[s.text, { marginVertical: 8, lineHeight: 22 }]}>{out.answer}</Text>
          {out.details?.map((d) => <Text key={d} style={[s.muted, { color: C.muted }]}>• {d}</Text>)}
        </>)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
