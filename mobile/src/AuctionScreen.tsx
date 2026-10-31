import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Avatar, BackBar, Badge, Btn, Chip, DateField, Field, Loading, Section, s, todayIST, Empty } from './ui';
import { C, formatPhone, niceDate } from './theme';

// Tournaments a customer hosts (server/src/auction.ts): teams are picked at a live player auction (players sign up with their
// own profile, team owners bid in points, the host brings the hammer down), or teams enter directly for a round robin or knockout.
// Either way the host pays a refundable hosting deposit (or asks the ground to waive it) before players see it.
// The purse and every bid are points, never money; the deposit is paid at the ground or by UPI and staff record it. Every action is the same API the website uses, with the person's own sign-in.

interface Summary { id: string; mode: 'auction' | 'teams'; depositSettled: boolean; name: string; startDate: string; endDate: string; groundName: string | null; status: string; statusText: string; hostName: string; youHost: boolean; youPlay: boolean; teams: number; players: number; sold: number; hidden: boolean; signUpOpen: boolean }
interface Team { id: string; name: string; ownerName: string | null; ownerIsYou: boolean; squad: number; pursePointsLeft: number; maxBidPoints: number; full: boolean; players: { name: string; points: number }[] }
interface Player { id: string; name: string; avatarUrl: string | null; roleText: string; batting: string | null; bowling: string | null; status: string; isYou: boolean; result: string | null; teamName: string | null; points: number | null }
interface Lot { lotNo: number; round: number; player: Player; bidPoints: number | null; bidTeamId: string | null; bidTeamName: string | null; nextMinimumPoints: number; startedAt: number | null }
interface View_ { changed?: boolean; auction: Summary; version: number; rules: { bidTimerSeconds: number; teamCount: number }; rulesVersion: number; rulesInWords: string[]; teams: Team[]; players: Player[]; lot: Lot | null; isHost: boolean; hiddenReason: string | null; canEditRules: boolean; morePlayersToCome: boolean | null; recent: { lotNo: number; player: string; result: string; teamName: string | null; points: number | null }[]; deposit: Deposit | null; depositHowToPay: HowToPay | null }
interface Deposit { requiredPaise: number; collectedPaise: number; heldPaise: number; waived: boolean; waiver: { status: string; decisionNote: string | null } | null; claimReference: string | null; settled: boolean; entries: { id: string; kind: 'collect' | 'refund' | 'keep'; amountPaise: number; reason: string | null; createdAt: number }[] }
interface HowToPay { upiId: string | null; payee: string; contactName: string; contactPhone: string }
interface Draft { rules: unknown; rulesVersion: number; changes: { label: string; from: string; to: string }[]; message: string | null; refused: boolean }

const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const KIND_WORDS = { collect: 'Paid', refund: 'Given back', keep: 'Kept' } as const;
const pts = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n.toLocaleString('en-IN')} pts`);
const key = () => `au-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const post = <T = any,>(path: string, body: unknown = {}, idem = false) => api<T>(path, { method: 'POST', body, headers: idem ? { 'Idempotency-Key': key() } : undefined });
const ROLES: [string, string][] = [['batter', 'Batter'], ['bowler', 'Bowler'], ['all_rounder', 'All-rounder'], ['wicket_keeper', 'Keeper']];

