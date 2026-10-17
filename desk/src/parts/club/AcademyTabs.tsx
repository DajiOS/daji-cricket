// Academy: attendance, fees with the coach's share, the progress-card skills and the coaching staff.
import { useEffect, useRef, useState } from 'react';
import { Field, Modal, Stat, Status, Table, NameField, useToast } from '../../ui';
import { inr, post, put, sendFile, todayISO, toPaise, rupees, useApi } from '../../lib';
import { Async, Select, errMsg, monthName } from './common';

// ---------------------------------------------------------------- attendance
interface Pupil { id: string; name: string; batch: string | null }
export function Attendance() {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [att, aErr] = useApi<{ items: { studentId: string; present: boolean }[] }>('/api/staff/academy/attendance?date=' + date);
  const [pupils, pErr] = useApi<{ items: Pupil[] }>('/api/staff/academy/students?status=active');
  const [marks, setMarks] = useState<Record<string, boolean | null>>({});
  useEffect(() => { if (att) setMarks(Object.fromEntries(att.items.map((x) => [x.studentId, x.present]))); }, [att]);
  const rows = pupils?.items ?? [];
  const n = (v: boolean | null) => rows.filter((r) => (marks[r.id] ?? null) === v).length;
  const save = async () => {
    const list = rows.filter((r) => marks[r.id] != null).map((r) => ({ studentId: r.id, present: marks[r.id] }));
    if (!list.length) { toast('Mark at least one student.'); return; }
    try { const x = await post('/api/staff/academy/attendance', { date, marks: list }); toast(`Saved for ${x.saved} students.`); } catch (e) { toast(errMsg(e)); }
  };
  return (
    <div className="stack">
      <div className="grid g3">
        <Stat label="Present" value={n(true)} /><Stat label="Absent" value={n(false)} /><Stat label="Not marked" value={n(null)} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Attendance</h3>
          <div className="row"><input className="inp" type="date" aria-label="Day" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="btn ghost sm" onClick={() => setMarks(Object.fromEntries(rows.map((r) => [r.id, true])))}>Everyone present</button></div></div>
        <Async data={att && pupils} error={aErr || pErr}>{() => (
          <>
            {!rows.length ? <div className="card-pad muted">No active students.</div> : (
              <div className="tbl-wrap"><table className="tbl"><tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="strong">{r.name}</span>{r.batch && <span className="muted small"> · {r.batch}</span>}</td>
                  <td className="right"><div className="seg" role="group" aria-label={'Attendance for ' + r.name}>
                    <button className={marks[r.id] === true ? 'on' : ''} onClick={() => setMarks((m) => ({ ...m, [r.id]: true }))}>Present</button>
                    <button className={marks[r.id] === false ? 'on' : ''} onClick={() => setMarks((m) => ({ ...m, [r.id]: false }))}>Absent</button></div></td>
                </tr>))}</tbody></table></div>
            )}
            {rows.length > 0 && <div className="card-pad"><button className="btn primary" onClick={save}>Save attendance</button></div>}
          </>
        )}</Async>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- fees
interface Fee { id: string; studentName: string; batch: string | null; amountPaise: number; paidPaise: number; duePaise: number; status: string }
interface Share { partyName: string; percent: number | null }
const FEE: Record<string, ['good' | 'warn' | 'bad' | 'info' | 'mute', string]> = { paid: ['good', 'Paid'], part: ['warn', 'Part paid'], unpaid: ['info', 'Due'], overdue: ['bad', 'Overdue'] };

