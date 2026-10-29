// Fantasy cricket (server/src/fantasy.ts): free to play, points only, no entry fee and no prize. The ground opens a contest on a public
// match with both squads, before its first ball; players pick teams in the app or on the website; points come from the ball by ball score.
// Here: the contests, opening one, a contest's table and player points, removing a team with a reason, calling a contest off, and the season.
import { useState } from 'react';
import { Chip, Confirm, Field, Modal, Stat, Table, Tabs, useToast } from '../../ui';
import { fmtDateTime, patch, post, useApi } from '../../lib';
import { Async, errMsg } from './common';

type State = 'open' | 'locked' | 'live' | 'final' | 'cancelled';
interface Summary { id: string; state: State; stateText: string; locksAt: number | null; teamSize: number; maxFromSide: number; entries: number; match: { id: string; title: string; teamA: string; teamB: string; scheduledFor: number | null; groundName: string | null; result: string | null; score: string | null } }
interface Ready { id: string; title: string; teamA: string; teamB: string; scheduledFor: number | null; playersPerSide: number; squadA: number; squadB: number; canOpen: boolean; why: string | null }
interface List { items: Summary[]; matches: Ready[]; points: Record<string, number>; pointLabels: Record<string, string> }
interface Pick { id: string; name: string; team: string | null; role: 'captain' | 'vice' | null; points: number; inSquad: boolean }
interface Row { entryId: string; teamName: string; points: number; rank: number; picks: Pick[]; playerName: string | null }
interface Detail extends Summary { points: Record<string, number>; pointLabels: Record<string, string>; players: { id: string; name: string; team: string; points: number; breakdown: { label: string; points: number }[] }[]; leaderboard: Row[]; removed: { entryId: string; teamName: string; reason: string | null; at: number }[] }
interface Season { contests: number; players: number; table: { rank: number; teamName: string; points: number; contests: number; wins: number }[] }

const TONE: Record<State, 'good' | 'bad' | 'info' | 'mute' | 'warn'> = { open: 'good', locked: 'warn', live: 'bad', final: 'info', cancelled: 'mute' };
const LABEL: Record<State, string> = { open: 'Open', locked: 'Locked', live: 'Live', final: 'Final', cancelled: 'Cancelled' };
const FREE = 'Free to play: points only. There is no entry fee and no prize.';

export default function Fantasy() {
  const [list, error, reload] = useApi<List>('/api/staff/fantasy');
  const [view, setView] = useState<'contests' | 'season'>('contests');
  const [open, setOpen] = useState<Ready | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Async data={list} error={error}>{(d) => (
      <div className="stack">
        <div className="grid g3"><Stat label="Open for teams" value={d.items.filter((x) => x.state === 'open').length} /><Stat label="Live or locked" value={d.items.filter((x) => x.state === 'live' || x.state === 'locked').length} /><Stat label="Teams entered" value={d.items.reduce((n, x) => n + x.entries, 0)} /></div>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Tabs value={view} onChange={setView} items={[['contests', 'Contests'], ['season', 'Season table']]} label="Fantasy" />
          <span className="hint small">{FREE}</span>
        </div>
        {view === 'season' ? <SeasonTable /> : <>
          <div className="card"><div className="card-head"><h3>Contests</h3></div>
            <Table rows={d.items} rowKey={(x) => x.id} onRow={(x) => setPick(x.id)} empty="No fantasy contests yet. Open one on a match below." cols={[
              { head: 'Match', cell: (x) => <><span className="strong nw">{x.match.teamA} v {x.match.teamB}</span><div className="muted small nw">{x.match.title}{x.match.score ? ` · ${x.match.score}` : ''}</div></> },
              { head: 'State', cell: (x) => <Chip tone={TONE[x.state]}>{LABEL[x.state]}</Chip> },
              { head: 'Locks', cell: (x) => (x.locksAt ? fmtDateTime(x.locksAt) : 'At the first ball') },
              { head: 'Team', cell: (x) => `${x.teamSize}, at most ${x.maxFromSide} a side` },
              { head: 'Teams', num: true, cell: (x) => x.entries },
            ]} />
          </div>
          <div className="card"><div className="card-head"><h3>Matches that can have a contest</h3></div>
            <Table rows={d.matches} rowKey={(x) => x.id} empty="No match is waiting. Create a match, add both squads in the scorer and show it on the website." cols={[
              { head: 'Match', cell: (x) => <><span className="strong nw">{x.teamA} v {x.teamB}</span><div className="muted small nw">{x.title}{x.scheduledFor ? ` · ${fmtDateTime(x.scheduledFor)}` : ''}</div></> },
              { head: 'Squads', cell: (x) => `${x.squadA} + ${x.squadB}` },
              { head: '', cell: (x) => (x.canOpen ? <button className="btn primary sm" onClick={() => setOpen(x)}>Open fantasy</button> : <span className="muted small">{x.why}</span>) },
            ]} />
          </div>
          <details className="card card-pad"><summary className="strong">Points table</summary>
            <Table rows={Object.keys(d.points)} rowKey={(k) => k} cols={[{ head: 'For', cell: (k) => d.pointLabels[k] ?? k }, { head: 'Points', num: true, cell: (k) => d.points[k] }]} />
            <p className="hint small">The captain's points count twice and the vice-captain's one and a half times. The table is copied onto each contest when it opens.</p>
          </details>
        </>}
        {open && <OpenDialog m={open} onClose={() => setOpen(null)} onSaved={(id) => { reload(); setPick(id); }} />}
        {pick && <ContestDialog id={pick} onClose={() => { setPick(null); reload(); }} />}
      </div>
    )}</Async>
  );
}

