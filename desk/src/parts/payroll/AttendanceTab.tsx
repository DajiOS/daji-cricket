import { useEffect, useState } from 'react';
import { api, put, useApi } from '../../lib';
import { Tabs, Chip, ErrorBox, Loading, useToast } from '../../ui';
import { PAY, STATUS_LETTER, STATUS_LABEL, days, type AttStatus, type PayStaff } from './common';

interface Row extends PayStaff { marks: Record<string, AttStatus>; counts: Record<AttStatus, number> }
interface Sheet { month: string; days: number; locked: boolean; today: string; staff: Row[] }
type Brush = AttStatus | 'clear';

export function AttendanceTab({ month, onChanged }: { month: string; onChanged: () => void }) {
  const [d, err, reload] = useApi<Sheet>(`${PAY}/attendance?month=${month}`);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [brush, setBrush] = useState<Brush>('present');
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (d && d.month === month) setSheet(d); }, [d, month]);
  useEffect(() => { setSheet(null); }, [month]);
  if (err) return <ErrorBox msg={err} />;
  if (!sheet) return <Loading />;

  const dayKey = (n: number) => String(n).padStart(2, '0');
  const date = (n: number) => `${month}-${dayKey(n)}`;
  const editable = (s: Row, n: number) => !sheet.locked && date(n) >= s.joinedOn && (!s.leftOn || date(n) <= s.leftOn) && date(n) <= sheet.today;

  /** Apply the chosen mark to many cells at once: update the grid straight away, then save; on a failure reload the truth. */
  async function apply(targets: { s: Row; n: number }[]) {
    const status = brush === 'clear' ? null : brush;
    const list = targets.filter((t) => editable(t.s, t.n));
    if (!list.length) return;
    setProblem(null);
    setSheet((cur) => cur && { ...cur, staff: cur.staff.map((s) => {
      const mine = list.filter((t) => t.s.id === s.id); if (!mine.length) return s;
      const marks = { ...s.marks };
      for (const t of mine) status ? (marks[dayKey(t.n)] = status) : delete marks[dayKey(t.n)];
      const counts = { present: 0, half: 0, absent: 0, leave: 0 }; for (const k of Object.values(marks)) counts[k]++;
      return { ...s, marks, counts };
    }) });
    try { await put(`${PAY}/attendance`, { entries: list.map((t) => ({ staffId: t.s.id, date: date(t.n), status })) }); onChanged(); }
    catch (e: any) { setProblem(e.message); reload(); }
  }
  const nums = Array.from({ length: sheet.days }, (_, i) => i + 1);
  const dow = (n: number) => 'SMTWTFS'[new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 1, n)).getUTCDay()]!;
  const allPresent = () => apply(sheet.staff.flatMap((s) => nums.filter((n) => !s.marks[dayKey(n)] && editable(s, n)).map((n) => ({ s, n }))));

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row pr-between">
          <div className="row">
            <span className="small muted">Pick a mark, then tap days</span>
            <div className="pr-brush"><Tabs<Brush> value={brush} onChange={setBrush} label="Mark to apply" items={[['present', 'Present'], ['half', 'Half day'], ['absent', 'Absent'], ['leave', 'Leave'], ['clear', 'Clear']]} /></div>
          </div>
          <div className="row">
            {sheet.locked && <Chip tone="info">Month finalised, read only</Chip>}
            {!sheet.locked && <button className="btn sm" onClick={() => { allPresent().then(() => toast('Unmarked days set to the chosen mark')); }}>Fill unmarked days</button>}
          </div>
        </div>
        <div className="hint">Tap a day number to mark everyone for that day. Paid leave counts for monthly salaries only; unmarked days are not paid.</div>
        <ErrorBox msg={problem} />
      </div>
      <div className="card">
        {!sheet.staff.length ? <div className="empty">No staff on the payroll for this month. Add people under Staff.</div> : (
          <div className="tbl-wrap">
            <table className="pr-grid">
              <thead><tr>
                <th className="pr-name">Staff</th>
                {nums.map((n) => <th key={n} className={`pr-day${dow(n) === 'S' ? ' wk' : ''}`}><button disabled={sheet.locked} title="Mark everyone" onClick={() => apply(sheet.staff.map((s) => ({ s, n })))}><b>{n}</b><i>{dow(n)}</i></button></th>)}
                <th className="pr-tot">P</th><th className="pr-tot">H</th><th className="pr-tot">A</th><th className="pr-tot">L</th>
              </tr></thead>
              <tbody>{sheet.staff.map((s) => (
                <tr key={s.id}>
                  <td className="pr-name"><span className="strong">{s.name}</span><div className="small muted">{s.role}</div></td>
                  {nums.map((n) => {
                    const m = s.marks[dayKey(n)]; const ok = editable(s, n);
                    return <td key={n} className="pr-cell"><button className={`pr-mark ${m ?? ''}`} disabled={!ok} aria-label={`${s.name} day ${n}: ${m ? STATUS_LABEL[m] : 'not marked'}`} onClick={() => apply([{ s, n }])}>{m ? STATUS_LETTER[m] : ''}</button></td>;
                  })}
                  <td className="pr-tot">{s.counts.present}</td><td className="pr-tot">{s.counts.half}</td><td className="pr-tot">{s.counts.absent}</td><td className="pr-tot">{s.counts.leave}</td>
                </tr>))}
              </tbody>
            </table>
          </div>)}
      </div>
      <div className="small muted">P present, H half day ({days(0.5)} paid), A absent, L leave. Days before joining, after leaving, or in the future cannot be marked.</div>
    </div>
  );
}
void api;
