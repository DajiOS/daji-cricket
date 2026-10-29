import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from './api';
import { BackBar, Badge, Btn, Chip, Field, KV, Loading, Section, s } from './ui';
import { C } from './theme';

// Fantasy cricket (server/src/fantasy.ts): free to play, points only, no entry fee and no prize. The ground opens a contest on a public
// match; the player picks a team from both squads with a captain (2x) and vice-captain (1.5x) until it locks; points come from the live
// score. Every action is the same API the website uses, with the person's own sign-in.

type State = 'open' | 'locked' | 'live' | 'final' | 'cancelled';
interface Summary { id: string; state: State; stateText: string; locksAt: number | null; teamSize: number; maxFromSide: number; entries: number; match: { teamA: string; teamB: string; title: string; score: string | null; result: string | null }; mine?: { teamName: string; points: number; rank: number | null; removed: boolean } | null }
interface Pick { id: string; name: string; role: 'captain' | 'vice' | null; points: number; inSquad: boolean }
interface Player { id: string; side: 'a' | 'b'; name: string; team: string; points: number }
interface Contest extends Omit<Summary, 'mine'> {
  points: Record<string, number>; pointLabels: Record<string, string>; captainTimes: number; viceCaptainTimes: number; players: Player[];
  mine: { teamName: string; points: number; rank: number | null; picks: Pick[]; captainId: string; viceCaptainId: string } | null;
  removedByGround: { reason: string | null } | null; leaderboard: { rank: number; entryId: string; teamName: string; points: number; you: boolean }[];
  you: { rank: number; teamName: string; points: number } | null; canEdit: boolean; note: string;
}
const TONE: Record<State, 'ok' | 'warn' | 'danger' | 'gold' | 'muted'> = { open: 'ok', locked: 'warn', live: 'danger', final: 'gold', cancelled: 'muted' };
const LABEL: Record<State, string> = { open: 'Open', locked: 'Locked', live: 'Live', final: 'Final', cancelled: 'Cancelled' };

