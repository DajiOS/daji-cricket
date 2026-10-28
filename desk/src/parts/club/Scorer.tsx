// Match-day scoring: ball by ball from a phone.
import { useEffect, useState } from 'react';
import { Chip, ErrorBox, Field, Loading, useToast } from '../../ui';
import { api, post } from '../../lib';
import { Select, errMsg } from './common';
import Scoreboard, { type Score } from './Scoreboard';
import Squads, { type SquadData } from './Squads';

const EXTRAS: [string, string][] = [['', 'No extra'], ['wide', 'Wide'], ['noball', 'No ball'], ['bye', 'Bye'], ['legbye', 'Leg bye']];
const OUTS = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired'];
const FIELDED = ['caught', 'run out', 'stumped'];
let lastBatter = '', lastBowler = '';

export default function Scorer({ id, back }: { id: string; back: () => void }) {
  const toast = useToast();
  const [sc, setSc] = useState<Score | null>(null); const [error, setError] = useState<string | null>(null); const [innings, setInnings] = useState(1);
  const [batter, setBatter] = useState(lastBatter); const [bowler, setBowler] = useState(lastBowler);
  const [extra, setExtra] = useState(''); const [wk, setWk] = useState(false); const [kind, setKind] = useState('bowled'); const [out, setOut] = useState(''); const [fielder, setFielder] = useState(''); const [err, setErr] = useState<string | null>(null);
  const [squads, setSquads] = useState<SquadData | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const learn = (s: Score) => setNames((old) => [...new Set([...old, ...s.innings.flatMap((i) => [...i.batting.map((b) => b.name), ...i.bowling.map((b) => b.name)])])]);
  useEffect(() => {
    api<Score>('/api/staff/matches/' + id).then((s) => { setSc(s); setInnings(s.innings[0]?.closed ? 2 : 1); learn(s); }).catch((e) => setError(errMsg(e)));
    api<SquadData>(`/api/staff/matches/${id}/players`).then(setSquads).catch(() => setSquads(null));
  }, [id]);
  if (error) return <div className="stack"><button className="btn ghost sm" onClick={back}>All matches</button><ErrorBox msg={error} /></div>;
  if (!sc) return <Loading />;
  const m = sc.match;
  // with squads the scorer picks from them: the batting side's names for the batter, the other side's for the bowler and fielder
  const batSide = (innings === 1) === ((m.battingFirst ?? 'a') === 'a') ? 'a' : 'b';
  const squadOf = (side: 'a' | 'b') => squads?.sides.find((x) => x.side === side)?.players.map((p) => p.name) ?? [];
  const batNames = squadOf(batSide).length ? squadOf(batSide) : names, fieldNames = squadOf(batSide === 'a' ? 'b' : 'a').length ? squadOf(batSide === 'a' ? 'b' : 'a') : names;
  const send = async (runs: number) => {
    setErr(null);
    if (!batter.trim() || !bowler.trim()) { setErr('Say who is batting and who is bowling.'); return; }
    const body: Record<string, unknown> = { innings, batter: batter.trim(), bowler: bowler.trim(), runsBat: runs };
    if (extra) { body.extraType = extra; if (extra === 'bye' || extra === 'legbye') { body.runsBat = 0; body.extraRuns = runs || 1; } else if (extra === 'wide') { body.runsBat = 0; body.extraRuns = Math.max(1, runs); } }
    if (wk) { body.wicket = true; body.wicketKind = kind; if (out.trim()) body.outPlayer = out.trim(); if (FIELDED.includes(kind) && fielder.trim()) body.fielder = fielder.trim(); }
    try { const s = await post<Score>(`/api/staff/matches/${id}/balls`, body); lastBatter = batter.trim(); lastBowler = bowler.trim(); setSc(s); learn(s); setNames((n) => [...new Set([...n, lastBatter, lastBowler])]); setExtra(''); setWk(false); setOut(''); setFielder(''); }
    catch (e) { setErr(errMsg(e)); }
  };
  const undo = async () => {
    try { setSc(await post<Score>(`/api/staff/matches/${id}/undo`, { innings: sc.innings[1] && sc.innings[1].recent.length ? 2 : 1 })); } catch (e) { toast(errMsg(e)); }
  };
  const finished = m.status === 'completed';
  return (
    <div className="stack">
      <div className="row"><button className="btn ghost sm" onClick={back}>All matches</button><b className="scorer-title">{m.teamA} v {m.teamB}</b><Chip tone={finished ? 'good' : 'bad'}>{m.result || (finished ? 'Final' : 'Live')}</Chip></div>
      <Scoreboard sc={sc} />
      {finished ? (
        <div className="card card-pad stack"><p className="hint" style={{ margin: 0 }}>The match is finished. Undo the last ball to reopen it.</p><div><button className="btn sm" onClick={undo}>Undo last ball</button></div></div>
      ) : (
        <div className="card">
          <div className="card-head"><h3>Score a ball</h3></div>
          <div className="card-pad stack">
            <div className="form-grid">
              <Field label="Innings"><Select value={String(innings)} onChange={(v) => setInnings(Number(v))} options={sc.innings[0]?.closed ? [['1', 'First innings'], ['2', 'Second innings']] : [['1', 'First innings']]} /></Field>
              <Field label="Batter"><input className="inp" list="club-bat" placeholder="On strike" value={batter} onChange={(e) => setBatter(e.target.value)} /></Field>
              <Field label="Bowler"><input className="inp" list="club-field" placeholder="Bowler" value={bowler} onChange={(e) => setBowler(e.target.value)} /></Field>
            </div>
            <datalist id="club-bat">{batNames.map((n) => <option key={n} value={n} />)}</datalist>
            <datalist id="club-field">{fieldNames.map((n) => <option key={n} value={n} />)}</datalist>
            <div className="runs">{[0, 1, 2, 3, 4, 6].map((r) => <button key={r} className={'btn' + (r >= 4 ? ' primary' : '')} onClick={() => send(r)}>{r}</button>)}</div>
            <div className="form-grid">
              <Field label="Extra" hint="For a wide or no ball, the run buttons add runs on top of the automatic one."><Select value={extra} onChange={setExtra} options={EXTRAS} /></Field>
              <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={wk} onChange={(e) => setWk(e.target.checked)} /> Wicket</label>
              {wk && <><Field label="How"><Select value={kind} onChange={setKind} options={OUTS.map((x) => [x, x] as [string, string])} /></Field>
                <Field label="Who is out"><input className="inp" list="club-bat" placeholder="If not the striker" value={out} onChange={(e) => setOut(e.target.value)} /></Field>
                {FIELDED.includes(kind) && <Field label={kind === 'caught' ? 'Caught by' : kind === 'stumped' ? 'Stumped by' : 'Run out by'} hint={kind === 'caught' ? 'The bowler for caught and bowled.' : 'Goes on their fielding record.'}><input className="inp" list="club-field" placeholder="Fielder (optional)" value={fielder} onChange={(e) => setFielder(e.target.value)} /></Field>}</>}
            </div>
            {err && <div className="err" role="alert">{err}</div>}
            <div><button className="btn ghost sm" onClick={undo}>Undo last ball</button></div>
          </div>
        </div>
      )}
      {squads && <Squads id={id} data={squads} onChange={setSquads} />}
    </div>
  );
}
