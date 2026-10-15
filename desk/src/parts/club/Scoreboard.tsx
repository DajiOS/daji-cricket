// The scorecard shown while scoring a match.
import { Table } from '../../ui';

export interface Innings {
  number: number; team: string; runs: number; wickets: number; overs: string | number; runRate: number | null; target?: number | null; closed: boolean; recent: string[];
  batting: { name: string; runs: number; balls: number; fours: number; sixes: number; out?: string | null }[];
  bowling: { name: string; overs: string | number; runs: number; wickets: number; economy: number | null }[];
  extras: { total: number; wides: number; noBalls: number; byes: number; legByes: number };
}
export interface Score { match: { id: string; title: string; teamA: string; teamB: string; status: string; result?: string | null }; innings: Innings[] }

export default function Scoreboard({ sc }: { sc: Score }) {
  if (!sc.innings.length) return <div className="card"><div className="empty">The match has not started.</div></div>;
  return (
    <div className="grid g2">
      {sc.innings.map((i) => (
        <div className="card" key={i.number}>
          <div className="card-head"><h3>{i.team}</h3><span className="muted small">{i.overs} overs{i.runRate !== null ? ` · RR ${i.runRate}` : ''}{i.target ? ` · Target ${i.target}` : ''}</span></div>
          <div className="card-pad">
            <div className="sc-total">{i.runs}<span>/{i.wickets}</span></div>
            {i.recent.length > 0 && <div className="balls" aria-label="Recent balls">{i.recent.map((b, k) => <i key={k} className={/^W/.test(b) ? 'w' : /^[46]$/.test(b) ? 'f' : ''}>{b}</i>)}</div>}
          </div>
          <Table rows={i.batting} empty="No balls yet." cols={[
            { head: 'Batter', cell: (b) => <><span className="strong">{b.name}</span> <span className="muted small">{b.out || 'not out'}</span></> },
            { head: 'R', num: true, cell: (b) => b.runs }, { head: 'B', num: true, cell: (b) => b.balls },
            { head: '4s', num: true, cell: (b) => b.fours }, { head: '6s', num: true, cell: (b) => b.sixes },
          ]} />
          {i.bowling.length > 0 && <Table rows={i.bowling} cols={[
            { head: 'Bowler', cell: (b) => <span className="strong">{b.name}</span> },
            { head: 'O', num: true, cell: (b) => b.overs }, { head: 'R', num: true, cell: (b) => b.runs },
            { head: 'W', num: true, cell: (b) => b.wickets }, { head: 'Econ', num: true, cell: (b) => b.economy ?? '' },
          ]} />}
          <div className="card-pad small muted">Extras {i.extras.total} (wides {i.extras.wides}, no balls {i.extras.noBalls}, byes {i.extras.byes}, leg byes {i.extras.legByes})</div>
        </div>
      ))}
    </div>
  );
}