export function FantasyScreen({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [d, setD] = useState<{ items: Summary[]; note: string } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setErr(''); setBusy(true); try { setD(await api('/api/fantasy')); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <One id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <BackBar title="Fantasy cricket" onBack={onBack} />
      {d && <Text style={[s.muted, { marginBottom: 10 }]}>{d.note}</Text>}
      {!!err && <View style={s.card}><Text style={s.err}>{err}</Text><Btn kind="ghost" label="Try again" onPress={load} style={{ marginBottom: 0 }} /></View>}
      {!d && !err && <Loading />}
      {d && !d.items.length && <View style={s.card}><Text style={[s.text, { fontWeight: '700' }]}>No contest right now</Text><Text style={[s.muted, { marginTop: 4 }]}>When the ground opens fantasy on a match, it shows here.</Text></View>}
      {d?.items.map((c) => (
        <View key={c.id} style={s.card}>
          <View style={s.row}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{c.match.teamA} v {c.match.teamB}</Text><Badge tone={TONE[c.state]} label={LABEL[c.state]} /></View>
          <Text style={s.muted}>{c.stateText}{c.match.score ? ` · ${c.match.score}` : ''}</Text>
          {c.mine && <Text style={[s.text, { marginTop: 4 }]}>{c.mine.removed ? `${c.mine.teamName}: removed by the ground` : `${c.mine.teamName}: ${c.mine.points} points${c.mine.rank ? `, place ${c.mine.rank} of ${c.entries}` : ''}`}</Text>}
          <Btn kind={c.state === 'open' && !c.mine ? 'primary' : 'outline'} label={c.state === 'open' ? (c.mine ? 'Change team' : 'Pick a team') : 'Leaderboard'} onPress={() => setOpen(c.id)} style={{ marginTop: 10, marginBottom: 0 }} />
        </View>
      ))}
    </ScrollView>
  );
}

function One({ id, onBack }: { id: string; onBack: () => void }) {
  const [c, setC] = useState<Contest | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [chosen, setChosen] = useState<string[]>([]); const [cap, setCap] = useState(''); const [vc, setVc] = useState('');
  const load = useCallback(async () => {
    try {
      const x = await api<Contest>(`/api/fantasy/${id}`); setC(x); setErr('');
      if (x.mine) { const keep = x.mine.picks.filter((p) => p.inSquad).map((p) => p.id); setName(x.mine.teamName); setChosen(keep); setCap(keep.includes(x.mine.captainId) ? x.mine.captainId : ''); setVc(keep.includes(x.mine.viceCaptainId) ? x.mine.viceCaptainId : ''); }
    } catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!c) return <View style={s.screen}>{err ? <Text style={[s.err, { padding: 60 }]}>{err}</Text> : <Loading />}</View>;
  const toggle = (pid: string) => setChosen((x) => {
    if (x.includes(pid)) { if (cap === pid) setCap(''); if (vc === pid) setVc(''); return x.filter((y) => y !== pid); }
    return x.length >= c.teamSize ? x : [...x, pid];
  });
  const save = async () => {
    setErr(''); setNote('');
    if (name.trim().length < 3) { setErr('Give your team a name (3 letters or more).'); return; }
    if (chosen.length !== c.teamSize) { setErr(`Pick exactly ${c.teamSize} players.`); return; }
    if (!cap || !vc) { setErr('Pick a captain and a vice-captain.'); return; }
    setBusy(true);
    try { await api(`/api/fantasy/${id}/entry`, { method: 'PUT', body: { teamName: name.trim(), players: chosen, captain: cap, viceCaptain: vc } }); setNote('Your team is in. You can change it until the contest locks.'); void load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const withdraw = () => Alert.alert('Withdraw your team', 'Take your team out of this contest? You can enter again before it locks.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: async () => { try { await api(`/api/fantasy/${id}/entry`, { method: 'DELETE' }); setNote('Your team is out.'); setChosen([]); setCap(''); setVc(''); void load(); } catch (e: any) { setErr(e.message); } } },
  ]);
  const picked = c.players.filter((p) => chosen.includes(p.id));
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.gold} />}>
      <BackBar title={`${c.match.teamA} v ${c.match.teamB}`} onBack={onBack} />
      <View style={s.row}><Badge tone={TONE[c.state]} label={LABEL[c.state]} /><Text style={[s.muted, { flex: 1, marginLeft: 8 }]}>{c.stateText}{c.match.score ? ` · ${c.match.score}` : ''}</Text></View>
      {c.match.result && <Text style={[s.h2, { color: C.gold }]}>{c.match.result}</Text>}
      {!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {c.removedByGround && <Text style={s.err}>The ground removed your team from this contest{c.removedByGround.reason ? `: ${c.removedByGround.reason}` : ''}.</Text>}
      {c.canEdit && (<>
        <Section>Your team</Section>
        <Field label="Team name" value={name} onChangeText={setName} maxLength={24} />
        <Text style={s.muted}>{chosen.length} of {c.teamSize} picked · at most {c.maxFromSide} from one team</Text>
        {(['a', 'b'] as const).map((side) => (
          <View key={side} style={[s.card, { marginTop: 8 }]}>
            <Text style={s.eyebrow}>{side === 'a' ? c.match.teamA : c.match.teamB}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{c.players.filter((p) => p.side === side).map((p) => <Chip key={p.id} label={p.name} on={chosen.includes(p.id)} onPress={() => toggle(p.id)} />)}</View>
          </View>
        ))}
        {picked.length > 0 && (<>
          <Text style={[s.eyebrow, { marginTop: 10 }]}>Captain ({c.captainTimes}x)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{picked.map((p) => <Chip key={p.id} label={p.name} on={cap === p.id} onPress={() => { setCap(p.id); if (vc === p.id) setVc(''); }} />)}</View>
          <Text style={[s.eyebrow, { marginTop: 10 }]}>Vice-captain ({c.viceCaptainTimes}x)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{picked.map((p) => <Chip key={p.id} label={p.name} on={vc === p.id} onPress={() => { setVc(p.id); if (cap === p.id) setCap(''); }} />)}</View>
        </>)}
        <Btn label={c.mine ? 'Save changes' : 'Enter this team'} onPress={save} busy={busy} style={{ marginTop: 12 }} />
        {c.mine && <Btn kind="ghost" label="Withdraw my team" onPress={withdraw} />}
        <Text style={s.muted}>{c.entries} {c.entries === 1 ? 'team' : 'teams'} in so far. Other teams show once the contest locks.</Text>
      </>)}
      {!c.canEdit && c.mine && (<View style={s.card}>
        <Text style={[s.text, { fontWeight: '700' }]}>{c.mine.teamName}: {c.mine.points} points{c.mine.rank ? `, place ${c.mine.rank} of ${c.entries}` : ''}</Text>
        {c.mine.picks.map((p) => <KV key={p.id} k={`${p.name}${p.role === 'captain' ? ' (C)' : p.role === 'vice' ? ' (VC)' : ''}`} v={String(p.points)} />)}
      </View>)}
      {c.leaderboard.length > 0 && (<>
        <Section>Leaderboard</Section>
        <View style={s.card}>
          {c.leaderboard.map((x) => <KV key={x.entryId} k={`${x.rank}. ${x.teamName}${x.you ? ' (you)' : ''}`} v={String(x.points)} bold={x.you} />)}
          {c.you && !c.leaderboard.some((x) => x.you) && <KV k={`${c.you.rank}. ${c.you.teamName} (you)`} v={String(c.you.points)} bold />}
        </View>
      </>)}
      {c.state !== 'open' && (<><Section>Player points</Section><View style={s.card}>{c.players.map((p) => <KV key={p.id} k={`${p.name} · ${p.team}`} v={String(p.points)} />)}</View></>)}
      <Section>How points work</Section>
      <View style={s.card}>
        {Object.keys(c.points).map((k) => <KV key={k} k={c.pointLabels[k] ?? k} v={String(c.points[k])} />)}
        <Text style={[s.muted, { marginTop: 6 }]}>{c.note}</Text>
      </View>
      {!!err && <Text style={s.err}>{err}</Text>}
    </ScrollView>
  );
}
