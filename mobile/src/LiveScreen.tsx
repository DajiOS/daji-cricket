import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { Innings, MatchRow, Scorecard } from './types';
import { BackBar, Badge, Icon, Loading, RoundBtn, ScreenHead, SectionHead, Segmented, hueOf, s } from './ui';
import { C, tint } from './theme';

type PublicMatch = MatchRow & { summary: string };
const LIVE_EVERY = 15000; // a live score is read again this often while it is on screen

/** Live score for everyone: the ground's own scorer (staff score ball by ball under More › Matches). Live matches first, then finished ones. */
export function LiveScreen() {
  const [list, setList] = useState<PublicMatch[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try { setList((await api<{ items: PublicMatch[] }>('/api/matches')).items); setErr(''); } catch (e: any) { setErr(e.message); setList((l) => l ?? []); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const anyLive = !!list?.some((m) => m.status === 'live');
  useEffect(() => { if (!anyLive || open) return; const t = setInterval(() => void load(), LIVE_EVERY); return () => clearInterval(t); }, [anyLive, open, load]);
  if (open) return <MatchView id={open} onBack={() => { setOpen(null); void load(); }} />;
  const live = list?.filter((m) => m.status === 'live') ?? [], done = list?.filter((m) => m.status !== 'live') ?? [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Daji Cricket Ground" title="Live score" right={<RoundBtn icon="refresh" label="Refresh" onPress={load} size={42} />} />
      {!!err && <Text style={s.err}>{err}</Text>}
      {list === null ? <Loading /> : !list.length ? (
        <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}>
          <Icon name="radio-outline" size={30} color={C.muted} />
          <Text style={[s.text, { fontWeight: '700', marginTop: 10 }]}>No matches right now</Text>
          <Text style={[s.muted, { textAlign: 'center', marginTop: 4 }]}>When a match is played and scored at the ground, its live score shows here.</Text>
        </View>
      ) : (<>
        {live.map((m) => <LiveCard key={m.id} id={m.id} onOpen={() => setOpen(m.id)} />)}
        {done.length > 0 && <SectionHead title="Recent matches" />}
        {done.map((m) => (
          <Pressable key={m.id} accessibilityRole="button" onPress={() => setOpen(m.id)} style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 14, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <View style={{ width: 52, height: 40 }}>
              {[m.teamA, m.teamB].map((tm, i) => <View key={i} style={{ position: 'absolute', left: i * 18, top: 0, width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: C.panel, backgroundColor: C.panel, overflow: 'hidden' }}><View style={{ flex: 1, backgroundColor: tint(hueOf(tm), 0.2), alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: hueOf(tm), fontWeight: '800', fontSize: 12 }}>{teamInitials(tm)}</Text></View></View>)}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{m.teamA} vs {m.teamB}</Text>
              <Text style={s.muted}>{m.title} · {m.overs} overs</Text>
              {!!m.summary && <Text style={[s.muted, { marginTop: 2 }]}>{m.summary}</Text>}
              {!!m.result && <Text style={[s.muted, { color: C.gold, fontWeight: '600', marginTop: 2 }]}>{m.result}</Text>}
            </View>
            <Icon name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ))}
      </>)}
    </ScrollView>
  );
}

const teamInitials = (t: string) => t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const Crest = ({ team }: { team: string }) => (
  <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 17 }}>{teamInitials(team)}</Text>
  </View>
);

