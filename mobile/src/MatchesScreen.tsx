import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from './api';
import type { MatchRow, Scorecard } from './types';
import { Badge, Btn, Chip, Field, KV, Loading, Section, s } from './ui';
import { C } from './theme';

const OUTS = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired'];
const EXTRAS: [string, string][] = [['wide', 'Wide'], ['noball', 'No ball'], ['bye', 'Bye'], ['legbye', 'Leg bye']];

/** Coaches and scorers: set up a match and score it ball by ball. The website shows the live scorecard. */
export function MatchesScreen() {
  const [list, setList] = useState<MatchRow[] | null>(null); const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false); const [f, setF] = useState({ title: '', teamA: '', teamB: '', overs: '10' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setList((await api<{ items: MatchRow[] }>('/api/staff/matches')).items); } catch (e: any) { setErr(e.message); setList([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <Scoring id={open} onBack={() => { setOpen(null); void load(); }} />;
  const create = async () => {
    setErr(''); setBusy(true);
    try { const m = await api<MatchRow>('/api/staff/matches', { method: 'POST', body: { title: f.title.trim(), teamA: f.teamA.trim(), teamB: f.teamB.trim(), overs: Number(f.overs) } }); setAdding(false); setF({ title: '', teamA: '', teamB: '', overs: '10' }); setOpen(m.id); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>Scoring</Text><Text style={s.h1}>Matches</Text>
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn kind="outline" label={adding ? 'Close' : 'New match'} onPress={() => setAdding(!adding)} />
      {adding && (<View style={s.card}>
        <Field label="Title" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} autoCapitalize="words" placeholder="Sunday friendly" />
        <Field label="Team A" value={f.teamA} onChangeText={(v) => setF({ ...f, teamA: v })} autoCapitalize="words" /><Field label="Team B" value={f.teamB} onChangeText={(v) => setF({ ...f, teamB: v })} autoCapitalize="words" />
        <Field label="Overs" value={f.overs} onChangeText={(v) => setF({ ...f, overs: v })} keyboardType="number-pad" />
        <Btn label="Create and start scoring" onPress={create} busy={busy} />
      </View>)}
      {list === null ? <Loading /> : !list.length ? <Text style={s.muted}>No matches yet.</Text> : list.map((m) => (
        <View key={m.id} style={s.card}>
          <View style={s.row}><Text style={s.h2}>{m.title}</Text><Badge tone={m.status === 'live' ? 'gold' : m.status === 'completed' ? 'ok' : 'muted'} label={m.status} /></View>
          <Text style={s.muted}>{m.teamA} vs {m.teamB} · {m.overs} overs</Text>
          {m.result && <Text style={s.text}>{m.result}</Text>}
          <Btn kind="outline" label={m.status === 'completed' ? 'View scorecard' : 'Score this match'} onPress={() => setOpen(m.id)} style={{ marginTop: 10, marginBottom: 0 }} />
        </View>
      ))}
    </ScrollView>
  );
}

function Scoring({ id, onBack }: { id: string; onBack: () => void }) {
  const [sc, setSc] = useState<Scorecard | null>(null);
  const [batter, setBatter] = useState(''); const [bowler, setBowler] = useState('');
  const [extra, setExtra] = useState<string | null>(null); const [out, setOut] = useState(false); const [kind, setKind] = useState('bowled');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setSc(await api<Scorecard>(`/api/staff/matches/${id}`)); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!sc) return <View style={s.screen}>{err ? <Text style={[s.err, { padding: 60 }]}>{err}</Text> : <Loading />}</View>;
  const m = sc.match, live = sc.innings.find((i) => !i.closed) ?? sc.innings[sc.innings.length - 1]!;
  const done = m.status === 'completed';
  const ball = async (runs: number) => {
    if (!batter.trim() || !bowler.trim()) { setErr('Enter the batter and the bowler first.'); return; }
    setErr(''); setBusy(true);
    const wide = extra === 'wide', byes = extra === 'bye' || extra === 'legbye';
    const body: Record<string, unknown> = { innings: live.number, batter: batter.trim(), bowler: bowler.trim(), runsBat: wide || byes ? 0 : runs, ...(extra ? { extraType: extra, extraRuns: wide || byes ? Math.max(runs, extra === 'wide' ? 1 : 1) : extra === 'noball' ? 1 : 0 } : {}), ...(out ? { wicket: true, wicketKind: kind } : {}) };
    try { setSc(await api<Scorecard>(`/api/staff/matches/${id}/balls`, { method: 'POST', body })); setExtra(null); setOut(false); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const undo = async () => { setErr(''); try { setSc(await api<Scorecard>(`/api/staff/matches/${id}/undo`, { method: 'POST', body: { innings: live.number } })); } catch (e: any) { setErr(e.message); } };
  const setPublic = async (p: boolean) => { try { await api(`/api/staff/matches/${id}`, { method: 'PATCH', body: { isPublic: p } }); void load(); } catch (e: any) { setErr(e.message); } };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
      <Btn kind="ghost" label="‹ Matches" onPress={onBack} style={{ alignSelf: 'flex-start' }} />
      <Text style={s.h1}>{m.title}</Text><Text style={s.muted}>{m.teamA} vs {m.teamB} · {m.overs} overs</Text>
      {sc.innings.map((i) => (
        <View key={i.number} style={[s.card, { marginTop: 12 }]}>
          <Text style={s.eyebrow}>Innings {i.number} · {i.team}</Text>
          <Text style={[s.h1, { marginBottom: 0 }]}>{i.runs}/{i.wickets} <Text style={s.muted}>({i.overs} ov)</Text></Text>
          {i.target !== null && <Text style={s.muted}>Target {i.target}</Text>}
          {i.recent.length > 0 && <Text style={[s.text, { marginTop: 6 }]}>This over: {i.recent.slice(-6).join('  ')}</Text>}
          {i.batting.map((b) => <KV key={b.name} k={`${b.name}${b.out ? ' · ' + b.out : ''}`} v={`${b.runs} (${b.balls})`} />)}
          {i.bowling.map((b) => <KV key={b.name} k={`${b.name} bowling`} v={`${b.wickets}/${b.runs} · ${b.overs} ov`} />)}
        </View>
      ))}
      {m.result && <Text style={[s.h2, { color: C.gold }]}>{m.result}</Text>}
      {!done && (<>
        <Section>Next ball</Section>
        <Field label="Batter" value={batter} onChangeText={setBatter} autoCapitalize="words" /><Field label="Bowler" value={bowler} onChangeText={setBowler} autoCapitalize="words" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXTRAS.map(([k, l]) => <Chip key={k} label={l} on={extra === k} onPress={() => setExtra(extra === k ? null : k)} />)}
          <Chip label="Wicket" on={out} onPress={() => setOut(!out)} />
        </View>
        {out && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{OUTS.map((k) => <Chip key={k} label={k} on={kind === k} onPress={() => setKind(k)} />)}</View>}
        <Text style={s.muted}>{extra === 'wide' || extra === 'bye' || extra === 'legbye' ? 'Tap the runs taken (a wide counts at least 1).' : extra === 'noball' ? 'Tap the runs scored off the bat; the no ball adds 1.' : 'Tap the runs scored.'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((r) => <View key={r} style={{ width: '22%' }}><Btn label={String(r)} onPress={() => ball(r)} disabled={busy} style={{ marginBottom: 0 }} /></View>)}
        </View>
        <Btn kind="outline" label="Undo last ball" onPress={undo} style={{ marginTop: 14 }} />
      </>)}
      {done && <Btn kind="outline" label="Undo last ball (reopens the match)" onPress={undo} />}
      <Btn kind="ghost" label={m.isPublic ? 'Hide from the website' : 'Show on the website'} onPress={() => setPublic(!m.isPublic)} />
      {!!err && <Text style={s.err}>{err}</Text>}
    </ScrollView>
  );
}
