// Academy: the student list, add/edit, parent and student logins, and monthly progress cards.
import { useState } from 'react';
import { Chip, Confirm, Field, Modal, Table, NameField, useToast, DateInput } from '../../ui';
import { post, put, patch, thisMonth, useApi, qs } from '../../lib';
import { Async, FilterBar, Select, errMsg, monthName, useDebounced } from './common';

export interface Student {
  id: string; name: string; batch: string | null; bornOn: string | null; status: 'active' | 'left';
  guardianName: string; guardianPhone: string | null; guardianEmail: string | null; notes: string | null;
  photoConsent: boolean; videoConsent: boolean; linked: boolean; selfLinked: boolean;
}

export default function Students({ tick, adding, setAdding }: { tick: number; adding: boolean; setAdding: (v: boolean) => void }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('active'); const [again, setAgain] = useState(0);
  const dq = useDebounced(q);
  const [data, error, reload] = useApi<{ items: Student[] }>('/api/staff/academy/students' + qs({ status, q: dq.trim() }), [tick, again]);
  const [edit, setEdit] = useState<Student | null>(null); const [parent, setParent] = useState<Student | null>(null); const [prog, setProg] = useState<Student | null>(null);
  const done = () => { reload(); setAgain((n) => n + 1); };
  return (
    <div className="card">
      <div className="card-head"><h3>Students</h3><span className="muted small">{data ? `${data.items.length} shown` : ''}</span></div>
      <div className="card-pad">
        <FilterBar>
          <Field label="Search"><input className="inp" type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Show"><Select value={status} onChange={setStatus} options={[['active', 'Active'], ['left', 'Left'], ['', 'All']]} /></Field>
        </FilterBar>
      </div>
      <Async data={data} error={error}>{(d) => (
        <Table rows={d.items} empty="No students yet. Add the first one." cols={[
          { head: 'Student', cell: (s) => <><span className="strong nw">{s.name}</span>{s.status === 'left' && <> <Chip>Left</Chip></>}</> },
          { head: 'Batch', cell: (s) => s.batch || <span className="faint">—</span> },
          { head: 'Parent', cell: (s) => <>{s.guardianName}{s.guardianPhone && <span className="muted small"> · {s.guardianPhone}</span>}</> },
          { head: 'Parent app', cell: (s) => (s.linked ? <Chip tone="good">Linked</Chip> : <Chip>Not linked</Chip>) },
          { head: '', cell: (s) => <div className="row end"><button className="btn ghost sm" onClick={() => setProg(s)}>Progress</button><button className="btn ghost sm" onClick={() => setParent(s)}>Parent</button><button className="btn ghost sm" onClick={() => setEdit(s)}>Edit</button></div> },
        ]} />
      )}</Async>
      {(adding || edit) && <StudentDialog s={edit} onClose={() => { setAdding(false); setEdit(null); }} onSaved={done} />}
      {parent && <ParentDialog s={parent} onClose={() => setParent(null)} onSaved={done} />}
      {prog && <ProgressDialog s={prog} onClose={() => setProg(null)} />}
    </div>
  );
}

