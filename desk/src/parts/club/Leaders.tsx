// Player records: the leaders by runs, wickets and fielding dismissals, from finished matches scored at this business.
// Only players in a squad linked to their Daji profile have a record; names are the ones on the scorecards.
import { Stat, Table } from '../../ui';
import { useApi } from '../../lib';
import { Async } from './common';

interface Leader { userId: string; name: string; matches: number; runs: number; highest: string | null; average: number | null; strikeRate: number | null; wickets: number; best: string | null; economy: number | null; catches: number; dismissals: number }
interface Data { players: number; matches: number; runs: Leader[]; wickets: Leader[]; fielding: Leader[] }
const d0 = (v: number | string | null) => (v === null ? '–' : v);

export default function Leaders() {
  const [data, error] = useApi<Data>('/api/staff/cricket/leaders');
  return (
    <Async data={data} error={error}>{(d) => (
      <div className="stack">
        <div className="grid g3"><Stat label="Players with a record" value={d.players} /><Stat label="Finished matches" value={d.matches} /><Stat label="Top scorer" value={d.runs[0] ? `${d.runs[0].name}, ${d.runs[0].runs}` : '–'} /></div>
        {!d.players && <div className="card card-pad small muted" data-state="empty">No player records yet. Add squads to a match (from a booking's team list or by mobile number) and score it to the end: the records build themselves.</div>}
        {d.players > 0 && <div className="grid g3">
          <div className="card"><div className="card-head"><h3>Most runs</h3></div><Table rows={d.runs} rowKey={(x) => x.userId} empty="Nobody yet." cols={[
            { head: 'Player', cell: (x) => <span className="strong">{x.name}</span> }, { head: 'M', num: true, cell: (x) => x.matches }, { head: 'Runs', num: true, cell: (x) => x.runs },
            { head: 'HS', num: true, cell: (x) => d0(x.highest) }, { head: 'Avg', num: true, cell: (x) => d0(x.average) }, { head: 'SR', num: true, cell: (x) => d0(x.strikeRate) },
          ]} /></div>
          <div className="card"><div className="card-head"><h3>Most wickets</h3></div><Table rows={d.wickets} rowKey={(x) => x.userId} empty="Nobody yet." cols={[
            { head: 'Player', cell: (x) => <span className="strong">{x.name}</span> }, { head: 'M', num: true, cell: (x) => x.matches }, { head: 'Wkts', num: true, cell: (x) => x.wickets },
            { head: 'Best', num: true, cell: (x) => d0(x.best) }, { head: 'Econ', num: true, cell: (x) => d0(x.economy) },
          ]} /></div>
          <div className="card"><div className="card-head"><h3>In the field</h3></div><Table rows={d.fielding} rowKey={(x) => x.userId} empty="Nobody yet." cols={[
            { head: 'Player', cell: (x) => <span className="strong">{x.name}</span> }, { head: 'Catches', num: true, cell: (x) => x.catches }, { head: 'All', num: true, cell: (x) => x.dismissals },
          ]} /></div>
        </div>}
        <p className="hint small">From the ball by ball score of finished matches. Only players linked to their Daji profile in a squad have a record; guests have none.</p>
      </div>
    )}</Async>
  );
}
