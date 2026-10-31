// The tasks upgrade: who is on the job (helpers), its next action, accepting and signing off, references kept apart from proof,
// the job's history, the requests inbox, raising a request, and the daily site report.
import { useEffect, useRef, useState } from 'react';
import { Chip, Field, Modal, useToast, DateInput } from '../../ui';
import { download, fetchBlob, fmtDateTime, post, sendFile, todayISO as today, useApi } from '../../lib';
import { Select, errMsg } from './common';
import type { Project, Task, TaskRef } from './taskTypes';

type SetErr = (m: string | null) => void;
const tid = (t: Task) => encodeURIComponent(t.id);

/** Status lines and the actions for people on the job: accept it, set the next action, pick helpers, sign off, reopen with a reason. */
export function WorkPanel({ t, team, manager, meId, onChanged, setErr }: { t: Task; team: { id: string; name: string }[]; manager: boolean; meId: string; onChanged: () => void; setErr: SetErr }) {
  const toast = useToast();
  const [next, setNext] = useState(t.nextAction ?? '');
  const [helpers, setHelpers] = useState<string[]>(t.helpers.map((h) => h.id));
  const [why, setWhy] = useState(''); const [asking, setAsking] = useState(false);
  const call = async (path: string, body: unknown, done: string) => {
    setErr(null);
    try { await post(`/api/tasks/${tid(t)}/${path}`, body); toast(done); onChanged(); } catch (e) { setErr(errMsg(e)); toast(errMsg(e)); }
  };
  const mine = t.assignedTo ? t.assignedTo === meId : true;
  const open = t.status === 'open';
  return (
    <>
      <div className="divider" style={{ margin: '20px 0 14px' }} />
      <div className="twork">
        {t.intake && <p className="hint">Raised by {t.intake.byName ?? 'a team member'} as a request{t.intake.state === 'declined' ? ', turned down' : ''}{t.intake.note ? `: ${t.intake.note}` : ''}.</p>}
        {t.acknowledgedAt && <p className="hint">Accepted by {t.acknowledgedByName ?? 'the team'} {fmtDateTime(t.acknowledgedAt)}.</p>}
        {t.signedOffAt && <p className="hint ok">Signed off by {t.signedOffByName ?? 'a manager'} {fmtDateTime(t.signedOffAt)}.</p>}
        {t.reopenNote && open && <p className="hint">Reopened: {t.reopenNote}</p>}
        <div className="row" style={{ gap: 8 }}>
          {open && mine && !t.acknowledgedAt && t.intake?.state !== 'new' && <button className="btn sm" onClick={() => call('accept', {}, 'Accepted.')}>I've got it</button>}
          {manager && t.status === 'done' && !t.signedOffAt && <button className="btn sm primary" onClick={() => call('signoff', {}, 'Signed off.')}>Sign off the work</button>}
          {manager && t.status !== 'open' && !asking && <button className="btn sm ghost" onClick={() => setAsking(true)}>Reopen…</button>}
        </div>
        {asking && (
          <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
            <input className="inp" maxLength={300} placeholder="Why it needs more work (optional)" aria-label="Why it is reopened" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button className="btn sm" onClick={() => { setAsking(false); call('reopen', why.trim() ? { reason: why.trim() } : {}, 'Reopened.'); }}>Reopen</button>
          </div>
        )}
        {open && (
          <Field label="Next action" hint="The very next thing to do, so anyone on the job can pick it up.">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="inp" maxLength={200} placeholder="e.g. Buy green felt" value={next} onChange={(e) => setNext(e.target.value)} />
              <button className="btn sm" onClick={() => call('next', { text: next.trim() }, next.trim() ? 'Next action saved.' : 'Next action cleared.')}>Save</button>
            </div>
          </Field>
        )}
        {manager && open && (
          <Field label="Helpers" hint="They see the job, add proof photos and references, and can close it.">
            <div className="tchips">
              {team.filter((m) => m.id !== t.assignedTo).map((m) => {
                const on = helpers.includes(m.id);
                return <button key={m.id} type="button" className={'tchip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setHelpers((h) => (on ? h.filter((x) => x !== m.id) : [...h, m.id]))}>{m.name}</button>;
              })}
              {team.every((m) => m.id === t.assignedTo) && <span className="hint">No one else on the team to add.</span>}
            </div>
            {helpers.slice().sort().join() !== t.helpers.map((h) => h.id).sort().join() && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => call('helpers', { userIds: helpers }, 'Helpers saved.')}>Save helpers</button>}
          </Field>
        )}
        {!manager && t.helpers.length > 0 && <p className="hint">Helping: {t.helpers.map((h) => h.name).join(', ')}</p>}
      </div>
    </>
  );
}

function RefThumb({ r }: { r: TaskRef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (r.kind !== 'file' || !r.mime?.startsWith('image/')) return;
    let live = true; let url = '';
    fetchBlob(r.url).then((b) => { if (live) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [r.url]);
  return src ? <img className="tphoto" src={src} alt={r.name} loading="lazy" /> : <div className="tphoto none tref-icon" aria-hidden="true">{r.kind === 'link' ? 'Link' : 'PDF'}</div>;
}

/** References: pictures from the gallery or WhatsApp, quotes, PDFs and links. They explain the job; only camera photos prove it. */
/** The real site a link goes to, shown beside any name given to it so a look-alike name cannot hide where it leads. */
const linkHost = (r: TaskRef): string => { try { return new URL(r.url).hostname; } catch { return ''; } };

export function References({ t, manager, meId, onChanged, setErr }: { t: Task; manager: boolean; meId: string; onChanged: () => void; setErr: SetErr }) {
  const toast = useToast(); const pick = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(''); const [showLink, setShowLink] = useState(false);
  const add = async (file?: File) => {
    if (!file) return; setErr(null);
    try { await sendFile(`/api/tasks/${tid(t)}/references?name=${encodeURIComponent(file.name)}`, file); toast('Reference added.'); onChanged(); } catch (e) { setErr(errMsg(e)); toast(errMsg(e)); }
  };
  const addLink = async () => {
    setErr(null);
    try { await post(`/api/tasks/${tid(t)}/links`, { url: link.trim() }); setLink(''); setShowLink(false); toast('Link added.'); onChanged(); } catch (e) { setErr(errMsg(e)); }
  };
  const openRef = async (r: TaskRef) => {
    if (r.kind === 'link') { if (r.url.startsWith('https://')) window.open(r.url, '_blank', 'noopener,noreferrer'); return; }
    // a PDF is saved rather than opened: the site's policy blocks the browser's PDF viewer inside a page made from it
    try {
      if (r.mime === 'application/pdf') { await download(r.url, r.name); return; }
      const b = await fetchBlob(r.url); const u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (e) { toast(errMsg(e)); }
  };
  const hide = async (r: TaskRef) => {
    try { await post(`/api/tasks/refs/${encodeURIComponent(r.id)}/hide`, {}); toast('Reference taken off. It stays on record.'); onChanged(); } catch (e) { setErr(errMsg(e)); toast(errMsg(e)); }
  };
  const live = t.status !== 'cancelled';
  return (
    <>
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>References ({t.references.length})</div>
      <p className="hint" style={{ marginTop: 0 }}>Pictures from the gallery or WhatsApp, quotes, drawings and links that explain the job. They are not proof.</p>
      {t.references.length > 0 && (
        <div className="trefs">
          {t.references.map((r) => (
            <div key={r.id} className="tref">
              <button type="button" className="tref-open" onClick={() => openRef(r)} title={`Added ${fmtDateTime(r.addedAt)}${r.addedByName ? ' by ' + r.addedByName : ''}`}><RefThumb r={r} /><span>{r.name}</span>{r.kind === 'link' && linkHost(r) !== r.name && <span className="muted small">{linkHost(r)}</span>}</button>
              {r.note && <span className="muted small">{r.note}</span>}
              {live && (manager || r.addedById === meId) && <button type="button" className="btn ghost sm" onClick={() => hide(r)}>Take off</button>}
            </div>
          ))}
        </div>
      )}
      {live && (
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => { add(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn sm" onClick={() => pick.current?.click()}>Add picture or PDF</button>
          {!showLink && <button className="btn sm ghost" onClick={() => setShowLink(true)}>Add link</button>}
        </div>
      )}
      {showLink && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
          <input className="inp" type="url" maxLength={1000} placeholder="https://" aria-label="Link" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn sm" onClick={addLink}>Add</button>
        </div>
      )}
    </>
  );
}

/** Everything that happened to the job, newest last. */
export function HistoryList({ taskId, stamp }: { taskId: string; stamp: string }) {
  const [show, setShow] = useState(false);
  const [h, err, reload] = useApi<{ items: { at: number; who: string | null; what: string }[] }>(show ? `/api/tasks/${encodeURIComponent(taskId)}/history` : null);
  useEffect(() => { if (show) reload(); }, [stamp]);
  return (
    <>
      <div className="row" style={{ margin: '18px 0 8px', justifyContent: 'space-between' }}>
        <span className="eyebrow">History</span>
        <button className="btn ghost sm" aria-expanded={show} onClick={() => setShow((x) => !x)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {show && err && <p className="err">{err}</p>}
      {show && h && <ol className="thistory">{h.items.map((x, i) => <li key={i}><span className="muted small">{fmtDateTime(x.at)}</span> <b>{x.who ?? 'System'}</b> {x.what}</li>)}</ol>}
    </>
  );
}

/** Requests from the team, waiting for a manager to take them in (as a job for someone) or turn them down with a reason. */
export function InboxDialog({ team, manager, meId, onClose, onChanged }: { team: { id: string; name: string }[]; manager: boolean; meId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, err, reload] = useApi<{ items: Task[] }>('/api/tasks/inbox');
  const [pickFor, setPickFor] = useState<Record<string, { who: string; need: string; due: string; note: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const val = (id: string) => pickFor[id] ?? { who: '', need: '1', due: '', note: '' };
  const set = (id: string, k: 'who' | 'need' | 'due' | 'note', v: string) => setPickFor((x) => ({ ...x, [id]: { ...val(id), [k]: v } }));
  const decide = async (t: Task, accept: boolean) => {
    const v = val(t.id); setMsg(null);
    try {
      await post(`/api/tasks/${tid(t)}/decide`, accept ? { accept, assignedTo: v.who || null, photosRequired: Number(v.need) || 0, dueDate: v.due || null, note: v.note.trim() || undefined } : { accept, note: v.note.trim() });
      toast(accept ? 'Taken in. It is on the board now.' : 'Turned down.'); reload(); onChanged();
    } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <Modal title="Requests" onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>{manager ? 'Requests the team raised. Take one in to put it on the board, or turn it down with a reason.' : 'Your requests waiting for a manager.'}</p>
      {err && <p className="err">{err}</p>}
      {msg && <div className="err" role="alert">{msg}</div>}
      {d && !d.items.length && <p className="hint">No requests waiting.</p>}
      {d?.items.map((t) => (
        <div key={t.id} className="card tinbox">
          <b>{t.title}</b>
          <div className="muted small">From {t.intake?.byName ?? 'the team'} · {fmtDateTime(t.createdAt)}{t.projectName ? ` · ${t.projectName}` : ''}{t.references.length ? ` · ${t.references.length} reference${t.references.length === 1 ? '' : 's'}` : ''}</div>
          {t.details && <p>{t.details}</p>}
          <References t={t} manager={manager} meId={meId} onChanged={() => { reload(); onChanged(); }} setErr={setMsg} />
          {manager && (
            <div className="form-grid" style={{ marginTop: 8 }}>
              <Field label="For"><Select value={val(t.id).who} onChange={(v) => set(t.id, 'who', v)} options={[['', 'Anyone on the team'], ...team.map((m) => [m.id, m.name] as [string, string])]} /></Field>
              <Field label="Photos needed"><input className="inp" type="number" min={0} max={10} value={val(t.id).need} onChange={(e) => set(t.id, 'need', e.target.value)} /></Field>
              <Field label="Due day"><DateInput className="inp" value={val(t.id).due} onChange={(e: any) => set(t.id, 'due', e.target.value)} /></Field>
              <Field label="Note (needed to turn it down)"><input className="inp" maxLength={300} value={val(t.id).note} onChange={(e) => set(t.id, 'note', e.target.value)} /></Field>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary sm" onClick={() => decide(t, true)}>Take in</button>
                <button className="btn ghost sm danger" onClick={() => decide(t, false)}>Turn down</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}

/** Anyone on the team raises a request. A manager decides what happens to it. */
export function RaiseDialog({ projects, onClose, onChanged }: { projects: Project[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', details: '', proj: '', pri: 'medium' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const key = useRef('req-' + Math.random().toString(36).slice(2));
  const send = async () => {
    setErr(null); setBusy(true);
    try { await post('/api/tasks/requests', { title: f.title.trim(), details: f.details.trim() || undefined, projectId: f.proj || null, priority: f.pri, clientKey: key.current }); toast('Request sent. A manager will take it from here.'); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Raise a request" onClose={onClose} foot={<button className="btn primary" disabled={busy} onClick={send}>Send request</button>}>
      <div className="form-grid">
        <Field label="What is needed" full required><input className="inp" maxLength={120} placeholder="e.g. Fix the nets at lane 2" value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} /></Field>
        <Field label="Details" full><textarea className="inp" rows={3} maxLength={1000} value={f.details} onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))} /></Field>
        <Field label="Project"><Select value={f.proj} onChange={(v) => setF((x) => ({ ...x, proj: v }))} options={[['', 'No project'], ...projects.filter((p) => p.status === 'active').map((p) => [p.id, p.name] as [string, string])]} /></Field>
        <Field label="How urgent"><Select value={f.pri} onChange={(v) => setF((x) => ({ ...x, pri: v }))} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']]} /></Field>
      </div>
      <p className="hint">Once it is sent, you can add pictures or a quote to it as references from Requests.</p>
      {err && <div className="err" role="alert">{err}</div>}
    </Modal>
  );
}

interface SiteReport {
  date: string; projectName: string | null;
  notes: { id: string; authorName: string | null; workers: number | null; body: string; issues: string | null; updatedAt: number; mine: boolean }[];
  done: { id: string; title: string; byName: string | null; proofPhotos: number; signedOff: boolean }[];
  started: { id: string; title: string }[]; raised: { id: string; title: string; byName: string | null }[]; overdue: { id: string; title: string; dueDate: string }[];
  proofPhotos: number; references: number;
}

/**
 * The day on a site, from the jobs themselves, plus each person's note: how many worked, what was done, any problems.
 * Opened from a construction project (`fixed`), it starts on that project and day and the project cannot be switched, so a note lands where it was written from.
 */
export function SiteReportDialog({ projects, onClose, fixed }: { projects: Project[]; onClose: () => void; fixed?: { projectId: string; projectName: string; date: string } }) {
  const toast = useToast();
  const [date, setDate] = useState(fixed?.date ?? today()); const [proj, setProj] = useState(fixed?.projectId ?? '');
  const [r, err, reload] = useApi<SiteReport>(`/api/site-reports?date=${date}${proj ? `&projectId=${encodeURIComponent(proj)}` : ''}`, [date, proj]);
  const mine = r?.notes.find((n) => n.mine);
  const [f, setF] = useState({ workers: '', body: '', issues: '' });
  useEffect(() => { setF({ workers: mine?.workers != null ? String(mine.workers) : '', body: mine?.body ?? '', issues: mine?.issues ?? '' }); }, [r?.date, r?.projectName, mine?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try { await post('/api/site-reports', { date, projectId: proj || null, workers: f.workers === '' ? undefined : Number(f.workers), body: f.body.trim(), issues: f.issues.trim() || undefined }); toast('Site note saved.'); reload(); } catch (e) { setMsg(errMsg(e)); }
  };
  const list = (label: string, items: string[]) => items.length ? <><div className="eyebrow" style={{ margin: '14px 0 6px' }}>{label} ({items.length})</div><ul className="tlist">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null;
  return (
    <Modal title="Daily site report" onClose={onClose} wide>
      <div className="row" style={{ gap: 8 }}>
        <DateInput className="inp" style={{ width: 170 }} aria-label="Day" value={date} max={today()} onChange={(e: any) => setDate(e.target.value || today())} />
        {fixed ? <Chip>{fixed.projectName}</Chip> : (
          <select className="inp" style={{ width: 220 }} aria-label="Site" value={proj} onChange={(e) => setProj(e.target.value)}>
            <option value="">Whole business</option>{projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {r && (
        <>
          <p className="hint">{r.done.length} finished · {r.started.length} started · {r.overdue.length} overdue · {r.proofPhotos} proof photo{r.proofPhotos === 1 ? '' : 's'} · {r.references} reference{r.references === 1 ? '' : 's'} (not proof)</p>
          {list('Finished', r.done.map((d) => `${d.title}${d.byName ? ` (${d.byName})` : ''} · ${d.proofPhotos} proof photo${d.proofPhotos === 1 ? '' : 's'}${d.signedOff ? ' · signed off' : ''}`))}
          {list('Started', r.started.map((d) => d.title))}
          {list('Requests raised', r.raised.map((d) => `${d.title}${d.byName ? ` (${d.byName})` : ''}`))}
          {list('Overdue', r.overdue.map((d) => d.title))}
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Notes from the site</div>
          {!r.notes.length && <p className="hint">No notes yet for this day.</p>}
          {r.notes.map((n) => <div key={n.id} className="kc"><b>{n.authorName ?? 'Team member'}</b><span className="muted small"> · {fmtDateTime(n.updatedAt)}{n.workers != null ? ` · ${n.workers} working` : ''}</span><p>{n.body}</p>{n.issues && <p className="muted">Problems: {n.issues}</p>}</div>)}
          <div className="divider" style={{ margin: '16px 0 12px' }} />
          <div className="form-grid">
            <Field label="People working"><input className="inp" type="number" min={0} max={1000} value={f.workers} onChange={(e) => setF((x) => ({ ...x, workers: e.target.value }))} /></Field>
            <Field label="What was done" full required><textarea className="inp" rows={3} maxLength={2000} value={f.body} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} /></Field>
            <Field label="Problems" full><textarea className="inp" rows={2} maxLength={1000} value={f.issues} onChange={(e) => setF((x) => ({ ...x, issues: e.target.value }))} /></Field>
          </div>
          {msg && <div className="err" role="alert">{msg}</div>}
          <button className="btn primary" style={{ marginTop: 10 }} onClick={save}>{mine ? 'Update my note' : 'Save my note'}</button>
        </>
      )}
    </Modal>
  );
}
