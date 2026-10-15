import { Table } from '../../ui';
import { nrrText, type Detail } from './shared';

/** Points table, worked out on the server from the fixture results. */
export function TableTab({ d }: { d: Detail }) {
  const t = d.tournament;
  return (
    <div className="card">
      <div className="card-head"><h3>Points table</h3><span className="small muted">{t.pointsWin} for a win, {t.pointsTie} for a tie or no result</span></div>
      <Table rows={d.table} empty="Add teams to see the table."
        cols={[
          { head: '#', cell: (_r) => '' , width: 40 },
          { head: 'Team', cell: (r) => <b>{r.team}</b> },
          { head: 'P', num: true, cell: (r) => r.played },
          { head: 'W', num: true, cell: (r) => r.won },
          { head: 'L', num: true, cell: (r) => r.lost },
          { head: 'T', num: true, cell: (r) => r.tied },
          { head: 'NR', num: true, cell: (r) => r.noResult },
          { head: 'NRR', num: true, cell: (r) => nrrText(r.nrr) },
          { head: 'Pts', num: true, cell: (r) => <b className="gold">{r.points}</b> },
        ].map((c, i) => (i === 0 ? { ...c, cell: (r: any) => d.table.indexOf(r) + 1 } : c))} />
      <div className="card-pad small muted">Net run rate shows once every played game has runs and overs entered. A team that is all out counts as having faced its full overs.</div>
    </div>
  );
}
