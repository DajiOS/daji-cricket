// One task card: edit it, move it, add camera photos (proof) and references (not proof), pick helpers, accept and sign off, and talk about it.
import { useEffect, useRef, useState } from 'react';
import { Field, Modal, useToast, DateInput } from '../../ui';
import { fetchBlob, fmtDateTime, patch, post, sendFile, useApi } from '../../lib';
import { Select, errMsg } from './common';
import { COLS, PRI, REPEAT, type Project, type Task, type TaskPhoto } from './taskTypes';
import { HistoryList, References, WorkPanel } from './TaskWork';

/** A task photo needs the sign-in header, so it is fetched and shown from a blob. */
function Photo({ p }: { p: TaskPhoto }) {
  const [src, setSrc] = useState<string | null>(/^data:/.test(p.url) ? p.url : null);
  useEffect(() => {
    if (src) return; let live = true; let url = '';
    fetchBlob(p.url).then((b) => { if (live) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.url]);
  return src ? <img className="tphoto" src={src} alt="Task photo" loading="lazy" title={`Taken ${fmtDateTime(p.takenAt)}${p.uploadedByName ? ' by ' + p.uploadedByName : ''}${p.note ? ' · ' + p.note : ''}`} /> : <div className="tphoto none" />;
}

interface Comment { id?: string; authorName: string; at: number; body: string; mine?: boolean }

export default function TaskDialog({ task, projects, team, manager, meId, defaultProject, onClose, onChanged }: {
  task: Task | null; projects: Project[]; team: { id: string; name: string }[]; manager: boolean; meId: string; defaultProject: string; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast(); const t = task; const isNew = !t; const editable = manager && (isNew || t!.status === 'open');
  const [f, setF] = useState({ title: t?.title || '', details: t?.details || '', who: t?.assignedTo || '', pri: t?.priority || 'medium', due: t?.dueDate || '', need: String(t ? t.photosRequired : 1), proj: t ? t.projectId || '' : defaultProject, mile: t?.milestoneId || '', rep: t?.repeat || '', list: (t?.checklist ?? []).map((c) => c.text).join('\n') });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const proj = projects.find((p) => p.id === f.proj);
  const save = async () => {
    setErr(null); setBusy(true);
    const body = { title: f.title.trim(), details: f.details.trim() || undefined, assignedTo: f.who || null, priority: f.pri, dueDate: f.due || null, photosRequired: Number(f.need), projectId: f.proj || null, milestoneId: f.mile || null, repeat: f.rep || null, checklist: f.list.split('\n').map((x) => x.trim()).filter(Boolean) };
    try { await (isNew ? post('/api/tasks', body) : patch('/api/tasks/' + encodeURIComponent(t!.id), body)); toast(isNew ? 'Task added.' : 'Saved.'); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const cancel = async () => { try { await post(`/api/tasks/${encodeURIComponent(t!.id)}/cancel`, {}); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  const move = async (stage: string) => { try { await post(`/api/tasks/${encodeURIComponent(t!.id)}/move`, { stage, index: 0 }); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={isNew ? 'New task' : 'Task'} onClose={onClose} wide
      foot={editable ? <>{!isNew && <button className="btn ghost danger" onClick={cancel}>Cancel task</button>}<button className="btn primary" disabled={busy} onClick={save}>{isNew ? 'Add task' : 'Save changes'}</button></> : undefined}>
      <div className="form-grid">
        <Field label="Title" full required><input className="inp" maxLength={120} placeholder="What needs doing? e.g. Roll the pitch" disabled={!editable} value={f.title} onChange={set('title')} /></Field>
        <Field label="Details" full><textarea className="inp" rows={3} maxLength={1000} placeholder="Details (optional)" disabled={!editable} value={f.details} onChange={set('details')} /></Field>
        <Field label="Assigned to"><Select disabled={!editable} value={f.who} onChange={(v) => setF((x) => ({ ...x, who: v }))} options={[['', 'Anyone on the team'], ...team.map((m) => [m.id, m.name] as [string, string])]} /></Field>
        <Field label="Priority"><Select disabled={!editable} value={f.pri} onChange={(v) => setF((x) => ({ ...x, pri: v as Task['priority'] }))} options={Object.entries(PRI)} /></Field>
        <Field label="Due day"><DateInput className="inp" disabled={!editable} value={f.due} onChange={set('due')} /></Field>
        <Field label="Photos needed"><input className="inp" type="number" min={0} max={10} disabled={!editable} value={f.need} onChange={set('need')} /></Field>
        <Field label="Project"><Select disabled={!editable} value={f.proj} onChange={(v) => setF((x) => ({ ...x, proj: v, mile: '' }))} options={[['', 'No project'], ...projects.filter((p) => p.status === 'active' || p.id === t?.projectId).map((p) => [p.id, p.name] as [string, string])]} /></Field>
        <Field label="Repeats" hint={f.rep ? 'Closing it adds the next one to To do.' : undefined}><Select disabled={!editable} value={f.rep} onChange={(v) => setF((x) => ({ ...x, rep: v }))} options={Object.entries(REPEAT)} /></Field>
        <Field label="Checklist" full hint="One step per line. Ticks stay on steps you do not reword."><textarea className="inp" rows={3} maxLength={3000} placeholder={'e.g. Sweep the crease\nRoll the pitch'} disabled={!editable} value={f.list} onChange={set('list')} /></Field>
        <Field label="Milestone"><Select disabled={!editable} value={f.mile} onChange={(v) => setF((x) => ({ ...x, mile: v }))} options={[['', 'No milestone'], ...(proj?.milestones ?? []).map((m) => [m.id, m.title + (m.done ? ' (done)' : '')] as [string, string])]} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {t && <WorkPanel t={t} team={team} manager={manager} meId={meId} onChanged={onChanged} setErr={setErr} />}
      {t && <Extras t={t} manager={manager} meId={meId} onMove={move} onChanged={onChanged} setErr={setErr} />}
    </Modal>
  );
}

function Extras({ t, manager, meId, onMove, onChanged, setErr }: { t: Task; manager: boolean; meId: string; onMove: (s: string) => void; onChanged: () => void; setErr: (m: string | null) => void }) {
  const toast = useToast(); const pick = useRef<HTMLInputElement>(null);
  const [cm, , reload] = useApi<{ items: Comment[] }>(`/api/tasks/${encodeURIComponent(t.id)}/comments`);
  const [text, setText] = useState('');
  const need = Math.max(0, t.photosRequired - t.photos.length);
  /** Camera only: the phone opens its camera, and the file goes up untouched, because re-saving a picture would wipe its camera time. */
  const upload = async (file?: File) => {
    if (!file) return;
    try { await sendFile(`/api/tasks/${encodeURIComponent(t.id)}/photos`, file); toast('Photo added.'); onChanged(); } catch (e) { setErr(errMsg(e)); toast(errMsg(e)); }
  };
  const send = async () => {
    const v = text.trim(); if (!v) return;
    try { await post(`/api/tasks/${encodeURIComponent(t.id)}/comments`, { body: v }); setText(''); reload(); onChanged(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <>
      <div className="divider" style={{ margin: '20px 0 14px' }} />
      <div className="eyebrow" style={{ marginBottom: 8 }}>Move to</div>
      <Select value={t.stage} onChange={onMove} label="Move to" options={COLS.map(([k, l]) => [k, l] as [string, string])} />
      {t.checklist.length > 0 && <Checklist t={t} onChanged={onChanged} setErr={setErr} />}
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Proof photos ({t.photos.length} of {t.photosRequired})</div>
      {t.photos.length ? <div className="tphotos">{t.photos.map((p, i) => <Photo key={p.url + i} p={p} />)}</div>
        : <p className="hint">{need ? 'Taken with the phone camera, within the last 5 minutes. Gallery pictures and screenshots are turned away.' : 'No photos needed.'}</p>}
      {t.status === 'open' && <><input ref={pick} type="file" accept="image/jpeg" capture="environment" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /><button className="btn sm" style={{ marginTop: 8 }} onClick={() => pick.current?.click()}>Take photo</button></>}
      {t.status === 'done' && <p className="hint">Done {fmtDateTime(t.completedAt)}{t.completedByName ? ' by ' + t.completedByName : ''}</p>}
      <References t={t} manager={manager} meId={meId} onChanged={onChanged} setErr={setErr} />
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Comments</div>
      <div className="kcomments">
        {cm && !cm.items.length && <p className="hint">No comments yet.</p>}
        {cm?.items.map((c, i) => <div key={i} className={'kc' + (c.mine ? ' mine' : '')}><b>{c.authorName}</b><span className="muted small"> · {fmtDateTime(c.at)}</span><p>{c.body}</p></div>)}
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
        <input className="inp" maxLength={1000} placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
        <button className="btn sm" onClick={send}>Send</button>
      </div>
      <HistoryList taskId={t.id} stamp={JSON.stringify([t.stage, t.status, t.photos.length, t.references.length, t.helpers.length, t.nextAction, t.signedOffAt, t.acknowledgedAt, t.commentCount])} />
    </>
  );
}

/** The card's steps. Ticking saves at once; the person who may close the job may tick its steps. */
function Checklist({ t, onChanged, setErr }: { t: Task; onChanged: () => void; setErr: (m: string | null) => void }) {
  const [list, setList] = useState(t.checklist);
  const tick = async (index: number, done: boolean) => {
    setList((l) => l.map((c, i) => (i === index ? { ...c, done } : c)));
    try { const r = await post<Task>(`/api/tasks/${encodeURIComponent(t.id)}/checklist`, { index, done }); setList(r.checklist); onChanged(); } catch (e) { setErr(errMsg(e)); setList(t.checklist); }
  };
  return (
    <>
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Checklist ({list.filter((c) => c.done).length} of {list.length})</div>
      <div className="tchecks">
        {list.map((c, i) => <label key={i} className={'check' + (c.done ? ' done' : '')}><input type="checkbox" checked={c.done} disabled={t.status !== 'open'} onChange={(e) => tick(i, e.target.checked)} /><span>{c.text}</span></label>)}
      </div>
    </>
  );
}
