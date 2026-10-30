// The cricket network: businesses that share player profiles (each player's own choice), run tournaments across their grounds, and keep
// their bookings, payments, staff, private records and books to themselves. /network is the overview, /network/tournaments and
// /network/tournaments/<id> the tournaments, /network/duplicates the possible duplicate profiles, /network/players the profile search.
import { useState } from 'react';
import { Chip, ErrorBox, Field, Load, Modal, PageHead, Status, Table, Tabs, DateInput, useToast } from '../ui';
import { fmtDate, fmtDateTime, go, post, put, useApi } from '../lib';
import { useSession } from '../App';
import { NET, NT, T_STATUS, FORMAT, useAct, type Status as NetStatus, type Summary } from '../parts/network/shared';
import { NetTournament } from '../parts/network/Tournament';

type Tab = 'overview' | 'tournaments' | 'duplicates' | 'players';

export default function Network({ sub }: { sub: string }) {
  const parts = sub.replace(/^\//, '').split('/');
  if (parts[0] === 'tournaments' && parts[1]) return <NetTournament id={parts[1]} key={parts[1]} />;
  const tab = (['tournaments', 'duplicates', 'players'].includes(parts[0]!) ? parts[0] : 'overview') as Tab;
  return (
    <div className="stack">
      <PageHead eyebrow="Compete" title="Cricket network" lede="Tournaments across grounds, and player profiles each player chooses to share. Your bookings, payments, staff and books stay yours." />
      <Tabs<Tab> value={tab} onChange={(t) => go(t === 'overview' ? '/network' : '/network/' + t)} label="Sections"
        items={[['overview', 'Overview'], ['tournaments', 'Tournaments'], ['duplicates', 'Possible duplicates'], ['players', 'Players']]} />
      {tab === 'overview' && <Overview />}
      {tab === 'tournaments' && <Tournaments />}
      {tab === 'duplicates' && <Duplicates />}
      {tab === 'players' && <Players />}
    </div>
  );
}

function Overview() {
  const toast = useToast();
  const { me } = useSession();
  const [d, err, reload, status] = useApi<NetStatus>(NET);
  const a = useAct(reload, toast);
  return (
    <Load data={d} error={err} status={status} retry={reload}>{(d) => <div className="stack">
      <ErrorBox msg={a.err} />
      <div className="card card-pad stack">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><b>{d.joined ? 'Your business is in the cricket network' : 'Your business is not in the cricket network'}</b>
            <div className="small muted">{d.joined && d.joinedAt ? `Joined ${fmtDateTime(d.joinedAt)}. ` : ''}{d.note}</div></div>
          {d.canChange && (d.joined
            ? <button className="btn" disabled={a.busy} onClick={() => a.act(() => post(`${NET}/leave`), 'Left the cricket network')}>Leave the network</button>
            : <button className="btn primary" disabled={a.busy} onClick={() => a.act(() => post(`${NET}/join`), 'Joined the cricket network')}>Join the network</button>)}
        </div>
        {!d.canChange && <div className="small muted">Only the owner can join or leave.</div>}
      </div>
      <div className="grid g2">
        <div className="card"><div className="card-head"><h3>What a player can share</h3></div><div className="card-pad stack small">
          {d.sharedFields.map((f) => <div key={f}>{f}</div>)}<div className="muted">{d.eligibleRule}</div>
          <div className="muted">A profile is private until its player chooses grounds in the network or everyone.</div></div></div>
        <div className="card"><div className="card-head"><h3>Never shared</h3></div><div className="card-pad stack small">{d.neverShared.map((f) => <div key={f}>{f}</div>)}</div></div>
      </div>
      {d.joined && <div className="card"><div className="card-head"><h3>Businesses in the network</h3></div>
        <Table rows={d.members} rowKey={(m) => m.ownerId}
          cols={[
            { head: 'Business', cell: (m) => <><b>{m.name}</b>{m.isMe && <Chip tone="info">You</Chip>}</> },
            { head: 'Grounds', cell: (m) => m.grounds.map((g) => `${g.name} (${g.city})`).join(', ') || '—' },
            { head: 'Joined', cell: (m) => fmtDateTime(m.joinedAt) },
          ]} /></div>}
      <div className="card card-pad stack">
        <b>Children's profiles: {d.childProfiles.on ? <Chip tone="good">On</Chip> : <Chip tone="warn">Off</Chip>}</b>
        <div className="small muted">{d.childProfiles.note}</div>
        {d.childProfiles.on && d.childProfiles.legalReviewRef && <div className="small">Review on record: {d.childProfiles.legalReviewRef}</div>}
        {me.role === 'super_admin' && <ChildSwitch on={d.childProfiles.on} reload={reload} />}
      </div>
    </div>}</Load>
  );
}

/** The software owner's switch. Turning it on needs the reference to the legal and product review, kept as typed. */
function ChildSwitch({ on, reload }: { on: boolean; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const [ref, setRef] = useState('');
  return (
    <div className="stack">
      <ErrorBox msg={a.err} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!on && <input className="inp" style={{ minWidth: 320 }} placeholder="Legal and product review: who, when, which document" value={ref} onChange={(e) => setRef(e.target.value)} />}
        <button className={on ? 'btn' : 'btn primary'} disabled={a.busy} onClick={() => a.act(() => put('/api/admin/network/children', on ? { on: false } : { on: true, legalReviewRef: ref }), on ? 'Children\'s profiles switched off' : 'Children\'s profiles switched on')}>
          {on ? 'Switch children\'s profiles off' : 'Switch children\'s profiles on'}</button>
      </div>
    </div>
  );
}

function Tournaments() {
  const [d, err, reload, status] = useApi<{ member: boolean; items: Summary[] }>(NT);
  const [form, setForm] = useState(false);
  return (
    <Load data={d} error={err} status={status} retry={reload}>{(d) => <div className="stack">
      {d.member ? <div><button className="btn primary" onClick={() => setForm(true)}>New network tournament</button></div>
        : <div className="card card-pad small muted">Join the network on the Overview tab to organise a tournament or have your grounds invited.</div>}
      <div className="card">
        <Table rows={d.items} rowKey={(t) => t.id} onRow={(t) => go('/network/tournaments/' + t.id)} empty="No network tournaments yet."
          cols={[
            { head: 'Tournament', cell: (t) => <><b>{t.name}</b><div className="small muted">{FORMAT[t.format] ?? t.format} · {t.overs} overs · organised by {t.organiser}</div></> },
            { head: 'Dates', cell: (t) => `${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}` },
            { head: 'Status', cell: (t) => <Status s={t.status} map={T_STATUS} /> },
            { head: 'Your role', cell: (t) => (t.myRole === 'organiser' ? 'Organiser' : 'Host ground') },
            { head: 'Waiting for you', cell: (t) => <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {t.invitationsForMe > 0 && <Chip tone="warn">{t.invitationsForMe} invitation</Chip>}
              {t.slotsForMe > 0 && <Chip tone="warn">{t.slotsForMe} slot{t.slotsForMe === 1 ? '' : 's'} to confirm</Chip>}
              {t.resultsToVerify > 0 && <Chip tone="warn">{t.resultsToVerify} result{t.resultsToVerify === 1 ? '' : 's'} to verify</Chip>}
              {!t.invitationsForMe && !t.slotsForMe && !t.resultsToVerify && <span className="muted">—</span>}</span> },
            { head: 'Confirmed', num: true, cell: (t) => `${t.confirmed}/${t.fixtures}` },
            { head: 'Verified', num: true, cell: (t) => `${t.verified}/${t.fixtures}` },
          ]} />
      </div>
      {form && <NewTournament onClose={() => setForm(false)} />}
    </div>}</Load>
  );
}

function NewTournament({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const a = useAct(() => {}, toast);
  const [v, setV] = useState({ name: '', format: 'round_robin', overs: '20', matchMinutes: '180', startDate: '', endDate: '', notes: '' });
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    let id = '';
    const ok = await a.act(async () => { const r = await post<{ tournament: { id: string } }>(NT, { ...v, overs: Number(v.overs), matchMinutes: Number(v.matchMinutes), notes: v.notes || undefined }); id = r.tournament.id; }, 'Tournament created: now invite grounds');
    if (ok) go('/network/tournaments/' + id);
  };
  return (
    <Modal title="New network tournament" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={a.busy} onClick={save}>Create</button></>}>
      <ErrorBox msg={a.err} />
      <div className="form-grid">
        <Field label="Name" full required><input className="inp" value={v.name} onChange={set('name')} /></Field>
        <Field label="Format"><select className="inp" value={v.format} onChange={set('format')}>{Object.entries(FORMAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Overs"><input className="inp" inputMode="numeric" value={v.overs} onChange={set('overs')} /></Field>
        <Field label="First day" required><DateInput className="inp" value={v.startDate} onChange={set('startDate')} /></Field>
        <Field label="Last day" required><DateInput className="inp" value={v.endDate} onChange={set('endDate')} /></Field>
        <Field label="Minutes each match holds the ground"><input className="inp" inputMode="numeric" value={v.matchMinutes} onChange={set('matchMinutes')} /></Field>
        <Field label="Notes" full><input className="inp" value={v.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

interface Claim { id: string; scorecardName: string | null; match: string | null; ground: string | null; date: number | null; raisedBy: string; playerSaidYes: boolean; staffSaidYes: boolean; status: string; reason: string | null; player?: string | null }
interface Suggestion { matchPlayerId: string; scorecardName: string; match: string; date: number; playerId: string; player: string; sameNameProfiles: number }

function Duplicates() {
  const toast = useToast();
  const [d, err, reload, status] = useApi<{ claims: Claim[]; suggestions: Suggestion[]; note: string }>(`${NET}/claims`);
  const a = useAct(reload, toast);
  const [why, setWhy] = useState<Record<string, string>>({});
  return (
    <Load data={d} error={err} status={status} retry={reload}>{(d) => <div className="stack">
      <div className="small muted">{d.note}</div>
      <ErrorBox msg={a.err} />
      <div className="card"><div className="card-head"><h3>Claims and links waiting</h3></div>
        <Table rows={d.claims} rowKey={(c) => c.id} empty="No claims."
          cols={[
            { head: 'Scorecard name', cell: (c) => <><b>{c.scorecardName}</b><div className="small muted">{c.match} · {c.ground ?? ''} · {c.date ? fmtDateTime(c.date) : ''}</div></> },
            { head: 'Profile', cell: (c) => c.player ?? '—' },
            { head: 'Raised by', cell: (c) => (c.raisedBy === 'player' ? 'The player' : 'Your team') },
            { head: 'Agreed', cell: (c) => <span className="row" style={{ gap: 6 }}>{c.playerSaidYes ? <Chip tone="good">Player</Chip> : <Chip>Player not yet</Chip>}{c.staffSaidYes ? <Chip tone="good">Ground</Chip> : <Chip>Ground not yet</Chip>}</span> },
            { head: 'Status', cell: (c) => <>{c.status}{c.reason && <div className="small muted">{c.reason}</div>}</> },
            { head: '', num: true, cell: (c) => c.status === 'open' && !c.staffSaidYes && <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <input className="inp" style={{ width: 150 }} placeholder="Reason to refuse" value={why[c.id] ?? ''} onChange={(e) => setWhy((s) => ({ ...s, [c.id]: e.target.value }))} />
              <button className="btn sm primary" disabled={a.busy} onClick={() => a.act(() => post(`${NET}/claims/${c.id}`, { yes: true }), 'Agreed')}>Agree</button>
              <button className="btn sm" disabled={a.busy} onClick={() => a.act(() => post(`${NET}/claims/${c.id}`, { yes: false, reason: why[c.id] || undefined }), 'Refused')}>Refuse</button>
            </div> },
          ]} /></div>
      <div className="card"><div className="card-head"><h3>Possible duplicates</h3><span className="small muted">Guests on your scorecards with the same name as a customer of yours</span></div>
        <Table rows={d.suggestions} rowKey={(s) => `${s.matchPlayerId}|${s.playerId}`} empty="No possible duplicates."
          cols={[
            { head: 'Scorecard name', cell: (s) => <><b>{s.scorecardName}</b><div className="small muted">{s.match} · {fmtDateTime(s.date)}</div></> },
            { head: 'Customer', cell: (s) => <>{s.player}{s.sameNameProfiles > 1 && <Chip tone="warn">{s.sameNameProfiles} with this name</Chip>}</> },
            { head: '', num: true, cell: (s) => <button className="btn sm" disabled={a.busy} onClick={() => a.act(() => post(`${NET}/claims`, { matchPlayerId: s.matchPlayerId, playerId: s.playerId }), 'Suggested: the player is asked to agree')}>Ask the player</button> },
          ]} /></div>
    </div>}</Load>
  );
}

interface Found { id: string; name: string; isChild: boolean; matches: number }
interface Brief { label: string; matches: number; runs: number; highest: string | null; average: number | null; strikeRate: number | null; wickets: number; best: string | null; economy: number | null; catches: number }
interface Profile {
  id: string; name: string; isChild: boolean; visibility: string; playingRole: string | null; battingStyle: string | null; bowlingStyle: string | null; eligibleRule: string;
  career: { matches: number; batting: { runs: number; average: number | null; strikeRate: number | null }; bowling: { wickets: number; economy: number | null } };
  byGround: Brief[]; byCompetition: Brief[];
  matches: { matchId: string; date: number; title: string; ground: string | null; business: string; competition: string; summary: string }[];
}

function Players() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [d, err, reload, status] = useApi<{ items: Found[] }>(query.length >= 2 ? `${NET}/players?q=${encodeURIComponent(query)}` : null);
  return (
    <div className="stack">
      <div className="card card-pad row" style={{ gap: 8 }}>
        <input className="inp" style={{ minWidth: 260 }} placeholder="Search players by name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(q.trim())} />
        <button className="btn primary" onClick={() => setQuery(q.trim())}>Search</button>
      </div>
      <div className="small muted">Only profiles their players shared with the network or made public are found. A child shows by first name and initial.</div>
      {query.length >= 2 && <Load data={d} error={err} status={status} retry={reload} isEmpty={(d) => !d.items.length} empty="No shared profiles with that name.">{(d) => (
        <div className="card"><Table rows={d.items} rowKey={(p) => p.id} onRow={(p) => setOpen(p.id)}
          cols={[{ head: 'Player', cell: (p) => <><b>{p.name}</b>{p.isChild && <Chip tone="info">Under 18</Chip>}</> }, { head: 'Eligible matches', num: true, cell: (p) => p.matches }]} /></div>)}</Load>}
      {open && <ProfileView id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ProfileView({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, err, reload, status] = useApi<Profile>(`${NET}/players/${id}`);
  return (
    <Modal title="Player profile" wide onClose={onClose} foot={<button className="btn" onClick={onClose}>Close</button>}>
      <Load data={d} error={err} status={status} retry={reload}>{(p) => <div className="stack">
        <div><b>{p.name}</b> {p.isChild && <Chip tone="info">Under 18</Chip>}</div>
        <div className="small muted">{[p.playingRole, p.battingStyle, p.bowlingStyle].filter(Boolean).join(' · ') || 'No playing details shared'}</div>
        <div className="small">{p.career.matches} matches · {p.career.batting.runs} runs{p.career.batting.average !== null ? ` at ${p.career.batting.average}` : ''} · {p.career.bowling.wickets} wickets</div>
        <div className="small muted">{p.eligibleRule}</div>
        <Table rows={p.byGround} rowKey={(g) => g.label} empty="No eligible matches."
          cols={[{ head: 'Ground', cell: (g) => g.label }, { head: 'Matches', num: true, cell: (g) => g.matches }, { head: 'Runs', num: true, cell: (g) => g.runs }, { head: 'Wickets', num: true, cell: (g) => g.wickets }]} />
        <Table rows={p.matches} rowKey={(m) => m.matchId} empty="No eligible matches."
          cols={[{ head: 'Match', cell: (m) => <><b>{m.title}</b><div className="small muted">{m.summary}</div></> }, { head: 'Where', cell: (m) => [m.ground, m.business].filter(Boolean).join(' · ') }, { head: 'Competition', cell: (m) => m.competition }, { head: 'When', cell: (m) => fmtDateTime(m.date) }]} />
      </div>}</Load>
    </Modal>
  );
}
