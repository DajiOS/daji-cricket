// A player's career record (batting, bowling, fielding) and their finished matches, as the server works it out from the balls.
import { Table } from '../../ui';
import { fmtDateTime } from '../../lib';

export interface Career {
  matches: number;
  batting: { innings: number; notOuts: number; runs: number; balls: number; fours: number; sixes: number; highest: string | null; average: number | null; strikeRate: number | null; fifties: number; hundreds: number; ducks: number };
  bowling: { innings: number; balls: number; overs: string; maidens: number; runs: number; wickets: number; best: string | null; average: number | null; economy: number | null; strikeRate: number | null; threeWickets: number; fiveWickets: number };
  fielding: { catches: number; runOuts: number; stumpings: number };
}
export interface CareerData { career: Career; matches: { matchId: string; title: string; date: number; groundName: string | null; team: string; opponent: string; result: string | null; summary: string }[]; note: string }

const dash = (v: number | string | null) => (v === null ? '–' : v);

export default function CareerView({ d }: { d: CareerData }) {
  const c = d.career, b = c.batting, w = c.bowling, f = c.fielding;
  if (!c.matches) return <div className="card card-pad small muted" data-state="empty">No scored matches on this record yet. {d.note}</div>;
  const box = (title: string, rows: [string, number | string | null][]) => (
    <div className="card card-pad stack" style={{ gap: 8 }}>
      <div className="eyebrow">{title}</div>
      <div className="facts">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{dash(v)}</b></div>)}</div>
    </div>
  );
  return (
    <div className="stack">
      <div className="grid g3">
        {box('Batting', [['Matches', c.matches], ['Innings', b.innings], ['Not outs', b.notOuts], ['Runs', b.runs], ['Highest', b.highest], ['Average', b.average], ['Strike rate', b.strikeRate], ['4s / 6s', `${b.fours} / ${b.sixes}`], ['50s / 100s', `${b.fifties} / ${b.hundreds}`], ['Ducks', b.ducks]])}
        {box('Bowling', [['Innings', w.innings], ['Overs', w.overs], ['Maidens', w.maidens], ['Runs', w.runs], ['Wickets', w.wickets], ['Best', w.best], ['Average', w.average], ['Economy', w.economy], ['Strike rate', w.strikeRate], ['3w / 5w', `${w.threeWickets} / ${w.fiveWickets}`]])}
        {box('Fielding', [['Catches', f.catches], ['Run outs', f.runOuts], ['Stumpings', f.stumpings]])}
      </div>
      <div className="card"><div className="card-head"><h3>Matches</h3></div>
        <Table rows={d.matches} rowKey={(m) => m.matchId} onRow={(m) => { location.hash = `/matches/${m.matchId}`; }} cols={[
          { head: 'When', cell: (m) => <span className="nw">{fmtDateTime(m.date)}</span> },
          { head: 'Match', cell: (m) => <><span className="strong">{m.team} v {m.opponent}</span><div className="muted small">{m.title}{m.groundName ? ` · ${m.groundName}` : ''}</div></> },
          { head: 'Performance', cell: (m) => m.summary },
          { head: 'Result', cell: (m) => <span className="small">{m.result ?? ''}</span> },
        ]} />
      </div>
      <p className="hint small">{d.note}</p>
    </div>
  );
}