function OpenDialog({ m, onClose, onSaved }: { m: Ready; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const total = m.squadA + m.squadB;
  const size0 = Math.min(11, m.playersPerSide, total);
  const [f, setF] = useState({ size: String(size0), most: String(size0 - 1), lock: m.scheduledFor ? new Date(m.scheduledFor + 330 * 60000).toISOString().slice(0, 16) : '' });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const locksAt = f.lock ? Date.parse(f.lock + ':00+05:30') : undefined;
    try { const r = await post<{ id: string }>('/api/staff/fantasy', { matchId: m.id, teamSize: Number(f.size), maxFromSide: Number(f.most), ...(locksAt ? { locksAt } : {}) }); toast('Fantasy is open for this match.'); onClose(); onSaved(r.id); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={`Open fantasy: ${m.teamA} v ${m.teamB}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Open fantasy</button></>}>
      <div className="form-grid">
        <Field label="Players in a fantasy team" hint={`From the ${total} in the two squads`}><input className="inp" type="number" min={2} max={Math.min(11, total)} value={f.size} onChange={(e) => setF((x) => ({ ...x, size: e.target.value }))} /></Field>
        <Field label="Most from one team"><input className="inp" type="number" min={1} max={10} value={f.most} onChange={(e) => setF((x) => ({ ...x, most: e.target.value }))} /></Field>
        <Field label="Teams lock at (IST)" hint="Empty: at the first ball. Teams always lock at the first ball." full><input className="inp" type="datetime-local" value={f.lock} onChange={(e) => setF((x) => ({ ...x, lock: e.target.value }))} /></Field>
      </div>
      <p className="hint small" style={{ marginTop: 10 }}>{FREE} Players pick from the squads in the app or on the website.</p>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

function ContestDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const [d, error, reload] = useApi<Detail>(`/api/staff/fantasy/${id}`);
  const [tab, setTab] = useState<'table' | 'players' | 'removed'>('table');
  const [team, setTeam] = useState<Row | null>(null);
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); toast(done); reload(); } catch (e) { toast(errMsg(e)); } };
  const ask = (what: string) => { const r = window.prompt(`Reason (${what}), shown to the player:`); return r && r.trim().length >= 3 ? r.trim() : null; };
  return (
    <Modal wide title={d ? `Fantasy: ${d.match.teamA} v ${d.match.teamB}` : 'Fantasy'} onClose={onClose} foot={<>
      {d && d.state !== 'cancelled' && <Confirm className="btn ghost" label="Call off the contest" ask="Call this contest off? The teams are kept and it leaves the season table." onYes={() => { const r = ask('calling it off'); if (r) void act(() => post(`/api/staff/fantasy/${id}/cancel`, { reason: r }), 'Contest called off.'); }} />}
      {d?.state === 'open' && d.locksAt && <button className="btn ghost" onClick={() => act(() => patch(`/api/staff/fantasy/${id}`, { locksAt: null }), 'Teams now lock at the first ball.')}>Lock at the first ball instead</button>}
      <button className="btn primary" onClick={onClose}>Done</button></>}>
      <Async data={d} error={error}>{(c) => (
        <div className="stack">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Chip tone={TONE[c.state]}>{LABEL[c.state]}</Chip><span className="muted small">{c.stateText}{c.match.score ? ` · ${c.match.score}` : ''}{c.match.result ? ` · ${c.match.result}` : ''}</span></div>
          <div className="grid g3"><Stat label="Teams" value={c.entries} /><Stat label="Team size" value={`${c.teamSize} (max ${c.maxFromSide} a side)`} /><Stat label="Leader" value={c.leaderboard[0] && c.state !== 'open' ? `${c.leaderboard[0].teamName}, ${c.leaderboard[0].points}` : '–'} /></div>
          <Tabs value={tab} onChange={setTab} items={[['table', 'Leaderboard'], ['players', 'Player points'], ['removed', `Removed (${c.removed.length})`]]} label="Contest" />
          {tab === 'table' && <Table rows={c.leaderboard} rowKey={(x) => x.entryId} onRow={setTeam} empty="No teams yet." cols={[
            { head: '#', num: true, cell: (x) => x.rank },
            { head: 'Team', cell: (x) => <><span className="strong">{x.teamName}</span>{x.playerName && <div className="muted small">{x.playerName}</div>}{x.picks.some((p) => !p.inSquad) && <div className="small" style={{ color: 'var(--warn, #b45309)' }}>A player left the squad</div>}</> },
            { head: 'Captain', cell: (x) => x.picks.find((p) => p.role === 'captain')?.name ?? '–' },
            { head: 'Points', num: true, cell: (x) => x.points },
            { head: '', cell: (x) => <span onClick={(e) => e.stopPropagation()}><button className="btn ghost sm" onClick={() => { const r = ask('removing this team'); if (r) void act(() => post(`/api/staff/fantasy/${id}/entries/${x.entryId}/remove`, { reason: r }), 'Team removed.'); }}>Remove</button></span> },
          ]} />}
          {tab === 'players' && <Table rows={c.players} rowKey={(x) => x.id} empty="No squad." cols={[
            { head: 'Player', cell: (x) => <><span className="strong">{x.name}</span><div className="muted small">{x.team}</div></> },
            { head: 'How', cell: (x) => <span className="small">{x.breakdown.map((b) => `${b.label} ${b.points > 0 ? '+' : ''}${b.points}`).join(' · ') || '–'}</span> },
            { head: 'Points', num: true, cell: (x) => x.points },
          ]} />}
          {tab === 'removed' && <Table rows={c.removed} rowKey={(x) => x.entryId} empty="No team has been removed." cols={[{ head: 'Team', cell: (x) => x.teamName }, { head: 'Reason', cell: (x) => x.reason ?? '–' }, { head: 'When', cell: (x) => fmtDateTime(x.at) }]} />}
          {team && <div className="card card-pad"><div className="row" style={{ justifyContent: 'space-between' }}><b>{team.teamName}: {team.points} points</b><button className="btn ghost sm" onClick={() => setTeam(null)}>Close</button></div>
            {team.picks.map((p) => <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}><span>{p.name}{p.role === 'captain' ? ' (C)' : p.role === 'vice' ? ' (VC)' : ''}{p.team ? <span className="muted small"> · {p.team}</span> : null}</span><b>{p.points}</b></div>)}</div>}
          <p className="hint small">{FREE} Points come from the ball by ball score, so an undone ball changes them at once.</p>
        </div>
      )}</Async>
    </Modal>
  );
}

function SeasonTable() {
  const [d, error] = useApi<Season>('/api/staff/fantasy/season');
  return (
    <Async data={d} error={error}>{(s) => (
      <div className="card"><div className="card-head"><h3>Season table</h3><span className="muted small">{s.contests} finished contests · {s.players} players</span></div>
        <Table rows={s.table} rowKey={(x) => `${x.rank}-${x.teamName}`} empty="No finished contests yet." cols={[
          { head: '#', num: true, cell: (x) => x.rank }, { head: 'Team', cell: (x) => <span className="strong">{x.teamName}</span> },
          { head: 'Contests', num: true, cell: (x) => x.contests }, { head: 'Wins', num: true, cell: (x) => x.wins }, { head: 'Points', num: true, cell: (x) => x.points },
        ]} />
      </div>
    )}</Async>
  );
}
