// One network tournament: grounds and invitations, teams, fixtures and slot confirmation, results and verification, standings,
// settlement records and the history. The server decides who may do what; the screen shows each business only its own part.
import { useState } from 'react';
import { Chip, Confirm, DateInput, ErrorBox, Field, Load, Modal, PageHead, Stat, Status, Table, Tabs, useToast } from '../../ui';
import { fmtDate, fmtDateTime, go, inr, post, del, useApi } from '../../lib';
import { splitIst, rupeesToPaise } from '../tournaments/shared';
import { F_STATUS, FORMAT, G_STATUS, KIND, NT, S_STATUS, T_STATUS, useAct, type Detail, type Fixture } from './shared';

type Tab = 'fixtures' | 'grounds' | 'teams' | 'table' | 'money' | 'history';

export function NetTournament({ id }: { id: string }) {
  const [d, err, reload, status] = useApi<Detail>(`${NT}/${id}`);
  const [tab, setTab] = useState<Tab>('fixtures');
  return (
    <div className="stack">
      <Load data={d} error={err} status={status} retry={reload}>{(d) => {
        const t = d.tournament, org = d.myRole === 'organiser';
        return <>
          <PageHead eyebrow={`Cricket network · ${FORMAT[t.format] ?? t.format} · ${t.overs} overs`} title={t.name}
            lede={<>{fmtDate(t.startDate)} to {fmtDate(t.endDate)} · organised by {t.organiser} <Status s={t.status} map={T_STATUS} /></>}>
            <button className="btn" onClick={() => go('/network/tournaments')}>All network tournaments</button>
          </PageHead>
          {t.notes && <div className="small muted">{t.notes}</div>}
          {t.closeReason && <div className="small muted">Closed: {t.closeReason}</div>}
          <div className="grid g4">
            <Stat label="Grounds accepted" value={t.grounds} foot={t.invitationsForMe ? `${t.invitationsForMe} invitation waiting for you` : undefined} />
            <Stat label="Fixtures confirmed" value={`${t.confirmed}/${t.fixtures}`} meter={t.fixtures ? (t.confirmed / t.fixtures) * 100 : 0} foot={t.slotsForMe ? `${t.slotsForMe} waiting for your ground` : undefined} />
            <Stat label="Results verified" value={`${t.verified}/${t.fixtures}`} foot={t.resultsToVerify ? `${t.resultsToVerify} to verify` : undefined} />
            <Stat label="Your role" value={org ? 'Organiser' : 'Host ground'} />
          </div>
          {org && <Lifecycle d={d} reload={reload} />}
          <Tabs<Tab> value={tab} onChange={setTab} label="Sections" items={[['fixtures', 'Fixtures'], ['grounds', 'Grounds'], ['teams', 'Teams'], ['table', 'Standings'], ['money', 'Settlements'], ['history', 'History']]} />
          {tab === 'fixtures' && <Fixtures d={d} reload={reload} />}
          {tab === 'grounds' && <Grounds d={d} reload={reload} />}
          {tab === 'teams' && <Teams d={d} reload={reload} />}
          {tab === 'table' && <Standings d={d} />}
          {tab === 'money' && <Settlements d={d} reload={reload} />}
          {tab === 'history' && <History d={d} />}
        </>;
      }}</Load>
    </div>
  );
}