export function Fees({ month, setMonth, raising, setRaising }: { month: string; setMonth: (m: string) => void; raising: boolean; setRaising: (v: boolean) => void }) {
  const [n, setN] = useState(0);
  const [fees, fErr] = useApi<{ items: Fee[]; billedPaise: number; collectedPaise: number; outstandingPaise: number }>('/api/staff/academy/fees?month=' + month, [n]);
  const [stmt, sErr] = useApi<{ collectedPaise: number; coachSharePaise: number | null; academyKeepsPaise: number; share: Share }>('/api/staff/academy/share/statement?month=' + month, [n]);
  const [pay, setPay] = useState<Fee | null>(null); const [terms, setTerms] = useState(false);
  const again = () => setN((x) => x + 1);
  return (
    <div className="stack">
      <div className="grid g3">
        <Stat label="Billed" value={fees ? inr(fees.billedPaise) : '—'} foot={monthName(month)} />
        <Stat label="Collected" value={fees ? inr(fees.collectedPaise) : '—'} />
        <Stat label="Outstanding" value={fees ? inr(fees.outstandingPaise) : '—'} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Student fees</h3><input className="inp" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        <Async data={fees} error={fErr}>{(d) => (
          <Table rows={d.items} empty="No fees raised for this month. Use Raise fees." cols={[
            { head: 'Student', cell: (f) => <span className="strong">{f.studentName}</span> },
            { head: 'Batch', cell: (f) => f.batch || <span className="faint">—</span> },
            { head: 'Fee', num: true, cell: (f) => inr(f.amountPaise) },
            { head: 'Paid', num: true, cell: (f) => inr(f.paidPaise) },
            { head: 'Status', cell: (f) => <Status s={f.status} map={FEE} /> },
            { head: '', cell: (f) => (f.duePaise > 0 ? <button className="btn sm" onClick={() => setPay(f)}>Record payment</button> : null) },
          ]} />
        )}</Async>
      </div>
      <div className="card">
        <div className="card-head"><h3>Coach share</h3><button className="btn sm" onClick={() => setTerms(true)}>Set share terms</button></div>
        <div className="card-pad">
          <Async data={stmt} error={sErr}>{(t) => (
            <div className="stack">
              <div>Collected in {monthName(month)}: <b className="gold">{inr(t.collectedPaise)}</b></div>
              {t.coachSharePaise == null ? <p className="hint">Share terms not set yet, so no split is shown.</p>
                : <div>{t.share.partyName} ({t.share.percent}%): <b className="gold">{inr(t.coachSharePaise)}</b><span className="muted"> · academy keeps {inr(t.academyKeepsPaise)}</span></div>}
              {terms && <ShareDialog sh={t.share} onClose={() => setTerms(false)} onSaved={again} />}
            </div>
          )}</Async>
        </div>
      </div>
      {raising && <RaiseDialog month={month} onClose={() => setRaising(false)} onSaved={again} />}
      {pay && <PayDialog f={pay} onClose={() => setPay(null)} onSaved={again} />}
    </div>
  );
}

