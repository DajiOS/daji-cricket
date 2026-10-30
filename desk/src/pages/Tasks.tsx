import { useEffect, useState, type DragEvent } from 'react';
import { PageHead, ErrorBox, Loading, Filters, useToast } from '../ui';
import { api, can, fmtDate, post } from '../lib';
import { useSession } from '../App';
import { errMsg } from '../parts/club/common';
import { COLS, PRI, REPEAT, type Project, type Task } from '../parts/club/taskTypes';
import TaskDialog from '../parts/club/TaskDialog';
import { InboxDialog, RaiseDialog, SiteReportDialog } from '../parts/club/TaskWork';
import ProjectsDialog from '../parts/club/ProjectsDialog';

const initials = (n: string | null) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

export default function Tasks({ sub }: { sub: string }) {
  void sub;
  const { me } = useSession(); const toast = useToast(); const manager = can(me, 'manage_tasks');
  const [tasks, setTasks] = useState<Task[] | null>(null); const [projects, setProjects] = useState<Project[]>([]); const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null); const [projectId, setProjectId] = useState(''); const [who, setWho] = useState(''); const [pri, setPri] = useState(''); const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null); const [projDlg, setProjDlg] = useState(false); const [side, setSide] = useState<'inbox' | 'raise' | 'report' | null>(null); const [inbox, setInbox] = useState(0); const [over, setOver] = useState<string | null>(null);
  const load = async () => {
    try {
      const [t, p] = await Promise.all([api<{ items: Task[] }>('/api/tasks'), api<{ items: Project[] }>('/api/projects').catch(() => ({ items: [] as Project[] }))]);
      setTasks(t.items); setProjects(p.items); setError(null);
      api<{ items: Task[] }>('/api/tasks/inbox').then((r) => setInbox(r.items.length)).catch(() => setInbox(0));
    } catch (e) { setError(errMsg(e)); }
  };
  useEffect(() => { load(); }, []);
  // the business's own staff and the team members added from another business (one list for For and Helpers)
  useEffect(() => { if (manager) api<{ items: { id: string; name: string }[] }>('/api/tasks/people').then((r) => setTeam(r.items)).catch(() => setTeam([])); }, [manager]);

  const move = async (id: string, stage: string, index: number) => {
    try { await post(`/api/tasks/${encodeURIComponent(id)}/move`, { stage, index }); } catch (e) { toast(errMsg(e)); }
    load();
  };
  const drop = (e: DragEvent<HTMLElement>, stage: string) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData('text/plain'); if (!id) return;
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.kcard')].filter((c) => c.dataset.id !== id);
    let index = cards.length;
    for (let k = 0; k < cards.length; k++) { const r = cards[k]!.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { index = k; break; } }
    move(id, stage, index);
  };

  const visible = (tasks ?? []).filter((t) => t.status !== 'cancelled' && (!projectId || t.projectId === projectId) && (!who || (who === 'none' ? !t.assignedTo : t.assignedTo === who)) && (!pri || t.priority === pri) && (!q || (t.title + ' ' + (t.details || '') + ' ' + (t.assignedName || '')).toLowerCase().includes(q.trim().toLowerCase())));
  const current = open && open !== 'new' ? (tasks ?? []).find((t) => t.id === open) ?? null : null;
  return (
    <div className="stack">
      <PageHead eyebrow="Work" title="Tasks" lede="Drag a card between columns. A card can only be closed (Done) once its camera photos are in, so work is proven on the spot. Reference pictures and files explain a job; they are never proof.">
        <button className="btn" onClick={() => setSide('inbox')}>Requests{inbox ? ` (${inbox})` : ''}</button>
        <button className="btn" onClick={() => setSide('raise')}>Raise a request</button>
        <button className="btn" onClick={() => setSide('report')}>Site report</button>
        {manager && <button className="btn" onClick={() => setProjDlg(true)}>Projects and milestones</button>}
        {manager && <button className="btn primary" onClick={() => setOpen('new')}>New task</button>}
      </PageHead>
      <div className="row">
        <select className="inp kproj-sel" aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>{projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="inp ksearch" type="search" placeholder="Search tasks" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        <Filters active={(who ? 1 : 0) + (pri ? 1 : 0)}>
          <select className="inp" style={{ width: 170 }} aria-label="Assigned to" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option><option value="none">Open to the whole team</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <select className="inp" style={{ width: 140 }} aria-label="Priority" value={pri} onChange={(e) => setPri(e.target.value)}><option value="">Any priority</option>{Object.entries(PRI).reverse().map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Filters>
        <span className="muted small">{(tasks ?? []).filter((t) => t.status === 'open').length} open</span>
      </div>
      <ErrorBox msg={error} />
      {!tasks && !error && <Loading />}
      {tasks && (
        <div className="kanban">
          {COLS.map(([stage, label]) => {
            const items = visible.filter((t) => t.stage === stage);
            const shown = stage === 'done' ? items.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 25) : items;
            return (
              <section key={stage} className={'kcol s-' + stage + (over === stage ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={(e) => drop(e, stage)}>
                <header><span>{label}</span><em>{items.length}</em></header>
                <div className="kbody">
                  {shown.length ? shown.map((t) => (
                    <div key={t.id} className={'kcard p-' + t.priority} draggable data-id={t.id} tabIndex={0} role="button" aria-label={t.title}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => setOpen(t.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(t.id)}>
                      <div className="ktop"><span className="kpri">{PRI[t.priority]}</span>{t.projectName && <span className="kproj">{t.projectName}</span>}</div>
                      <b className="ktitle">{t.title}</b>
                      {t.milestoneTitle && <div className="kmile">Milestone: {t.milestoneTitle}</div>}
                      {t.nextAction && t.status === 'open' && <div className="knext">Next: {t.nextAction}</div>}
                      <div className="kmeta">
                        <span className={t.overdue ? 'kdue bad' : 'kdue'}>{t.stage === 'done' ? 'Done' : t.dueDate ? (t.overdue ? 'Overdue · ' : 'Due ') + fmtDate(t.dueDate) : 'No due day'}</span>
                        {t.repeat && <span title={REPEAT[t.repeat]}>{REPEAT[t.repeat]}</span>}
                        {t.checklist.length > 0 && <span title="Checklist">Steps {t.checklist.filter((c) => c.done).length}/{t.checklist.length}</span>}
                        {t.photosRequired > 0 && <span title="Photos">Photos {t.photos.length}/{t.photosRequired}</span>}
                        {t.references.length > 0 && <span title="References (not proof)">{t.references.length} ref{t.references.length === 1 ? '' : 's'}</span>}
                        {t.commentCount > 0 && <span title="Comments">{t.commentCount} comments</span>}
                        {t.status === 'done' && <span title={t.signedOffAt ? 'Signed off' : 'Waiting for sign-off'}>{t.signedOffAt ? 'Signed off' : 'Not signed off'}</span>}
                        {t.helpers.length > 0 && <span title={'Helpers: ' + t.helpers.map((h) => h.name).join(', ')}>+{t.helpers.length}</span>}
                        <span className="kwho" title={t.assignedName || 'Open to the whole team'}>{t.assignedName ? initials(t.assignedName) : '·'}</span>
                      </div>
                    </div>)) : <div className="kempty">{stage === 'todo' ? 'Nothing waiting.' : 'Drop a card here.'}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {open && (open === 'new' || current) && <TaskDialog key={open} task={current} projects={projects} team={team} manager={manager} meId={me.id} defaultProject={projectId} onClose={() => setOpen(null)} onChanged={load} />}
      {side === 'inbox' && <InboxDialog team={team} manager={manager} onClose={() => setSide(null)} onChanged={load} />}
      {side === 'raise' && <RaiseDialog projects={projects} onClose={() => setSide(null)} onChanged={load} />}
      {side === 'report' && <SiteReportDialog projects={projects} onClose={() => setSide(null)} />}
      {projDlg && <ProjectsDialog projects={projects} onClose={() => setProjDlg(false)} onChanged={load} />}
    </div>
  );
}