function StudentDialog({ s, onClose, onSaved }: { s: Student | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: s?.name || '', bornOn: s?.bornOn || '', batch: s?.batch || '', guardianName: s?.guardianName || '', guardianPhone: s?.guardianPhone || '', guardianEmail: s?.guardianEmail || '', notes: s?.notes || '', photoConsent: !!s?.photoConsent, videoConsent: !!s?.videoConsent, status: s?.status || 'active' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setErr(null); setBusy(true);
    const body: Record<string, unknown> = { name: f.name.trim(), bornOn: f.bornOn || undefined, batch: f.batch.trim() || undefined, guardianName: f.guardianName.trim(), guardianPhone: f.guardianPhone.trim() || undefined, guardianEmail: f.guardianEmail.trim() || undefined, notes: f.notes.trim() || undefined, photoConsent: f.photoConsent, videoConsent: f.videoConsent };
    if (s) body.status = f.status;
    try { await (s ? patch('/api/staff/academy/students/' + s.id, body) : post('/api/staff/academy/students', body)); toast('Saved.'); onSaved(); onClose(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={s ? 'Edit student' : 'Add a student'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <NameField value={f.name} onChange={(n) => setF((x) => ({ ...x, name: n }))} required />
        <Field label="Date of birth"><DateInput className="inp" value={f.bornOn} onChange={set('bornOn')} /></Field>
        <Field label="Batch"><input className="inp" value={f.batch} onChange={set('batch')} placeholder="U-14 weekday" /></Field>
        <NameField value={f.guardianName} onChange={(n) => setF((x) => ({ ...x, guardianName: n }))} firstLabel="Parent first name" lastLabel="Parent last name" />
        <Field label="Parent phone"><input className="inp" inputMode="tel" value={f.guardianPhone} onChange={set('guardianPhone')} /></Field>
        <Field label="Parent email" hint="Used only to let the parent see their child's progress cards, after you link them."><input className="inp" type="email" value={f.guardianEmail} onChange={set('guardianEmail')} /></Field>
        <Field label="Notes" full><textarea className="inp" value={f.notes} onChange={set('notes')} /></Field>
        <label className="check full"><input type="checkbox" checked={f.photoConsent} onChange={set('photoConsent')} /> Parent agrees to photos of the child being used</label>
        <label className="check full"><input type="checkbox" checked={f.videoConsent} onChange={set('videoConsent')} /> Parent agrees to match video that shows the child being shared</label>
        {s && <Field label="Status"><Select value={f.status} onChange={(v) => setF((x) => ({ ...x, status: v as 'active' | 'left' }))} options={[['active', 'Active'], ['left', 'Left MP13 Academy']]} /></Field>}
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

function ParentDialog({ s, onClose, onSaved }: { s: Student; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(s.guardianEmail || ''); const [semail, setSemail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const age = s.bornOn ? Math.floor((Date.now() - new Date(s.bornOn).getTime()) / 31557600000) : null;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); try { await fn(); toast(msg); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  const base = '/api/staff/academy/students/' + s.id;
  return (
    <Modal title={`Parent app for ${s.name}`} onClose={onClose}>
      <p className="hint">{s.linked ? 'This child is linked to a parent account. The parent sees only the progress cards you publish.' : 'Link the child to the parent\'s account on this website. They must have created an account with this email. You confirm the link, so someone else cannot claim a child just by using the same email.'}</p>
      <Field label="Parent's account email"><input className="inp" type="email" value={email} placeholder="parent@example.com" onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary sm" onClick={() => run(() => post(base + '/link-guardian', { email: email.trim() }), 'Linked.')}>{s.linked ? 'Link to a different account' : 'Link account'}</button>
        {s.linked && <Confirm label="Unlink" ask="Unlink this parent?" onYes={() => run(() => post(base + '/unlink-guardian', {}), 'Unlinked.')} />}
      </div>
      <div className="divider" style={{ margin: '22px 0 16px' }} />
      <div className="eyebrow" style={{ marginBottom: 8 }}>Student's own login</div>
      {age === null ? <p className="hint">Add a date of birth to the student first. From the age of 16 a student can have a login of their own.</p>
        : age < 16 ? <p className="hint">{s.name} is under 16, so progress is seen through the parent's account only.</p>
        : <>
          <p className="hint">{s.selfLinked ? `${s.name} has a login. They see their own attendance and the progress cards you publish.` : `${s.name} is 16 or over and can have a login of their own. They must first create an account on the website.`}</p>
          <Field label="Student's account email"><input className="inp" type="email" value={semail} placeholder="student@example.com" onChange={(e) => setSemail(e.target.value)} /></Field>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn sm" onClick={() => run(() => post(base + '/link-student', { email: semail.trim() }), 'Student login linked.')}>{s.selfLinked ? 'Link a different account' : 'Link student login'}</button>
            {s.selfLinked && <Confirm label="Remove student login" ask="Remove the login?" onYes={() => run(() => post(base + '/unlink-student', {}), 'Removed.')} />}
          </div>
        </>}
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

interface Card { month: string; comment: string | null; published: boolean; ratings: { skill: string; rating: number }[]; attendance: { present: number; sessions: number } }
const RATE: [string, string][] = [['1', '1  Needs work'], ['2', '2'], ['3', '3  Good'], ['4', '4'], ['5', '5  Excellent']];

function ProgressDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const [data, error] = useApi<{ items: Card[]; skills: string[] }>(`/api/staff/academy/students/${s.id}/progress`);
  const [cards, setCards] = useState<Card[] | null>(null); const [month, setMonth] = useState(thisMonth());
  const list = cards ?? data?.items ?? [];
  const put1 = (n: Card) => setCards([...list.filter((x) => x.month !== n.month), n]);
  return (
    <Modal title={`Progress card: ${s.name}`} onClose={onClose} wide>
      <Async data={data} error={error}>{(d) => (
        <>
          <Field label="Month"><input className="inp" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
          <ProgressForm key={month + (list.find((x) => x.month === month)?.published ? 'p' : '')} s={s} month={month} skills={d.skills} card={list.find((x) => x.month === month) || null} onCard={put1} />
        </>
      )}</Async>
    </Modal>
  );
}

function ProgressForm({ s, month, skills, card, onCard }: { s: Student; month: string; skills: string[]; card: Card | null; onCard: (c: Card) => void }) {
  const toast = useToast();
  const [rating, setRating] = useState<Record<string, string>>(() => Object.fromEntries(skills.map((k) => [k, String(card?.ratings.find((r) => r.skill === k)?.rating || 3)])));
  const [comment, setComment] = useState(card?.comment || ''); const [err, setErr] = useState<string | null>(null);
  const base = `/api/staff/academy/students/${s.id}/progress/${month}`;
  const save = async () => {
    setErr(null);
    try { const n = await put<Card>(base, { ratings: Object.fromEntries(skills.map((k) => [k, Number(rating[k])])), comment: comment.trim() || undefined }); onCard(n); toast('Saved.'); } catch (e) { setErr(errMsg(e)); }
  };
  const publish = async () => { try { const n = await post<Card>(base + '/publish', { published: !card!.published }); onCard(n); toast(n.published ? 'Published.' : 'Hidden.'); } catch (e) { setErr(errMsg(e)); } };
  return (
    <div style={{ marginTop: 14 }}>
      <p className="hint" style={{ marginBottom: 14 }}>{card ? (card.published ? <>Published to the parent. Attendance: {card.attendance.present} of {card.attendance.sessions} sessions.</> : 'Saved, not yet visible to the parent.') : `No card for ${monthName(month)} yet.`}</p>
      <div className="form-grid">
        {skills.map((k) => <Field key={k} label={k}><Select value={rating[k]!} onChange={(v) => setRating((r) => ({ ...r, [k]: v }))} options={RATE} /></Field>)}
        <Field label="Comment" full><textarea className="inp" value={comment} placeholder="A few kind, specific words for the parent" onChange={(e) => setComment(e.target.value)} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <div className="row" style={{ marginTop: 14 }}><button className="btn primary sm" onClick={save}>Save card</button>{card && <button className="btn sm" onClick={publish}>{card.published ? 'Hide from parent' : 'Publish to parent'}</button>}</div>
    </div>
  );
}