function Lifecycle({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const busy = a.busy;
  const [reason, setReason] = useState('');
  const t = d.tournament, base = `${NT}/${t.id}`;
  if (t.status === 'completed' || t.status === 'cancelled') return null;
  return (
    <div className="card card-pad stack">
      <ErrorBox msg={a.err} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {t.status === 'draft' && <button className="btn primary" disabled={busy} onClick={() => a.act(() => post(`${base}/publish`), 'Published: the fixtures are now public')}>Publish fixtures</button>}
        {t.status === 'published' && <button className="btn primary" disabled={busy} onClick={() => a.act(() => post(`${base}/complete`), 'Tournament completed')}>Mark completed</button>}
        <input className="inp" style={{ minWidth: 220 }} placeholder="Reason, to cancel the tournament" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Confirm label="Cancel tournament" ask="Cancel it and free every held ground time?" onYes={() => a.act(() => post(`${base}/cancel`, { reason }), 'Tournament cancelled')} />
      </div>
      <div className="small muted">Publishing needs every match confirmed by its ground. Completing needs every result verified.</div>
    </div>
  );
}

// ---------------------------------------------------------------- fixtures

const when = (ms: number | null) => (ms ? fmtDateTime(ms) : 'No time yet');

function Fixtures({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const busy = a.busy;
  const [propose, setPropose] = useState(false);
  const [move, setMove] = useState<Fixture | null>(null);
  const [result, setResult] = useState<Fixture | null>(null);
  const [verify, setVerify] = useState<Fixture | null>(null);
  const [why, setWhy] = useState<Record<string, string>>({});
  const t = d.tournament, org = d.myRole === 'organiser', base = `${NT}/${t.id}/fixtures`;
  const live = t.status === 'draft' || t.status === 'published';
  return (
    <div className="stack">
      <ErrorBox msg={a.err} />
      {org && t.status === 'draft' && <div><button className="btn primary" onClick={() => setPropose(true)}>{d.fixtures.length ? 'Propose fixtures again' : 'Propose fixtures'}</button></div>}
      <div className="card">
        <Table rows={d.fixtures} rowKey={(f) => f.id} empty={org ? 'No fixtures yet. Accept grounds and add teams, then propose fixtures.' : 'No fixtures yet.'}
          cols={[
            { head: 'Match', cell: (f) => <><b>{f.teamA} v {f.teamB}</b><div className="small muted">Round {f.round}</div></> },
            { head: 'Ground and time', cell: (f) => <>{f.ground ?? '—'}{f.host && <span className="small muted"> · {f.host}</span>}<div className="small">{when(f.startsAt)}</div>
              {f.move && <div className="small"><Chip tone="warn">Move asked</Chip> {f.move.ground} · {when(f.move.startsAt)}{f.move.reason ? ` · ${f.move.reason}` : ''}</div>}</> },
            { head: 'Status', cell: (f) => <span className="row" style={{ gap: 6 }}><Status s={f.status} map={F_STATUS} />{f.timeHeld && <Chip tone="info">Time held</Chip>}</span> },
            { head: 'Result', cell: (f) => f.result ? <><b>{f.result.resultText || (f.result.winner ? `${f.result.winner} won` : f.result.outcome)}</b><div className="small muted">Verified by {f.result.verifiedBy ?? '—'}</div></>
              : f.waiting ? <><Chip tone="warn">Waiting for verification</Chip><div className="small muted">{f.waiting.resultText || f.waiting.winner || f.waiting.outcome} · sent by {f.waiting.submittedBy}</div></> : <span className="muted">—</span> },
            { head: 'Scorer', cell: (f) => f.scorer ?? <span className="muted">—</span> },
            { head: '', num: true, cell: (f) => live && <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {((f.status === 'proposed' && f.hostIsMe) || f.move?.hostIsMe) && <>
                {f.otherRequests > 0 && <Chip tone="warn">Another tournament asked for this time too: the first you confirm gets it</Chip>}
                <button className="btn sm primary" disabled={busy} onClick={() => a.act(() => post(`${base}/${f.id}/confirm`), 'Slot confirmed and held')}>Confirm slot</button>
                <input className="inp" style={{ width: 150 }} placeholder="Reason to turn down" value={why[f.id] ?? ''} onChange={(e) => setWhy((s) => ({ ...s, [f.id]: e.target.value }))} />
                <button className="btn sm" disabled={busy} onClick={() => a.act(() => post(`${base}/${f.id}/decline`, { reason: why[f.id] ?? '' }), 'Turned down: the organiser will pick another time')}>Turn down</button>
              </>}
              {org && f.status !== 'cancelled' && !f.result && <button className="btn sm" onClick={() => setMove(f)}>Move</button>}
              {f.hostIsMe && f.status === 'confirmed' && t.status === 'published' && <>
                <select className="inp" style={{ width: 150 }} value={f.scorerId ?? ''} onChange={(e) => a.act(() => post(`${base}/${f.id}/scorer`, { scorerId: e.target.value }), 'Scorer assigned')}>
                  <option value="">Assign scorer</option>{d.scorers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {f.matchId ? <button className="btn sm" onClick={() => go('/matches/' + f.matchId)}>Open scorer</button>
                  : <button className="btn sm" disabled={busy} onClick={() => a.act(() => post(`${base}/${f.id}/scoring`), 'Scoring opened in your Fixtures')}>Open scoring</button>}
                <button className="btn sm primary" onClick={() => setResult(f)}>{f.result || f.waiting ? 'Send a correction' : 'Send result'}</button>
              </>}
              {org && f.waiting && <button className="btn sm primary" onClick={() => setVerify(f)}>Verify</button>}
            </div> },
          ]} />
      </div>
      {propose && <ProposeForm d={d} onClose={() => setPropose(false)} onSaved={() => { setPropose(false); reload(); }} />}
      {move && <MoveForm d={d} f={move} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />}
      {result && <ResultForm d={d} f={result} onClose={() => setResult(null)} onSaved={() => { setResult(null); reload(); }} />}
      {verify && <VerifyForm d={d} f={verify} onClose={() => setVerify(null)} onSaved={() => { setVerify(null); reload(); }} />}
    </div>
  );
}

function ProposeForm({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = useAct(onSaved, toast);
  const busy = a.busy;
  const t = d.tournament;
  const [days, setDays] = useState(`${t.startDate}`);
  const [times, setTimes] = useState('09:00, 13:00');
  const split = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return (
    <Modal title="Propose fixtures" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => a.act(() => post(`${NT}/${t.id}/fixtures/propose`, { days: split(days), times: split(times), replace: d.fixtures.length > 0 }), 'Fixtures proposed: each ground now confirms its own times')}>{busy ? 'Checking the grounds…' : 'Propose'}</button></>}>
      <ErrorBox msg={a.err} />
      <div className="form-grid">
        <Field label="Days (yyyy-mm-dd, comma separated)" full hint={`Between ${fmtDate(t.startDate)} and ${fmtDate(t.endDate)}`}><input className="inp" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Match start times" full hint={`Each match takes ${t.matchMinutes} minutes`}><input className="inp" value={times} onChange={(e) => setTimes(e.target.value)} /></Field>
      </div>
      <div className="small muted">Each time is checked against the ground's hours, its bookings and blocks, and the other network matches. Matches run side by side on different grounds, and no team plays twice at once. Nothing is held until the ground confirms.</div>
    </Modal>
  );
}

function MoveForm({ d, f, onClose, onSaved }: { d: Detail; f: Fixture; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = useAct(onSaved, toast);
  const busy = a.busy;
  const at = splitIst(f.startsAt);
  const accepted = d.grounds.filter((g) => g.status === 'accepted');
  const [v, setV] = useState({ groundId: f.groundId ?? accepted[0]?.groundId ?? '', date: at.date || d.tournament.startDate, time: at.time || '09:00', reason: '' });
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title={`Move ${f.teamA} v ${f.teamB}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => a.act(() => post(`${NT}/${d.tournament.id}/fixtures/${f.id}/move`, v), 'Move asked: the ground confirms the new time')}>Ask for the move</button></>}>
      <ErrorBox msg={a.err} />
      <div className="form-grid">
        <Field label="Ground" full><select className="inp" value={v.groundId} onChange={set('groundId')}>{accepted.map((g) => <option key={g.groundId} value={g.groundId}>{g.ground} · {g.business}</option>)}</select></Field>
        <Field label="Date"><DateInput className="inp" value={v.date} onChange={set('date')} /></Field>
        <Field label="Time"><input className="inp" type="time" value={v.time} onChange={set('time')} /></Field>
        <Field label="Reason" full hint="Needed once the fixtures are published; everyone sees it in the history"><input className="inp" value={v.reason} onChange={set('reason')} /></Field>
      </div>
      {f.status === 'confirmed' && <div className="small muted">The match keeps its confirmed time until the ground confirms the new one.</div>}
    </Modal>
  );
}

function ResultForm({ d, f, onClose, onSaved }: { d: Detail; f: Fixture; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = useAct(onSaved, toast);
  const busy = a.busy;
  const [v, setV] = useState({ outcome: 'team_a', resultText: '', aRuns: '', aOvers: '', bRuns: '', bOvers: '', reason: '' });
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const correcting = !!(f.result || f.waiting);
  const num = (x: string) => (x === '' ? undefined : Number(x));
  const send = (fromMatch: boolean) => a.act(() => post(`${NT}/${d.tournament.id}/fixtures/${f.id}/result`, fromMatch ? { fromMatch: true, reason: v.reason || undefined }
    : { outcome: v.outcome, resultText: v.resultText || undefined, aRuns: num(v.aRuns), aOvers: v.aOvers || undefined, bRuns: num(v.bRuns), bOvers: v.bOvers || undefined, reason: v.reason || undefined }), 'Result sent to the organiser to verify');
  return (
    <Modal title={`Result: ${f.teamA} v ${f.teamB}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button>
      {f.matchId && <button className="btn" disabled={busy} onClick={() => send(true)}>Send from the scorecard</button>}
      <button className="btn primary" disabled={busy} onClick={() => send(false)}>Send result</button></>}>
      <ErrorBox msg={a.err} />
      <div className="form-grid">
        <Field label="Outcome" full><select className="inp" value={v.outcome} onChange={set('outcome')}>
          <option value="team_a">{f.teamA} won</option><option value="team_b">{f.teamB} won</option><option value="tie">Tied</option><option value="no_result">No result</option></select></Field>
        <Field label={`${f.teamA} runs`}><input className="inp" inputMode="numeric" value={v.aRuns} onChange={set('aRuns')} /></Field>
        <Field label={`${f.teamA} overs`}><input className="inp" placeholder="20 or 18.4" value={v.aOvers} onChange={set('aOvers')} /></Field>
        <Field label={`${f.teamB} runs`}><input className="inp" inputMode="numeric" value={v.bRuns} onChange={set('bRuns')} /></Field>
        <Field label={`${f.teamB} overs`}><input className="inp" placeholder="20 or 18.4" value={v.bOvers} onChange={set('bOvers')} /></Field>
        <Field label="Result in words" full><input className="inp" placeholder="River Kings won by 12 runs" value={v.resultText} onChange={set('resultText')} /></Field>
        {correcting && <Field label="Reason for the correction" full required><input className="inp" value={v.reason} onChange={set('reason')} /></Field>}
      </div>
      <div className="small muted">The organiser verifies the result. Standings and player stats change only once it is verified.</div>
    </Modal>
  );
}

function VerifyForm({ d, f, onClose, onSaved }: { d: Detail; f: Fixture; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = useAct(onSaved, toast);
  const busy = a.busy;
  const [reason, setReason] = useState('');
  const w = f.waiting!;
  const go2 = (approve: boolean) => a.act(() => post(`${NT}/${d.tournament.id}/fixtures/${f.id}/verify`, { approve, reason: reason || undefined }), approve ? 'Result verified: the standings are updated' : 'Result sent back to the ground');
  return (
    <Modal title={`Verify: ${f.teamA} v ${f.teamB}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={() => go2(false)}>Send back</button><button className="btn primary" disabled={busy} onClick={() => go2(true)}>Verify</button></>}>
      <ErrorBox msg={a.err} />
      <div className="stack">
        <div><b>{w.resultText || (w.winner ? `${w.winner} won` : w.outcome)}</b></div>
        <div className="small">{f.teamA}: {w.aRuns ?? '—'} ({w.aOvers ?? '—'} overs) · {f.teamB}: {w.bRuns ?? '—'} ({w.bOvers ?? '—'} overs)</div>
        <div className="small muted">Sent by {w.submittedBy} on {fmtDateTime(w.submittedAt)}{w.fromScorer ? ' from the scorecard' : ''}{w.reason ? ` · correction: ${w.reason}` : ''}</div>
        <Field label="Reason (needed to send it back)" full><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="small muted">Nobody verifies a result they sent themselves.</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- grounds and teams

function Grounds({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const busy = a.busy;
  const [pick, setPick] = useState({ groundId: '', charge: '' });
  const [note, setNote] = useState<Record<string, string>>({});
  const t = d.tournament, org = d.myRole === 'organiser', open = t.status === 'draft' || t.status === 'published';
  const invited = new Set(d.grounds.filter((g) => g.status !== 'declined' && g.status !== 'withdrawn').map((g) => g.groundId));
  const invite = () => {
    const paise = pick.charge.trim() ? rupeesToPaise(pick.charge) : 0;
    if (paise === null) { a.setErr('Charge per match: type an amount in rupees, like 2000'); return; }
    a.act(() => post(`${NT}/${t.id}/grounds`, { groundId: pick.groundId, chargePerMatchPaise: paise }), 'Ground invited');
  };
  return (
    <div className="stack">
      <ErrorBox msg={a.err} />
      {org && open && <div className="card card-pad row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="inp" style={{ minWidth: 240 }} value={pick.groundId} onChange={(e) => setPick((s) => ({ ...s, groundId: e.target.value }))}>
          <option value="">Pick a network ground</option>{d.networkGrounds.filter((g) => !invited.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name} · {g.business} · {g.city}</option>)}
        </select>
        <input className="inp" style={{ width: 170 }} placeholder="Charge per match (₹)" value={pick.charge} onChange={(e) => setPick((s) => ({ ...s, charge: e.target.value }))} />
        <button className="btn primary" disabled={busy} onClick={invite}>Invite ground</button>
      </div>}
      <div className="card">
        <Table rows={d.grounds} rowKey={(g) => g.id} empty="No grounds invited yet."
          cols={[
            { head: 'Ground', cell: (g) => <><b>{g.ground}</b><div className="small muted">{g.business}</div></> },
            { head: 'Status', cell: (g) => <Status s={g.status} map={G_STATUS} /> },
            { head: 'Charge per match', num: true, cell: (g) => (g.chargePerMatchPaise === null ? <span className="muted" title="Agreed between the organiser and that ground">—</span> : g.chargePerMatchPaise ? inr(g.chargePerMatchPaise) : 'No charge') },
            { head: 'Note', cell: (g) => g.note ?? <span className="muted">—</span> },
            { head: '', num: true, cell: (g) => g.isMine && g.status === 'invited' && <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <input className="inp" style={{ width: 160 }} placeholder="Note (optional)" value={note[g.id] ?? ''} onChange={(e) => setNote((s) => ({ ...s, [g.id]: e.target.value }))} />
              <button className="btn sm primary" disabled={busy} onClick={() => a.act(() => post(`${NT}/${t.id}/grounds/${g.id}`, { accept: true, note: note[g.id] || undefined }), 'Invitation accepted')}>Accept</button>
              <button className="btn sm" disabled={busy} onClick={() => a.act(() => post(`${NT}/${t.id}/grounds/${g.id}`, { accept: false, note: note[g.id] || undefined }), 'Invitation declined')}>Decline</button>
            </div> },
          ]} />
      </div>
      <div className="small muted">A ground in the tournament sees the fixtures, team names and the settlement lines it is a party to. It never sees another business's bookings, payments, staff or books.</div>
    </div>
  );
}

function Teams({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const busy = a.busy;
  const [name, setName] = useState('');
  const [add, setAdd] = useState<Record<string, { name: string; key: string }>>({});
  const t = d.tournament, org = d.myRole === 'organiser', draft = t.status === 'draft';
  const addPlayer = (teamId: string) => {
    const x = add[teamId] ?? { name: '', key: '' };
    const k = x.key.trim(), body: Record<string, string> = { name: x.name };
    if (/^KID-/i.test(k)) body.childCode = k.toUpperCase(); else if (/^usr_/.test(k)) body.playerId = k; else if (k) body.phone = k;
    a.act(() => post(`${NT}/${t.id}/teams/${teamId}/players`, body), body.phone || body.playerId ? 'Player added as a guest. If they have a Daji profile, they are asked to agree before it is linked.' : 'Player added').then((ok) => ok && setAdd((s) => ({ ...s, [teamId]: { name: '', key: '' } })));
  };
  return (
    <div className="stack">
      <ErrorBox msg={a.err} />
      {org && draft && <div className="card card-pad row" style={{ gap: 8 }}>
        <input className="inp" style={{ minWidth: 220 }} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy} onClick={() => a.act(() => post(`${NT}/${t.id}/teams`, { name }), 'Team added').then((ok) => ok && setName(''))}>Add team</button>
      </div>}
      {d.teams.length === 0 && <div className="card card-pad muted">No teams yet.</div>}
      {d.teams.map((team) => (
        <div className="card" key={team.id}>
          <div className="card-head"><h3>{team.name}</h3><span className="small muted">{team.playerCount} players{team.captain ? ` · captain ${team.captain}` : ''}</span>
            {org && draft && <Confirm label="Remove team" ask="Remove this team?" onYes={() => a.act(() => del(`${NT}/${t.id}/teams/${team.id}`), 'Team removed')} />}</div>
          {team.players && <div className="card-pad stack">
            {team.players.map((p) => <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{p.name} {p.hasProfile ? <Chip tone="good">Network profile</Chip> : <Chip>Guest</Chip>}{p.asked && <Chip tone="info">Asked to link a profile</Chip>}</span>
              {org && <button className="btn sm ghost" disabled={busy} onClick={() => a.act(() => del(`${NT}/${t.id}/teams/${team.id}/players/${p.id}`), 'Player removed')}>Remove</button>}
            </div>)}
            {org && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="inp" style={{ width: 170 }} placeholder="Name on the scorecard" value={add[team.id]?.name ?? ''} onChange={(e) => setAdd((s) => ({ ...s, [team.id]: { ...(s[team.id] ?? { key: '' }), name: e.target.value } }))} />
              <input className="inp" style={{ width: 220 }} placeholder="Mobile, child's code or profile id" value={add[team.id]?.key ?? ''} onChange={(e) => setAdd((s) => ({ ...s, [team.id]: { ...(s[team.id] ?? { name: '' }), key: e.target.value } }))} />
              <button className="btn sm primary" disabled={busy} onClick={() => addPlayer(team.id)}>Add player</button>
            </div>}
          </div>}
        </div>))}
      <div className="small muted">A player added by mobile number or network profile plays as a guest until they agree in their own profile; you see the same either way. A child is added only with the code their parent or guardian gives you, and only while the guardian has agreed to the match record; the child leaves the team at once if the guardian withdraws. Host grounds see team names and squad sizes, not player names.</div>
    </div>
  );
}

// ---------------------------------------------------------------- standings, settlements, history

function Standings({ d }: { d: Detail }) {
  return (
    <div className="card">
      <div className="card-head"><h3>Standings</h3><span className="small muted">{d.standingsNote}</span></div>
      <Table rows={d.standings} rowKey={(r) => r.teamId} empty="No teams yet."
        cols={[
          { head: 'Team', cell: (r) => <b>{r.team}</b> },
          { head: 'P', num: true, cell: (r) => r.played }, { head: 'W', num: true, cell: (r) => r.won }, { head: 'L', num: true, cell: (r) => r.lost },
          { head: 'T', num: true, cell: (r) => r.tied }, { head: 'NR', num: true, cell: (r) => r.noResult },
          { head: 'NRR', num: true, cell: (r) => (r.nrr === null ? '—' : r.nrr.toFixed(3)) }, { head: 'Points', num: true, cell: (r) => <b>{r.points}</b> },
        ]} />
    </div>
  );
}

function Settlements({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const a = useAct(reload, toast);
  const busy = a.busy;
  const [form, setForm] = useState(false);
  const [ref, setRef] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const s = d.settlementTotals, org = d.myRole === 'organiser', base = `${NT}/${d.tournament.id}/settlements`;
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat label="To receive" value={inr(s.toReceivePaise)} /><Stat label="Received" value={inr(s.receivedPaise)} />
        <Stat label="To pay" value={inr(s.toPayPaise)} /><Stat label="Paid" value={inr(s.paidPaise)} />
      </div>
      <div className="small muted">{d.booksNote}</div>
      <ErrorBox msg={a.err} />
      {org && <div><button className="btn primary" onClick={() => setForm(true)}>Add settlement line</button></div>}
      <div className="card">
        <Table rows={d.settlements} rowKey={(x) => x.id} empty="No settlement lines. Each line names who pays whom and why; money is never pooled."
          cols={[
            { head: 'Line', cell: (x) => <><b>{KIND[x.kind] ?? x.kind}</b>{x.fixture && <div className="small muted">{x.fixture}</div>}{x.note && <div className="small muted">{x.note}</div>}</> },
            { head: 'Who pays', cell: (x) => <>{x.payer}{x.iPay && <Chip tone="info">You</Chip>}</> },
            { head: 'Who receives', cell: (x) => <>{x.payee}{x.iReceive && <Chip tone="info">You</Chip>}</> },
            { head: 'Amount', num: true, cell: (x) => inr(x.amountPaise) },
            { head: 'Status', cell: (x) => <><Status s={x.status} map={S_STATUS} />{x.history.filter((h) => h.status !== 'agreed').map((h, i) => <div key={i} className="small muted">{h.status} by {h.by ?? '—'}, {fmtDateTime(h.at)}{h.ref ? ` · ref ${h.ref}` : ''}{h.reason ? ` · ${h.reason}` : ''}</div>)}</> },
            { head: '', num: true, cell: (x) => x.status === 'agreed' && <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {(x.iReceive || org) && <>
                <input className="inp" style={{ width: 150 }} placeholder="Payment reference" value={ref[x.id] ?? ''} onChange={(e) => setRef((s) => ({ ...s, [x.id]: e.target.value }))} />
                <button className="btn sm primary" disabled={busy} onClick={() => a.act(() => post(`${base}/${x.id}/paid`, { ref: ref[x.id] ?? '' }), 'Marked as paid')}>Mark received</button>
              </>}
              {org && <>
                <input className="inp" style={{ width: 140 }} placeholder="Reason to cancel" value={why[x.id] ?? ''} onChange={(e) => setWhy((s) => ({ ...s, [x.id]: e.target.value }))} />
                <button className="btn sm" disabled={busy} onClick={() => a.act(() => post(`${base}/${x.id}/cancel`, { reason: why[x.id] ?? '' }), 'Line cancelled (kept in the history)')}>Cancel line</button>
              </>}
            </div> },
          ]} />
      </div>
      {form && <SettlementForm d={d} onClose={() => setForm(false)} onSaved={() => { setForm(false); reload(); }} />}
    </div>
  );
}

function SettlementForm({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = useAct(onSaved, toast);
  const busy = a.busy;
  // the businesses in the tournament (the organiser and its grounds) and its teams, plus anyone else by name
  const parties = [
    ...d.businessOwners.map((b) => ({ key: `b:${b.ownerId}`, label: b.name, kind: 'business' as const, ref: b.ownerId })),
    ...d.teams.map((t) => ({ key: `t:${t.id}`, label: t.name, kind: 'team' as const, ref: t.id })),
  ];
  const [v, setV] = useState({ kind: 'entry_fee', payer: '', payee: '', payerOther: '', payeeOther: '', amount: '', note: '' });
  const [clientKey] = useState(() => `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const partyOf = (key: string, other: string) => {
    if (key === 'other') return { kind: 'other', label: other };
    const p = parties.find((x) => x.key === key);
    return p ? { kind: p.kind, ref: p.ref } : null;
  };
  const save = () => {
    const paise = rupeesToPaise(v.amount);
    if (paise === null || paise <= 0) { a.setErr('Amount: type an amount in rupees, like 1500'); return; }
    a.act(() => post(`${NT}/${d.tournament.id}/settlements`, { kind: v.kind, payer: partyOf(v.payer, v.payerOther), payee: partyOf(v.payee, v.payeeOther), amountPaise: paise, note: v.note || undefined, clientKey }), 'Settlement line added');
  };
  const pickParty = (k: 'payer' | 'payee') => <select className="inp" value={v[k]} onChange={set(k)}>
    <option value="">Pick</option>{parties.map((p) => <option key={p.key} value={p.key}>{p.label}{p.kind === 'team' ? ' (team)' : ''}</option>)}<option value="other">Someone else…</option></select>;
  return (
    <Modal title="Add a settlement line" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Add line</button></>}>
      <ErrorBox msg={a.err} />
      <div className="form-grid">
        <Field label="What for" full><select className="inp" value={v.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Who pays">{pickParty('payer')}</Field>
        {v.payer === 'other' ? <Field label="Payer's name"><input className="inp" value={v.payerOther} onChange={set('payerOther')} /></Field> : <span />}
        <Field label="Who receives">{pickParty('payee')}</Field>
        {v.payee === 'other' ? <Field label="Receiver's name"><input className="inp" value={v.payeeOther} onChange={set('payeeOther')} /></Field> : <span />}
        <Field label="Amount (₹)"><input className="inp" inputMode="decimal" value={v.amount} onChange={set('amount')} /></Field>
        <Field label="Note" full><input className="inp" value={v.note} onChange={set('note')} /></Field>
      </div>
      <div className="small muted">This records who owes whom. It is not posted to any business's books, and no money moves through the network.</div>
    </Modal>
  );
}
function History({ d }: { d: Detail }) {
  const KINDS: Record<string, string> = { proposed: 'Proposed', confirmed: 'Ground confirmed', declined: 'Ground turned it down', move_proposed: 'Move asked', move_declined: 'Move turned down', moved: 'Moved', cancelled: 'Cancelled',
    scorer: 'Scorer assigned', scoring_opened: 'Scoring opened', result_sent: 'Result sent', correction_sent: 'Correction sent', result_verified: 'Result verified', result_rejected: 'Result sent back' };
  const names = new Map(d.fixtures.map((f) => [f.id, `${f.teamA} v ${f.teamB}`]));
  return (
    <div className="card">
      <div className="card-head"><h3>Every change</h3><span className="small muted">Kept for good; nothing here can be edited or deleted</span></div>
      <Table rows={d.history} empty="Nothing has happened yet."
        cols={[
          { head: 'When', cell: (h) => fmtDateTime(h.at) },
          { head: 'Match', cell: (h) => names.get(h.fixtureId) ?? <span className="muted">An earlier fixture</span> },
          { head: 'What', cell: (h) => KINDS[h.kind] ?? h.kind },
          { head: 'Who', cell: (h) => <>{h.by ?? '—'}{h.business && <div className="small muted">{h.business}</div>}</> },
          { head: 'Reason', cell: (h) => h.reason ?? <span className="muted">—</span> },
        ]} />
    </div>
  );
}
