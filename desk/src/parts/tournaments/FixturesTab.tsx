import { useState } from 'react';
import { Chip, Confirm, ErrorBox, Field, Modal, Table, useForm, useToast, DateInput } from '../../ui';
import { del, fmtDateTime, patch, post, go } from '../../lib';
import { API, splitIst, type Detail, type Fixture } from './shared';

function FixtureForm({ d, fx, onClose, onSaved }: { d: Detail; fx?: Fixture; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const at = splitIst(fx?.startsAt ?? null);
  const { v, bind } = useForm({ round: String(fx?.round ?? 1), teamAId: fx?.teamAId ?? d.teams[0]?.id ?? '', teamBId: fx?.teamBId ?? d.teams[1]?.id ?? '', date: at.date, time: at.time || '09:00', groundId: fx?.groundId ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body: any = { round: Number(v.round), teamAId: v.teamAId, teamBId: v.teamBId, groundId: v.groundId };
      if (v.date) { body.date = v.date; body.time = v.time; } else if (fx) body.date = null;
      if (fx) await patch(`${API}/${d.tournament.id}/fixtures/${fx.id}`, body); else await post(`${API}/${d.tournament.id}/fixtures`, body);
      toast('Fixture saved'); onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const locked = !!fx?.played;
  return (
    <Modal title={fx ? 'Edit fixture' : 'Add fixture'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <ErrorBox msg={err} />
      <div className="form-grid">
        <Field label="Team A"><select className="inp" disabled={locked} {...bind('teamAId')}>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Team B"><select className="inp" disabled={locked} {...bind('teamBId')}>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Round"><input className="inp" type="number" min={1} max={99} {...bind('round')} /></Field>
        <Field label="Ground"><select className="inp" {...bind('groundId')}><option value="">Not set</option>{d.grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Date"><DateInput className="inp" {...bind('date')} /></Field>
        <Field label="Time"><input className="inp" type="time" {...bind('time')} /></Field>
      </div>
    </Modal>
  );
}

function ResultForm({ d, fx, onClose, onSaved }: { d: Detail; fx: Fixture; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { v, bind, setV } = useForm({ outcome: fx.outcome ?? 'team_a', resultText: fx.resultText ?? '', aRuns: fx.aRuns ?? '', aOvers: fx.aOvers ?? '', bRuns: fx.bRuns ?? '', bOvers: fx.bOvers ?? '' } as Record<string, any>);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body: any = { outcome: v.outcome, resultText: v.resultText };
      if (v.outcome !== 'no_result') {
        body.aRuns = v.aRuns === '' ? null : Number(v.aRuns); body.bRuns = v.bRuns === '' ? null : Number(v.bRuns);
        body.aOvers = v.aOvers === '' ? null : v.aOvers; body.bOvers = v.bOvers === '' ? null : v.bOvers;
      }
      await patch(`${API}/${d.tournament.id}/fixtures/${fx.id}`, body);
      toast('Result saved'); onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`Result: ${fx.teamA} v ${fx.teamB}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save result'}</button></>}>
      <ErrorBox msg={err} />
      <div className="form-grid">
        <Field label="Outcome" full>
          <select className="inp" value={v.outcome} onChange={(e) => setV((s) => ({ ...s, outcome: e.target.value, resultText: '' }))}>
            <option value="team_a">{fx.teamA} won</option><option value="team_b">{fx.teamB} won</option><option value="tie">Tied</option><option value="no_result">No result (abandoned)</option>
          </select>
        </Field>
        <Field label="Result text" hint="Optional. Left blank, it is written for you" full><input className="inp" {...bind('resultText')} placeholder="e.g. Lions won by 20 runs" /></Field>
        {v.outcome !== 'no_result' && <>
          <Field label={`${fx.teamA} runs`}><input className="inp" type="number" min={0} {...bind('aRuns')} /></Field>
          <Field label={`${fx.teamA} overs faced`} hint="Like 9.4. Full overs if all out"><input className="inp" inputMode="decimal" {...bind('aOvers')} /></Field>
          <Field label={`${fx.teamB} runs`}><input className="inp" type="number" min={0} {...bind('bRuns')} /></Field>
          <Field label={`${fx.teamB} overs faced`}><input className="inp" inputMode="decimal" {...bind('bOvers')} /></Field>
          <div className="hint full">Runs and overs are optional. They feed the net run rate in the points table.</div>
        </>}
      </div>
    </Modal>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();
const nextDay = (iso: string) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

/** Builds fixtures into the days and match times given, and holds each match's time on the ground so customers cannot book it. */
function BuildForm({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const has = d.fixtures.length > 0;
  const { v, bind } = useForm({ kind: has && d.tournament.format === 'knockout' ? 'knockout' : 'round_robin', day: '', weekday: '0', times: '09:00, 13:00, 17:00', minutes: '180', groundId: d.grounds[0]?.id ?? '', hold: true, dayNight: false, nightFrom: '18:00' });
  const [days, setDays] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = d.teams.length, knockout = v.kind === 'knockout';
  const games = knockout ? null : (n * (n - 1) / 2) * (v.kind === 'double_round_robin' ? 2 : 1);
  const times = v.times.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const add = (list: string[]) => setDays((cur) => [...new Set([...cur, ...list])].sort());
  const everyWeekday = () => {
    const out: string[] = []; const w = Number(v.weekday);
    for (let x = d.tournament.startDate; x <= d.tournament.endDate; x = nextDay(x)) if (weekdayOf(x) === w) out.push(x);
    if (!out.length) return setErr(`There is no ${WEEKDAYS[w]} between ${d.tournament.startDate} and ${d.tournament.endDate}.`);
    setErr(null); add(out);
  };
  async function build() {
    if (n < 2) return setErr('Add at least two teams first. Fixtures need two teams to play.');
    if (!days.length) return setErr('Add at least one day.');
    if (!times.length) return setErr('Give at least one match time, like 09:00.');
    if (!v.groundId) return setErr('Pick the ground.');
    setBusy(true); setErr(null);
    try {
      const r = await post(`${API}/${d.tournament.id}/fixtures/schedule`, { kind: v.kind, days, times, matchMinutes: Number(v.minutes), groundId: v.groundId, holdGround: v.hold, dayNight: v.dayNight, nightFrom: v.dayNight ? v.nightFrom : undefined, replace: has && !knockout });
      toast(`${r.created} fixtures made${r.held ? `; their times are blocked on the ground` : ''}`); onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const slots = days.length * times.length;
  return (
    <Modal title="Build fixtures" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={build}>{busy ? 'Building…' : games ? `Make ${games} fixtures` : 'Make the next round'}</button></>}>
      <ErrorBox msg={err} />
      {has && !knockout && <div className="hint" style={{ marginBottom: 12 }}>This replaces the {d.fixtures.length} fixtures already here and frees their times on the ground. It is only allowed while none has a result.</div>}
      {knockout && <div className="hint" style={{ marginBottom: 12 }}>{has ? 'Makes the next knockout round from the winners. Every match of the last round needs a winner first.' : 'Makes the first knockout round. If the number of teams is not 2, 4, 8 or 16, the teams entered first get a bye.'}</div>}
      <div className="form-grid">
        <Field label="Format"><select className="inp" {...bind('kind')}><option value="round_robin">Round robin (everyone plays everyone)</option><option value="double_round_robin">Round robin, home and away</option><option value="knockout">Knockout</option></select></Field>
        <Field label="Ground"><select className="inp" {...bind('groundId')}>{d.grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Add a day"><span className="row" style={{ gap: 6 }}><DateInput className="inp" {...bind('day')} /><button className="btn sm" type="button" onClick={() => v.day && add([v.day])}>Add</button></span></Field>
        <Field label="Or add every" hint={`Between ${d.tournament.startDate} and ${d.tournament.endDate}`}><span className="row" style={{ gap: 6 }}><select className="inp" {...bind('weekday')}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select><button className="btn sm" type="button" onClick={everyWeekday}>Add</button></span></Field>
        <Field label={`Days (${days.length})`} full>{days.length ? <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{days.map((x) => <Chip key={x} tone="info">{x} <button type="button" className="btn ghost sm" aria-label={`Remove ${x}`} onClick={() => setDays(days.filter((y) => y !== x))}>×</button></Chip>)}</div> : <span className="small muted">No days yet.</span>}</Field>
        <Field label="Match start times" hint="Each day, e.g. 09:00, 13:00, 17:00"><input className="inp" {...bind('times')} /></Field>
        <Field label="Match length (minutes)"><input className="inp" type="number" min={30} max={720} step={15} {...bind('minutes')} /></Field>
        <Field label="Day and night" full><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.dayNight} onChange={bind('dayNight').onChange} /><span className="small">Every team plays at least one day match and one night match</span></label></Field>
        {v.dayNight && <Field label="Night starts at"><input className="inp" type="time" {...bind('nightFrom')} /></Field>}
        <Field label="Block the ground" full><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.hold} onChange={bind('hold').onChange} /><span className="small">Block each match's time so customers cannot book it</span></label></Field>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{slots} match times{games ? ` for ${games} matches` : ''}. Matches fill the times in order, and a team plays at most once a day where the times allow it. If a time is already booked, nothing is made and you are told which one.</p>
    </Modal>
  );
}

export function FixturesTab({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const [modal, setModal] = useState<{ k: 'add' } | { k: 'edit'; fx: Fixture } | { k: 'result'; fx: Fixture } | { k: 'build' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tid = d.tournament.id;
  async function act(fn: () => Promise<unknown>, msg: string) { setErr(null); try { await fn(); toast(msg); reload(); } catch (e: any) { setErr(e.message); } }
  const done = () => { setModal(null); reload(); };
  return (
    <div className="card">
      <div className="card-head"><h3>Fixtures ({d.fixtures.length})</h3>
        <span className="row">
          <button className="btn sm" onClick={() => (d.teams.length < 2 ? toast('Add at least two teams first (Teams tab).') : setModal({ k: 'build' }))}>Build fixtures</button>
          <button className="btn primary sm" onClick={() => (d.teams.length < 2 ? toast('Add at least two teams first (Teams tab).') : setModal({ k: 'add' }))}>Add fixture</button>
        </span></div>
      <div className="card-pad" style={{ paddingBottom: err ? undefined : 0 }}><ErrorBox msg={err} /></div>
      <Table rows={d.fixtures} empty={d.teams.length < 2 ? 'Add at least two teams, then create fixtures.' : 'No fixtures yet. Build them into your days and times, or add them one by one.'}
        cols={[
          { head: 'Round', cell: (f) => f.round },
          { head: 'Match', cell: (f) => <b>{f.teamA} <span className="muted">v</span> {f.teamB}</b> },
          { head: 'When', cell: (f) => <>{fmtDateTime(f.startsAt)}{f.groundName && <div className="small muted">{f.groundName}{f.blockedUntil ? ' · ground blocked' : ''}</div>}</> },
          { head: 'Result', cell: (f) => f.played
            ? <><Chip tone={f.outcome === 'no_result' ? 'mute' : f.outcome === 'tie' ? 'info' : 'good'}>{f.resultText || 'Played'}</Chip>{f.aRuns !== null && f.bRuns !== null && <div className="small muted">{f.teamA} {f.aRuns} ({f.aOvers}) · {f.teamB} {f.bRuns} ({f.bOvers})</div>}</>
            : f.matchStatus === 'live' ? <Chip tone="gold">Live</Chip> : f.matchStatus === 'completed' ? <Chip tone="warn">Scored, not copied</Chip> : <span className="muted">Not played</span> },
          { head: '', num: true, cell: (f) => (
            <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              {f.matchStatus === 'completed' && !f.played && <button className="btn sm primary" onClick={() => act(() => post(`${API}/${tid}/fixtures/${f.id}/sync`), 'Result copied from the scorer')}>Use scorer result</button>}
              {!f.played && !f.matchId && <button className="btn sm" onClick={() => act(() => post(`${API}/${tid}/fixtures/${f.id}/match`), 'Match created in the scorer')}>Score live</button>}
              {f.matchId && !f.played && f.matchStatus !== 'completed' && <button className="btn sm" onClick={() => go('/matches')}>Open scorer</button>}
              <button className="btn sm" onClick={() => setModal({ k: 'result', fx: f })}>{f.played ? 'Edit result' : 'Enter result'}</button>
              <button className="btn sm ghost" onClick={() => setModal({ k: 'edit', fx: f })}>Edit</button>
              {f.played
                ? <Confirm label="Clear result" ask="Clear result?" onYes={() => act(() => patch(`${API}/${tid}/fixtures/${f.id}`, { clearResult: true }), 'Result cleared')} />
                : <Confirm label="Remove" ask="Remove fixture?" onYes={() => act(() => del(`${API}/${tid}/fixtures/${f.id}`), 'Fixture removed')} />}
            </span>) },
        ]} />
      {modal?.k === 'add' && <FixtureForm d={d} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.k === 'edit' && <FixtureForm d={d} fx={modal.fx} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.k === 'result' && <ResultForm d={d} fx={modal.fx} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.k === 'build' && <BuildForm d={d} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}
