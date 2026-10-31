import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Btn, KV, s } from './ui';
import { C } from './theme';

// The player's own career record, like CricHeroes: batting, bowling and fielding from every finished match where they are in a squad
// linked to their Daji profile. The server works it out from the balls; the app only shows it. A wrong match can be taken off ("not me").
interface Career {
  matches: number;
  batting: { innings: number; notOuts: number; runs: number; balls: number; fours: number; sixes: number; highest: string | null; average: number | null; strikeRate: number | null; fifties: number; hundreds: number; ducks: number };
  bowling: { innings: number; overs: string; maidens: number; runs: number; wickets: number; best: string | null; average: number | null; economy: number | null; threeWickets: number; fiveWickets: number };
  fielding: { catches: number; runOuts: number; stumpings: number };
}
interface Data { career: Career; matches: { matchId: string; title: string; date: number; groundName: string | null; team: string; opponent: string; result: string | null; summary: string }[]; note: string }

const v = (x: number | string | null) => (x === null ? '–' : String(x));
const day = (ms: number) => new Date(ms + 330 * 60000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function MyCricket() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(''); const [all, setAll] = useState(false);
  const load = useCallback(async () => { try { setD(await api<Data>('/api/my/cricket')); setErr(''); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const notMe = (m: Data['matches'][number]) => Alert.alert('This was not me', `Take ${m.team} v ${m.opponent} off your record? The ground is told, and it cannot be linked to you again.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Take it off', style: 'destructive', onPress: async () => { try { await api(`/api/my/cricket/matches/${m.matchId}/not-me`, { method: 'POST', body: {} }); void load(); } catch (e: any) { setErr(e.message); } } },
  ]);
  if (err && !d) return <View style={s.card}><Text style={s.err}>{err}</Text><Btn kind="ghost" label="Try again" onPress={load} style={{ marginBottom: 0 }} /></View>;
  if (!d) return null;
  const c = d.career, b = c.batting, w = c.bowling, f = c.fielding;
  if (!c.matches) return <View style={s.card}><Text style={[s.text, { fontWeight: '700' }]}>No scored matches yet</Text><Text style={[s.muted, { marginTop: 4 }]}>{d.note} The ground adds you to a match by your mobile number, or from your booking's team list.</Text></View>;
  return (<>
    <View style={s.card}>
      <Text style={[s.eyebrow, { color: C.gold }]}>Batting</Text>
      <KV k="Matches" v={String(c.matches)} /><KV k="Innings" v={String(b.innings)} /><KV k="Runs" v={String(b.runs)} bold /><KV k="Highest" v={v(b.highest)} />
      <KV k="Average" v={v(b.average)} /><KV k="Strike rate" v={v(b.strikeRate)} /><KV k="4s / 6s" v={`${b.fours} / ${b.sixes}`} /><KV k="50s / 100s" v={`${b.fifties} / ${b.hundreds}`} />
      <Text style={[s.eyebrow, { color: C.gold, marginTop: 12 }]}>Bowling</Text>
      <KV k="Overs" v={w.overs} /><KV k="Wickets" v={String(w.wickets)} bold /><KV k="Best" v={v(w.best)} /><KV k="Economy" v={v(w.economy)} /><KV k="Average" v={v(w.average)} /><KV k="Maidens" v={String(w.maidens)} />
      <Text style={[s.eyebrow, { color: C.gold, marginTop: 12 }]}>Fielding</Text>
      <KV k="Catches" v={String(f.catches)} /><KV k="Run outs" v={String(f.runOuts)} /><KV k="Stumpings" v={String(f.stumpings)} />
    </View>
    {(all ? d.matches : d.matches.slice(0, 5)).map((m) => (
      <View key={m.matchId} style={s.card}>
        <Text style={[s.text, { fontWeight: '700' }]}>{m.team} v {m.opponent}</Text>
        <Text style={s.muted}>{day(m.date)}{m.groundName ? ` · ${m.groundName}` : ''}{m.result ? ` · ${m.result}` : ''}</Text>
        <Text style={[s.text, { marginTop: 4 }]}>{m.summary}</Text>
        <Btn kind="link" label="This was not me" onPress={() => notMe(m)} style={{ alignSelf: 'flex-start', marginBottom: 0 }} />
      </View>
    ))}
    {d.matches.length > 5 && <Btn kind="ghost" label={all ? 'Show fewer' : `Show all ${d.matches.length} matches`} onPress={() => setAll(!all)} />}
    {!!err && <Text style={s.err}>{err}</Text>}
  </>);
}