function RaiseDialog({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [amt, setAmt] = useState(''); const [due, setDue] = useState(month + '-10'); const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    const p = toPaise(amt); if (!p || p <= 0) { setErr('Enter the monthly fee in rupees.'); return; }
    try { const r = await post('/api/staff/academy/fees', { month, amountPaise: p, dueOn: due }); toast(`${r.created} fee(s) raised.`); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={'Raise fees for ' + monthName(month)} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Raise fees</button></>}>
      <div className="form-grid">
        <Field label="Fee per student (₹)"><input className="inp" inputMode="decimal" placeholder="Monthly fee in rupees" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Due date"><input className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

function PayDialog({ f, onClose, onSaved }: { f: Fee; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [amt, setAmt] = useState(rupees(f.duePaise)); const [mode, setMode] = useState('upi'); const [on, setOn] = useState(todayISO()); const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    const p = toPaise(amt); if (!p || p <= 0) { setErr('Enter the amount in rupees.'); return; }
    try { await post(`/api/staff/academy/fees/${f.id}/payments`, { amountPaise: p, mode, receivedOn: on }); toast('Payment recorded.'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={'Payment from ' + f.studentName} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Save</button></>}>
      <div className="form-grid">
        <Field label="Amount (₹)"><input className="inp" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="How paid"><Select value={mode} onChange={setMode} options={[['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card']]} /></Field>
        <Field label="Received on"><input className="inp" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

function ShareDialog({ sh, onClose, onSaved }: { sh: Share; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [who, setWho] = useState(sh.partyName); const [pct, setPct] = useState(sh.percent == null ? '' : String(sh.percent)); const [err, setErr] = useState<string | null>(null);
  const go = async () => { try { await put('/api/staff/academy/share', { partyName: who, percent: pct === '' ? null : Number(pct) }); toast('Saved.'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title="Coach share of student fees" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Save</button></>}>
      <p className="hint">Enter the percentage only once it has been agreed. Only the owner can change this.</p>
      <div className="form-grid">
        <Field label="Paid to"><input className="inp" maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Percent of fees collected"><input className="inp" type="number" min="0" max="100" step="0.5" placeholder="Leave blank until agreed" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- skills
export function Skills() {
  const toast = useToast(); const [data, error] = useApi<{ skills: string[] }>('/api/staff/academy/skills');
  const [v, setV] = useState<string[]>([]); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setV(data.skills); }, [data]);
  const save = async () => { setErr(null); try { await put('/api/staff/academy/skills', { skills: v.map((x) => x.trim()) }); toast('Saved.'); } catch (e) { setErr(errMsg(e)); } };
  return (
    <div className="card">
      <div className="card-head"><h3>Skills on the progress card</h3></div>
      <div className="card-pad">
        <Async data={data} error={error}>{() => (
          <div className="stack">
            <p className="hint">Five things you rate each child on every month. Rename them to match how your coaches talk.</p>
            <div className="form-grid">{v.map((x, i) => <Field key={i} label={`Skill ${i + 1}`}><input className="inp" maxLength={30} value={x} onChange={(e) => setV((a) => a.map((y, j) => (j === i ? e.target.value : y)))} /></Field>)}</div>
            {err && <div className="err" role="alert">{err}</div>}
            <div><button className="btn primary" onClick={save}>Save skills</button></div>
          </div>
        )}</Async>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- coaches
interface Coach { name: string; title: string; bio: string; photo: string }
export function Coaches({ adding }: { adding: number }) {
  const toast = useToast(); const [data, error] = useApi<{ items: Coach[] }>('/api/staff/academy/coaches');
  const [rows, setRows] = useState<Coach[]>([]); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setRows(data.items.map((c) => ({ ...c }))); }, [data]);
  const seen = useRef(adding);
  useEffect(() => { if (adding === seen.current) return; seen.current = adding; setRows((r) => { if (r.length >= 12) { toast('Up to 12 coaches.'); return r; } return [...r, { name: '', title: '', bio: '', photo: '' }]; }); }, [adding]);
  const upd = (i: number, k: keyof Coach, v: string) => setRows((r) => r.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const swap = (i: number, j: number) => setRows((r) => { if (j < 0 || j >= r.length) return r; const a = r.slice(); [a[i], a[j]] = [a[j]!, a[i]!]; return a; });
  const upload = async (i: number, f?: File) => {
    if (!f) return;
    try { const r = await sendFile(`/api/media?kind=academy&filename=${encodeURIComponent(f.name)}`, f); upd(i, 'photo', r.url); toast('Uploaded. Press Save to publish.'); } catch (e) { toast(errMsg(e)); }
  };
  const save = async () => {
    setErr(null);
    try { const r = await put('/api/staff/academy/coaches', { items: rows.map((c) => ({ name: c.name.trim(), title: c.title.trim(), bio: c.bio.trim(), photo: c.photo.trim() })) }); setRows(r.items.map((c: Coach) => ({ ...c }))); toast('Saved.'); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="stack">
      <p className="hint">Shown on the MP13 Academy page. Up to 12 coaches.</p>
      <Async data={data} error={error}>{() => (
        <>
          {!rows.length && <div className="card"><div className="empty">No coaches yet. Add the first one.</div></div>}
          <div className="grid g2">{rows.map((c, i) => (
            <div className="card card-pad stack" key={i}>
              <div className="coach-top">
                {c.photo ? <img className="coach-ph" src={c.photo} alt="" /> : <div className="coach-ph none">{(c.name || '?')[0]}</div>}
                <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                  <div className="form-grid"><NameField value={c.name} onChange={(n) => upd(i, 'name', n)} /></div>
                </div>
              </div>
              <Field label="Title"><input className="inp" maxLength={80} placeholder="e.g. Head coach, BCCI Level 2" value={c.title} onChange={(e) => upd(i, 'title', e.target.value)} /></Field>
              <Field label="About"><textarea className="inp" maxLength={400} placeholder="A line or two about experience" value={c.bio} onChange={(e) => upd(i, 'bio', e.target.value)} /></Field>
              <Field label="Photo link, or upload below"><input className="inp" value={c.photo} onChange={(e) => upd(i, 'photo', e.target.value)} /></Field>
              <input type="file" className="small muted" accept="image/jpeg,image/png,image/webp" onChange={(e) => { upload(i, e.target.files?.[0]); e.target.value = ''; }} />
              <div className="row"><button className="btn ghost sm" onClick={() => swap(i, i - 1)}>Up</button><button className="btn ghost sm" onClick={() => swap(i, i + 1)}>Down</button><button className="btn ghost sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>Remove</button></div>
            </div>))}</div>
          {err && <div className="err" role="alert">{err}</div>}
          <div><button className="btn primary" onClick={save}>Save coaches</button></div>
        </>
      )}</Async>
    </div>
  );
}
