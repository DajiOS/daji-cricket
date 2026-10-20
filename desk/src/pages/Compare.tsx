import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Tabs } from '../ui';
import { useApi, go, can, inr, thisMonth, addDaysISO, type Me } from '../lib';
import { seesMoney } from '../registry';

// The starter kit's side-by-side compare: two months of the books, a month against its budget, or the two grounds.
type Mode = 'months' | 'budget' | 'grounds';
interface Row { label: string; kind: 'money' | 'count' | 'pct'; values: (number | null)[]; head?: boolean; better?: 'up' | 'down' }
interface Cmp { mode: Mode; columns: string[]; rows: Row[]; notes: string[] }
const modesFor = (me: Me): [Mode, string][] => [
  ...(seesMoney(me) ? [['months', 'Two months'], ['budget', 'Month and budget']] as [Mode, string][] : []),
  ...(can(me, 'manage_bookings') ? [['grounds', 'The grounds']] as [Mode, string][] : []),
];
const fmt = (k: Row['kind'], v: number | null) => (v == null ? '–' : k === 'money' ? inr(v) : k === 'pct' ? `${Math.round(v)}%` : v.toLocaleString('en-IN'));
const prev = (m: string) => addDaysISO(m + '-01', -1).slice(0, 7);

/** The change from the second column to the first, coloured by whether up is good for that row. */
function Delta({ r }: { r: Row }) {
  const [a, b] = r.values;
  if (a == null || b == null || a === b) return <span className="muted">–</span>;
  const d = a - b;
  const good = r.better ? (r.better === 'up') === d > 0 : null;
  const pct = r.kind !== 'pct' && b ? ` (${d > 0 ? '+' : ''}${Math.round((d / Math.abs(b)) * 100)}%)` : '';
  return <span className={good == null ? '' : good ? 'cmp-up' : 'cmp-down'}>{d > 0 ? '+' : '−'}{fmt(r.kind, Math.abs(d))}{r.kind === 'pct' ? ' pts' : ''}{pct}</span>;
}

export default function Compare({ sub }: { sub: string }) {
  const { me, ownerId } = useSession();
  const modes = modesFor(me);
  const [m0, a0, b0] = sub.split('/');
  const mode: Mode = modes.find(([k]) => k === m0)?.[0] ?? modes[0]?.[0] ?? 'grounds';
  const a = /^\d{4}-\d{2}$/.test(a0 ?? '') ? a0! : mode === 'months' || mode === 'budget' ? prev(thisMonth()) : thisMonth();
  const b = /^\d{4}-\d{2}$/.test(b0 ?? '') ? b0! : prev(a);
  const [d, err] = useApi<Cmp>(modes.length ? `/api/desk/compare?mode=${mode}&a=${a}${mode === 'months' ? `&b=${b}` : ''}` : null, [ownerId]);
  const to = (m: Mode, x: string, y?: string) => go(`/compare/${m}/${x}${m === 'months' && y ? `/${y}` : ''}`);
  const two = d?.columns.length === 2 && d.mode !== 'grounds';

  return (
    <div className="stack">
      <PageHead eyebrow="Side by side" title="Compare" lede="Put two months of the books next to each other, check a month against its budget, or see how the grounds did against each other." />
      {!modes.length ? <p className="muted">Your login has nothing to compare.</p> : <>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {modes.length > 1 && <Tabs value={mode} onChange={(m) => to(m, a, b)} items={modes} label="Compare" />}
          <label className="row small" style={{ gap: 6 }}>{mode === 'months' ? 'This month' : 'Month'}<input className="inp" type="month" value={a} onChange={(e) => e.target.value && to(mode, e.target.value, b)} /></label>
          {mode === 'months' && <label className="row small" style={{ gap: 6 }}>against<input className="inp" type="month" value={b} onChange={(e) => e.target.value && to(mode, a, e.target.value)} /></label>}
        </div>
        <ErrorBox msg={err} />
        {!d ? (!err && <Loading h={360} />) : (
          <section className="card">
            <div className="tbl-wrap">
              <table className="tbl cmp">
                <thead><tr><th />{d.columns.map((c) => <th key={c} className="num">{c}</th>)}{two && <th className="num">Change</th>}</tr></thead>
                <tbody>{d.rows.map((r, i) => {
                  const best = d.mode === 'grounds' && r.better && r.values.some((v) => v) ? Math[r.better === 'up' ? 'max' : 'min'](...r.values.map((v) => v ?? 0)) : null;
                  return (
                    <tr key={i} className={r.head ? 'cmp-head' : ''}>
                      <td>{r.label}</td>
                      {r.values.map((v, k) => <td key={k} className={`num${best != null && v === best ? ' cmp-best' : ''}`}>{fmt(r.kind, v)}</td>)}
                      {two && <td className="num"><Delta r={r} /></td>}
                    </tr>);
                })}</tbody>
              </table>
            </div>
          </section>)}
        {d?.notes.map((n) => <p key={n} className="small muted" style={{ margin: 0 }}>{n}</p>)}
      </>}
    </div>
  );
}