export function AuctionScreen({ aiName, onBack, openId }: { aiName: string; onBack: () => void; openId?: string | null }) {
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [d, setD] = useState<{ open: Summary[]; hosting: Summary[]; playing: Summary[]; teamsYouOwn: Summary[]; defaultsInWords: string[]; grounds: { id: string; name: string }[]; depositPaise: number } | null>(null);
  const [err, setErr] = useState('');
  const [hosting, setHosting] = useState(false);
  const load = useCallback(async () => { setErr(''); try { setD(await api('/api/auctions')); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <One id={open} aiName={aiName} onBack={() => { setOpen(null); void load(); }} />;
  if (hosting && d) return <HostForm d={d} aiName={aiName} onBack={() => setHosting(false)} onMade={(id) => { setHosting(false); setOpen(id); }} />;
  const card = (a: Summary) => (
    <View key={a.id} style={s.card}>
      <View style={s.row}><Text style={[s.h2, { flex: 1 }]}>{a.name}</Text><Badge tone={a.hidden ? 'danger' : a.status === 'live' ? 'gold' : 'muted'} label={a.statusText} /></View>
      <Text style={s.muted}>{niceDate(a.startDate)} to {niceDate(a.endDate)}{a.groundName ? ` · ${a.groundName}` : ''} · hosted by {a.hostName}</Text>
      <Text style={s.muted}>{a.mode === 'teams' ? `${a.teams} teams enter directly` : `${a.teams} teams · ${a.players} players · ${a.sold} picked${a.youPlay ? ' · you are signed up' : ''}`}</Text>
      <Btn kind="outline" label="Open" onPress={() => setOpen(a.id)} style={{ marginTop: 10, marginBottom: 0 }} />
    </View>
  );
  const mine = d ? [...d.playing, ...d.teamsYouOwn.filter((a) => !d.playing.some((p) => p.id === a.id))] : [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.gold} />}>
      <BackBar title="Hosted tournaments" onBack={onBack} />
      <Text style={s.muted}>Host a tournament (teams picked at a player auction, or teams entering directly), or sign up for an auction as a player with your profile. Purses and bids are points, not money.</Text>
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Host a tournament" onPress={() => setHosting(true)} disabled={!d} style={{ marginTop: 12 }} />
      {!d ? (!err && <Loading />) : <>
        {!!d.hosting.length && <><Section>You host</Section>{d.hosting.map(card)}</>}
        {!!mine.length && <><Section>You play or own a team</Section>{mine.map(card)}</>}
        <Section>Open now</Section>
        {d.open.filter((a) => !a.youHost).length ? d.open.filter((a) => !a.youHost).map(card) : <Empty icon="trophy-outline" text="No hosted tournaments are open right now." />}
      </>}
    </ScrollView>
  );
}

function HostForm({ d, aiName, onBack, onMade }: { d: { grounds: { id: string; name: string }[]; defaultsInWords: string[]; depositPaise: number }; aiName: string; onBack: () => void; onMade: (id: string) => void }) {
  const [f, setF] = useState({ name: '', groundId: d.grounds[0]?.id ?? '', startDate: '', endDate: '', overs: '10', mode: 'auction' as 'auction' | 'teams' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const make = async () => {
    setErr('');
    if (!f.name.trim() || !f.startDate || !f.endDate) { setErr('Enter the tournament name and the days it starts and ends.'); return; }
    setBusy(true);
    try { const v = await post<View_>('/api/auctions', { name: f.name.trim(), mode: f.mode, groundId: f.groundId, startDate: f.startDate, endDate: f.endDate, overs: Number(f.overs) }, true); onMade(v.auction.id); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} keyboardShouldPersistTaps="handled">
      <BackBar title="Host a tournament" onBack={onBack} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Chip label="Player auction picks the teams" on={f.mode === 'auction'} onPress={() => setF({ ...f, mode: 'auction' })} />
        <Chip label="Teams enter directly" on={f.mode === 'teams'} onPress={() => setF({ ...f, mode: 'teams' })} />
      </View>
      <Field label="Tournament name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoCapitalize="words" placeholder="Gully Premier League" />
      {d.grounds.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>{d.grounds.map((g) => <Chip key={g.id} label={g.name} on={f.groundId === g.id} onPress={() => setF({ ...f, groundId: g.id })} />)}</View>}
      <DateField label="Starts" value={f.startDate} onChange={(v) => setF({ ...f, startDate: v })} placeholder={`e.g. ${todayIST().split('-').reverse().join('/')}`} />
      <DateField label="Ends" value={f.endDate} onChange={(v) => setF({ ...f, endDate: v })} />
      <Field label="Overs a side" value={f.overs} onChangeText={(v) => setF({ ...f, overs: v })} keyboardType="number-pad" />
      {f.mode === 'auction' && <>
        <Section>Starting rules</Section>
        {d.defaultsInWords.map((t, i) => <Text key={i} style={[s.text, { marginBottom: 6 }]}>{i + 1}. {t}</Text>)}
        <Text style={[s.muted, { marginVertical: 8 }]}>You can change any rule before the bidding starts by asking {aiName}.</Text>
      </>}
      {d.depositPaise > 0 && <Text style={[s.muted, { marginVertical: 8 }]}>Hosting needs a refundable deposit of {rs(d.depositPaise)}. Players see your tournament once it is paid, and you get it back when the tournament ends. You can ask the ground to waive it.</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Create the tournament" onPress={make} busy={busy} />
    </ScrollView>
  );
}

function One({ id, aiName, onBack }: { id: string; aiName: string; onBack: () => void }) {
  const [v, setV] = useState<View_ | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState('batter');
  const [ask, setAsk] = useState(''); const [draft, setDraft] = useState<Draft | null>(null);
  const [team, setTeam] = useState({ name: '', ownerPhone: '' });
  const [now, setNow] = useState(Date.now());
  const ver = useRef(0);
  const take = (x: View_) => { if (x && x.auction) { ver.current = x.version; setV(x); } };
  const load = useCallback(async (quiet = false) => {
    try { const x = await api<View_>(`/api/auctions/${id}${quiet && ver.current ? `?since=${ver.current}` : ''}`); if (x.changed !== false) take(x); setErr(''); }
    catch (e: any) { if (!quiet) setErr(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // during the bidding the screen follows along every 2 seconds while it is open; otherwise every 15
  useEffect(() => {
    const live = v?.auction.status === 'live';
    const t = setInterval(() => { if (AppState.currentState === 'active') void load(true); setNow(Date.now()); }, live ? 2000 : 15000);
    const c = live ? setInterval(() => setNow(Date.now()), 1000) : null;
    return () => { clearInterval(t); if (c) clearInterval(c); };
  }, [v?.auction.status, load]);
  const act = async (fn: () => Promise<View_ | any>) => { setBusy(true); setErr(''); try { const x = await fn(); if (x?.auction) take(x); return x; } catch (e: any) { setErr(e.message); return null; } finally { setBusy(false); } };
  const sure = (title: string, then: () => void) => Alert.alert(title, undefined, [{ text: 'Not now', style: 'cancel' }, { text: 'Yes', onPress: then }]);
  if (!v) return <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]}><BackBar title="Auction" onBack={onBack} />{err ? <Text style={s.err}>{err}</Text> : <Loading />}</ScrollView>;
  const a = v.auction, lot = v.lot, me = v.players.find((p) => p.isYou && p.status === 'registered');
  const myTeams = v.teams.filter((t) => t.ownerIsYou);
  const left = lot ? Math.max(0, Math.ceil(((lot.startedAt ?? now) + v.rules.bidTimerSeconds * 1000 - now) / 1000)) : 0;
  const bidRow = (t: Team) => {
    const can = !!lot && !t.full && t.maxBidPoints >= lot.nextMinimumPoints && lot.bidTeamId !== t.id;
    return (<View key={t.id} style={[s.row, { marginBottom: 6 }]}>
      <Text style={[s.text, { flex: 1 }]}>{t.name}{'\n'}<Text style={s.muted}>{t.full ? 'Squad full' : lot?.bidTeamId === t.id ? 'Highest bid' : `Up to ${pts(t.maxBidPoints)}`}</Text></Text>
      <Btn label={`Bid ${pts(lot?.nextMinimumPoints)}`} disabled={!can} busy={busy} onPress={() => act(() => post(`/api/auctions/${id}/bid`, { teamId: t.id, points: lot!.nextMinimumPoints, lotNo: lot!.lotNo }, true))} style={{ marginBottom: 0, paddingVertical: 10 }} />
    </View>);
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => load()} tintColor={C.gold} />}>
      <BackBar title={a.name} onBack={onBack} />
      <Text style={s.muted}>{niceDate(a.startDate)} to {niceDate(a.endDate)}{a.groundName ? ` · ${a.groundName}` : ''} · hosted by {a.hostName}</Text>
      <View style={{ flexDirection: 'row', marginVertical: 8 }}><Badge tone={a.hidden ? 'danger' : a.status === 'live' ? 'gold' : 'muted'} label={a.statusText} /></View>
      {a.hidden && v.isHost && <Text style={s.err}>The ground has hidden this auction{v.hiddenReason ? `: ${v.hiddenReason}` : ''}. Call the ground to sort it out.</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}

      {v.isHost && v.deposit && <DepositCard id={id} dep={v.deposit} pay={v.depositHowToPay} busy={busy} act={act} />}

      {a.status === 'live' && <View style={s.card}>
        <Text style={s.eyebrow}>Live auction</Text>
        {!lot ? <Text style={s.text}>{v.morePlayersToCome ? 'Waiting for the host to bring the next player up.' : 'Every player has come up.'}</Text> : <>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Avatar name={lot.player.name} url={lot.player.avatarUrl} size={60} />
            <View style={{ flex: 1 }}><Text style={s.h2}>{lot.player.name}</Text><Text style={s.muted}>{[lot.player.roleText, lot.player.batting ? `${lot.player.batting}-hand bat` : null, lot.player.bowling].filter(Boolean).join(' · ')}</Text></View>
          </View>
          <Text style={[s.text, { marginVertical: 10, fontSize: 18 }]} accessibilityLiveRegion="polite">{lot.bidPoints ? `Highest bid ${pts(lot.bidPoints)} by ${lot.bidTeamName}` : `Opening bid ${pts(lot.nextMinimumPoints)}`} · {left ? `${left}s` : 'time is up'}</Text>
          {(v.isHost ? v.teams : myTeams).map(bidRow)}
        </>}
        {v.recent.slice(0, 4).map((r) => <Text key={r.lotNo} style={s.muted}>{r.player}: {r.result === 'sold' ? `${r.teamName}, ${pts(r.points)}` : 'unsold'}</Text>)}
      </View>}

      {v.isHost && !a.hidden && a.status === 'live' && <View style={s.card}>
        <Text style={s.eyebrow}>Host controls</Text>
        {lot ? <Btn label={lot.bidPoints ? `Sold to ${lot.bidTeamName} for ${pts(lot.bidPoints)}` : 'Unsold: nobody bid'} busy={busy} onPress={() => act(() => post(`/api/auctions/${id}/hammer`, {}, true))} />
          : <Btn label="Bring the next player up" busy={busy} disabled={!v.morePlayersToCome} onPress={() => act(() => post(`/api/auctions/${id}/next`))} />}
        {lot?.bidPoints ? <Btn kind="outline" label="Take back the highest bid" onPress={() => act(() => post(`/api/auctions/${id}/bid/retract`))} /> : null}
        {!lot && <Btn kind="outline" label="Undo the last result" onPress={() => sure('Undo the last result?', () => act(() => post(`/api/auctions/${id}/undo`, {}, true)))} />}
        {!lot && <Btn kind="outline" label="Finish the auction" onPress={() => sure('Finish the auction? The teams go into the tournament.', () => act(() => post(`/api/auctions/${id}/finish`, {}, true)))} />}
      </View>}

      {v.isHost && !a.hidden && a.status === 'registration' && <View style={s.card}>
        <Text style={s.eyebrow}>Host controls</Text>
        {a.mode === 'teams' ? <>
          <Text style={s.muted}>{v.teams.length} of {v.rules.teamCount} teams entered. Confirm the teams when everyone is in; the fixtures can be made then.</Text>
          <Btn label="Confirm the teams" busy={busy} onPress={() => { if (!a.depositSettled) { setErr('Pay the hosting deposit (or ask the ground to waive it) first.'); return; } sure('Confirm the teams? They go into the tournament.', () => act(() => post(`/api/auctions/${id}/finish`, {}, true))); }} style={{ marginTop: 10 }} />
        </> : <>
          <Text style={s.muted}>{a.players} players signed up for {v.teams.length} teams. Start when everyone is in; sign-up and the rules close then.</Text>
          <Btn label="Start the bidding" busy={busy} onPress={() => { if (!a.depositSettled) { setErr('Pay the hosting deposit (or ask the ground to waive it) first.'); return; } sure('Start the bidding now?', () => act(() => post(`/api/auctions/${id}/start`))); }} style={{ marginTop: 10 }} />
        </>}
        {v.teams.length < v.rules.teamCount && <>
          <Field label="Team name" value={team.name} onChangeText={(x) => setTeam({ ...team, name: x })} autoCapitalize="words" />
          <Field label="Owner's phone (if they have a Daji account)" value={team.ownerPhone} onChangeText={(x) => setTeam({ ...team, ownerPhone: x })} keyboardType="phone-pad" />
          <Btn kind="outline" label="Add team" onPress={async () => { if (!team.name.trim()) { setErr('Enter the team name.'); return; } const x = await act(() => post(`/api/auctions/${id}/teams`, { name: team.name.trim(), ownerPhone: team.ownerPhone.trim() || undefined })); if (x) setTeam({ name: '', ownerPhone: '' }); }} />
        </>}
      </View>}

      <Section>Rules</Section>
      <View style={s.card}>
        {v.rulesInWords.map((t, i) => <Text key={i} style={[s.text, { marginBottom: 6 }]}>{i + 1}. {t}</Text>)}
        {v.canEditRules && <>
          <Field label={`Change the rules with ${aiName}`} value={ask} onChangeText={setAsk} placeholder="e.g. purse 20,000 points, squads of 12 to 16" multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
          <Btn kind="outline" label="Draft the change" busy={busy} onPress={async () => { if (!ask.trim()) { setErr(`Say what to change, for example "purse 20,000 points".`); return; } setDraft(null); const x = await act(() => post<Draft>(`/api/auctions/${id}/rules/draft`, { text: ask })); if (x) setDraft(x); }} />
          {draft && (draft.rules ? <>
            <Text style={s.text}>{aiName} drafted this. Nothing is saved until you confirm.</Text>
            {draft.changes.map((c) => <Text key={c.label} style={s.muted}>{c.label}: {c.from} → {c.to}</Text>)}
            <Btn label="Confirm the change" busy={busy} onPress={async () => { const x = await act(() => post(`/api/auctions/${id}/rules`, { rules: draft.rules, expectVersion: draft.rulesVersion, source: 'ai', request: ask })); if (x) { setDraft(null); setAsk(''); } }} style={{ marginTop: 8 }} />
          </> : <Text style={draft.refused ? s.err : s.muted}>{draft.message}</Text>)}
        </>}
      </View>

      <Section>Teams</Section>
      {!v.teams.length ? <Text style={s.muted}>No teams yet.</Text> : v.teams.map((t) => (
        <View key={t.id} style={s.card}>
          <View style={s.row}><Text style={s.h2}>{t.name}{t.ownerIsYou ? ' (yours)' : ''}</Text>{a.mode === 'auction' && <Text style={s.muted}>{pts(t.pursePointsLeft)} left</Text>}</View>
          {!!t.ownerName && <Text style={s.muted}>Owner {t.ownerName}</Text>}
          {!!t.players.length && <Text style={s.text}>{t.players.map((p) => `${p.name} (${pts(p.points)})`).join(', ')}</Text>}
        </View>))}

      {a.mode === 'auction' && <>
      <Section>Players ({a.players})</Section>
      {a.signUpOpen && !me && <View style={s.card}>
        <Text style={s.muted}>Sign up with your Daji profile. Your name, picture and role are shown in this auction; your phone and email are not.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 }}>{ROLES.map(([k, l]) => <Chip key={k} label={l} on={role === k} onPress={() => setRole(k)} />)}</View>
        <Btn label="Sign up as a player" busy={busy} onPress={() => act(() => post(`/api/auctions/${id}/join`, { role }, true))} />
      </View>}
      {me && a.status === 'registration' && <Btn kind="outline" label="Leave this auction" onPress={() => sure('Leave this auction?', () => act(() => post(`/api/auctions/${id}/leave`)))} />}
      {v.players.filter((p) => p.status === 'registered').map((p) => (
        <View key={p.id} style={[s.row, { paddingVertical: 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}><Avatar name={p.name} url={p.avatarUrl} size={32} /><Text style={s.text}>{p.name}{p.isYou ? ' (you)' : ''}{'\n'}<Text style={s.muted}>{p.roleText}</Text></Text></View>
          {p.result === 'sold' ? <Badge tone="ok" label={`${p.teamName} · ${pts(p.points)}`} /> : p.result === 'unsold' ? <Badge label="Unsold" /> : null}
        </View>))}
      </>}
    </ScrollView>
  );
}

/** The host's hosting deposit: what is due and how to pay, "I have paid" with a reference, a waiver request, and what was paid or given back. */
function DepositCard({ id, dep, pay, busy, act }: { id: string; dep: Deposit; pay: HowToPay | null; busy: boolean; act: (fn: () => Promise<any>) => Promise<any> }) {
  const [ref, setRef] = useState(''); const [why, setWhy] = useState(''); const [note, setNote] = useState('');
  const reload = () => api<View_>(`/api/auctions/${id}`);
  if (!dep.requiredPaise) return null;
  const due = dep.requiredPaise - dep.collectedPaise;
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>Hosting deposit</Text>
      {dep.waived ? <Text style={s.text}>The ground waived the deposit.</Text>
        : dep.settled ? <Text style={s.text}>The ground holds {rs(dep.heldPaise)} of your deposit. You get it back when the tournament ends.</Text>
        : <>
          <Text style={s.text}>{rs(due)} to pay. Players see your tournament once it is paid. You get it back when the tournament ends, unless the matches are not played at Daji.</Text>
          <Text style={[s.muted, { marginTop: 6 }]}>Pay at the ground, or by UPI{pay?.upiId ? ` to ${pay.upiId} (${pay.payee})` : ''} and send the reference here.{pay ? ` Questions: ${pay.contactName} ${formatPhone(pay.contactPhone)}.` : ''}</Text>
          {!!dep.claimReference && <Text style={s.muted}>You sent reference {dep.claimReference}. The ground will check it.</Text>}
          <Field label="UPI or bank reference" value={ref} onChangeText={setRef} autoCapitalize="characters" />
          <Btn label="I have paid" busy={busy} onPress={async () => { if (ref.trim().length < 4) { setNote('Enter the payment reference.'); return; } setNote(''); const x = await act(async () => { await post(`/api/auctions/${id}/deposit/paid`, { reference: ref.trim() }); return reload(); }); if (x) setRef(''); }} />
          {dep.waiver?.status === 'pending' ? <Text style={s.muted}>Your request to waive the deposit is with the ground.</Text> : !dep.collectedPaise && <>
            {dep.waiver?.status === 'declined' && <Text style={s.err}>The ground did not waive it{dep.waiver.decisionNote ? `: ${dep.waiver.decisionNote}` : ''}.</Text>}
            <Field label="Ask the ground to waive it: why?" value={why} onChangeText={setWhy} multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
            <Btn kind="outline" label="Send the request" busy={busy} onPress={async () => { if (why.trim().length < 10) { setNote('Say why the deposit should be waived (at least 10 characters).'); return; } setNote(''); const x = await act(async () => { await post(`/api/auctions/${id}/deposit/waiver`, { reason: why.trim() }, true); return reload(); }); if (x) setWhy(''); }} />
          </>}
          {!!note && <Text style={s.err}>{note}</Text>}
        </>}
      {dep.entries.map((e) => <Text key={e.id} style={s.muted}>{KIND_WORDS[e.kind]} {rs(e.amountPaise)} on {niceDate(new Date(e.createdAt + 19800000).toISOString().slice(0, 10))}{e.reason ? `: ${e.reason}` : ''}</Text>)}
    </View>
  );
}