/** The dark green score card: both teams, the score, overs, the target and the last balls. */
function ScoreBoard({ sc }: { sc: Scorecard }) {
  const m = sc.match, cur = sc.innings[sc.innings.length - 1], first = sc.innings[0];
  const live = m.status === 'live';
  return (
    <View style={{ backgroundColor: C.ink, borderRadius: 32, padding: 22, marginBottom: 14 }}>
      <View style={[s.row, { paddingVertical: 0 }]}>
        <Text style={{ color: 'rgba(255,255,255,.7)', fontSize: 13.5, fontWeight: '500', flex: 1 }} numberOfLines={1}>{m.title} · {m.overs} overs</Text>
        <View style={{ backgroundColor: live ? '#E5484D' : 'rgba(255,255,255,.18)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{live ? 'LIVE' : 'Result'}</Text></View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginVertical: 12 }}>
        <View style={{ alignItems: 'center', flex: 1 }}><Crest team={m.teamA} /><Text style={{ color: '#FFFFFF', fontWeight: '700', textAlign: 'center' }}>{m.teamA}</Text></View>
        <Text style={{ color: 'rgba(255,255,255,.7)', fontWeight: '800' }}>VS</Text>
        <View style={{ alignItems: 'center', flex: 1 }}><Crest team={m.teamB} /><Text style={{ color: '#FFFFFF', fontWeight: '700', textAlign: 'center' }}>{m.teamB}</Text></View>
      </View>
      {cur ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,.1)', borderRadius: 22, padding: 14, alignItems: 'center' }}>
            <Text style={{ color: 'rgba(255,255,255,.75)', fontSize: 12 }}>{cur.team}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '600', letterSpacing: -0.8 }}>{cur.runs}/{cur.wickets}</Text>
            <Text style={{ color: 'rgba(255,255,255,.75)', fontSize: 12 }}>{cur.overs} overs</Text>
          </View>
          {cur.target != null ? (
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,.1)', borderRadius: 22, padding: 14, alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,.75)', fontSize: 12 }}>Target</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '600', letterSpacing: -0.8 }}>{cur.target}</Text>
              <Text style={{ color: 'rgba(255,255,255,.75)', fontSize: 12 }}>{first ? `${first.team} ${first.runs}/${first.wickets}` : ''}</Text>
            </View>
          ) : null}
        </View>
      ) : <Text style={{ color: 'rgba(255,255,255,.8)', textAlign: 'center' }}>The first ball has not been bowled yet.</Text>}
      {!!m.result && <Text style={{ color: '#7EE2A2', fontWeight: '700', textAlign: 'center', marginTop: 12 }}>{m.result}</Text>}
      {!!cur?.recent.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, justifyContent: 'center' }}>
          {cur.recent.slice(-6).map((b, i) => (
            <View key={i} style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: b === 'W' ? '#E5484D' : b === '4' || b === '6' ? '#2EA45A' : 'rgba(255,255,255,.14)' }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{b}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function useScorecard(id: string) {
  const [sc, setSc] = useState<Scorecard | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setSc(await api<Scorecard>(`/api/matches/${id}`)); setErr(''); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const live = sc?.match.status === 'live';
  useEffect(() => { if (!live) return; const t = setInterval(() => void load(), LIVE_EVERY); return () => clearInterval(t); }, [live, load]);
  return { sc, err, load };
}

function LiveCard({ id, onOpen }: { id: string; onOpen: () => void }) {
  const { sc, err } = useScorecard(id);
  if (!sc) return err ? <Text style={s.err}>{err}</Text> : <Loading />;
  return <Pressable accessibilityRole="button" onPress={onOpen}><ScoreBoard sc={sc} /></Pressable>;
}

/** One match: the score card, then the batting and bowling of each innings. */
function MatchView({ id, onBack }: { id: string; onBack: () => void }) {
  const { sc, err, load } = useScorecard(id);
  const [tab, setTab] = useState<'bat' | 'bowl'>('bat');
  const [inn, setInn] = useState<number | null>(null);
  if (!sc) return <View style={[s.screen, s.pad, { paddingTop: 58 }]}><BackBar title="Match" onBack={onBack} />{err ? <Text style={s.err}>{err}</Text> : <Loading />}</View>;
  const shown: Innings | undefined = sc.innings.find((i) => i.number === inn) ?? sc.innings[sc.innings.length - 1];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.gold} />}>
      <BackBar title={sc.match.status === 'live' ? 'Live match' : 'Match'} onBack={onBack} />
      <ScoreBoard sc={sc} />
      {sc.innings.length > 1 && <Segmented items={sc.innings.map((i) => [String(i.number), i.team] as [string, string])} value={String(shown?.number ?? 1)} onChange={(v) => setInn(Number(v))} />}
      <Segmented items={[['bat', 'Batting'], ['bowl', 'Bowling']]} value={tab} onChange={setTab} />
      {shown && (
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          <Row head cells={tab === 'bat' ? ['Batter', 'R', 'B', 'SR'] : ['Bowler', 'O', 'R', 'W']} />
          {(tab === 'bat' ? shown.batting : shown.bowling).length === 0 && <Text style={[s.muted, { padding: 14 }]}>Nothing yet.</Text>}
          {tab === 'bat'
            ? shown.batting.map((b) => <Row key={b.name} cells={[b.name, String(b.runs), String(b.balls), b.balls ? (Math.round((b.runs / b.balls) * 1000) / 10).toFixed(1) : '–']} sub={b.out ?? 'not out'} />)
            : shown.bowling.map((b) => <Row key={b.name} cells={[b.name, b.overs, String(b.runs), String(b.wickets)]} />)}
        </View>
      )}
      {sc.match.status === 'live' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}><Badge tone="ok" label="Updates by itself" /></View>}
    </ScrollView>
  );
}

const Row = ({ cells, head, sub }: { cells: string[]; head?: boolean; sub?: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: head ? tint(C.gold, 0.08) : 'transparent' }}>
    <View style={{ flex: 1 }}>
      <Text style={{ color: head ? C.muted : C.text, fontSize: 13, fontWeight: head ? '700' : '600' }}>{cells[0]}</Text>
      {!!sub && <Text style={[s.muted, { fontSize: 11 }]}>{sub}</Text>}
    </View>
    {cells.slice(1).map((c, i) => <Text key={i} style={{ width: 44, textAlign: 'right', color: head ? C.muted : C.text, fontSize: 13, fontWeight: head ? '700' : '500' }}>{c}</Text>)}
  </View>
);
