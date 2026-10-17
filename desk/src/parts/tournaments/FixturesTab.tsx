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

function GenerateForm({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const has = d.fixtures.length > 0;
  const { v, bind } = useForm({ startDate: d.tournament.startDate, time: '09:00', gap: '7', groundId: '', double: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = d.teams.length, games = (n * (n - 1) / 2) * (v.double ? 2 : 1);
  async function go_() {
    setBusy(true); setErr(null);
    try {
      const r = await post(`${API}/${d.tournament.id}/fixtures/generate`, { startDate: v.startDate || undefined, time: v.time, daysBetweenRounds: Number(v.gap), groundId: v.groundId || undefined, doubleRound: v.double, replace: has });
      toast(`${r.created} fixtures over ${r.rounds} rounds`); onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title="Generate round robin" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || n < 2} onClick={go_}>{busy ? 'Generating…' : `Create ${games} fixtures`}</button></>}>
      <ErrorBox msg={err} />
      {n < 2 && <div className="err">Add at least two teams first.</div>}
      {has && <div className="hint" style={{ marginBottom: 12 }}>This replaces the {d.fixtures.length} fixtures already here. It is only allowed while none has a result.</div>}
      <div className="form-grid">
        <Field label="First round on"><DateInput className="inp" {...bind('startDate')} /></Field>
        <Field label="Start time"><input className="inp" type="time" {...bind('time')} /></Field>
        <Field label="Days between rounds"><input className="inp" type="number" min={0} max={60} {...bind('gap')} /></Field>
        <Field label="Ground"><select className="inp" {...bind('groundId')}><option value="">Not set</option>{d.grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Home and away" full><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.double} onChange={bind('double').onChange} /><span className="small">Everyone plays everyone twice</span></label></Field>
      </div>
    </Modal>
  );
}

export function FixturesTab({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const [modal, setModal] = useState<{ k: 'add' } | { k: 'edit'; fx: Fixture } | { k: 'result'; fx: Fixture } | { k: 'gen' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tid = d.tournament.id;
  async function act(fn: () => Promise<unknown>, msg: string) { setErr(null); try { await fn(); toast(msg); reload(); } catch (e: any) { setErr(e.message); } }
  const done = () => { setModal(null); reload(); };
  return (
    <div className="card">
      <div className="card-head"><h3>Fixtures ({d.fixtures.length})</h3>
        <span className="row">
          <button className="btn sm" disabled={d.teams.length < 2} onClick={() => setModal({ k: 'gen' })}>Generate round robin</button>
          <button className="btn primary sm" disabled={d.teams.length < 2} onClick={() => setModal({ k: 'add' })}>Add fixture</button>
        </span></div>
      <div className="card-pad" style={{ paddingBottom: err ? undefined : 0 }}><ErrorBox msg={err} /></div>
      <Table rows={d.fixtures} empty={d.teams.length < 2 ? 'Add at least two teams, then create fixtures.' : 'No fixtures yet. Generate a round robin or add them one by one.'}
        cols={[
          { head: 'Round', cell: (f) => f.round },
          { head: 'Match', cell: (f) => <b>{f.teamA} <span className="muted">v</span> {f.teamB}</b> },
          { head: 'When', cell: (f) => <>{fmtDateTime(f.startsAt)}{f.groundName && <div className="small muted">{f.groundName}</div>}</> },
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
      {modal?.k === 'gen' && <GenerateForm d={d} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}
