// Projects group tasks; milestones show how far a project has got.
import { useState } from 'react';
import { Modal, useToast, DateInput } from '../../ui';
import { fmtDate, patch, post } from '../../lib';
import { errMsg } from './common';
import type { Project } from './taskTypes';

export default function ProjectsDialog({ projects, onClose, onChanged }: { projects: Project[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const [name, setName] = useState('');
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged(); } catch (e) { toast(errMsg(e)); } };
  return (
    <Modal title="Projects and milestones" onClose={onClose} wide>
      <div className="stack">
        {!projects.length && <p className="hint">No projects yet. A project groups tasks, and its milestones show how far it has got.</p>}
        {projects.map((p) => <ProjectBox key={p.id} p={p} run={run} />)}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="inp" maxLength={80} placeholder="New project, e.g. Floodlight upgrade" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary sm" onClick={() => run(async () => { await post('/api/projects', { name: name.trim() }); setName(''); })}>Add project</button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectBox({ p, run }: { p: Project; run: (fn: () => Promise<unknown>) => void }) {
  const [title, setTitle] = useState(''); const [due, setDue] = useState('');
  const pct = p.tasks ? Math.round((p.tasksDone / p.tasks) * 100) : 0;
  return (
    <div className="card card-pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><b>{p.name}</b><div className="muted small">{p.tasksDone} of {p.tasks} tasks done{p.status === 'archived' ? ' · archived' : ''}</div></div>
        <button className="btn ghost sm" onClick={() => run(() => patch(`/api/projects/${encodeURIComponent(p.id)}`, { status: p.status === 'active' ? 'archived' : 'active' }))}>{p.status === 'active' ? 'Archive' : 'Restore'}</button>
      </div>
      <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: pct + '%' }} /></div>
      {p.milestones.map((m) => (
        <div className="kms" key={m.id}>
          <label className="check"><input type="checkbox" checked={m.done} onChange={(e) => run(() => patch(`/api/milestones/${encodeURIComponent(m.id)}`, { done: e.target.checked }))} /> <span className={m.done ? 'muted' : ''}>{m.title}</span></label>
          <span className={'small ' + (m.overdue ? 'bad-t' : 'muted')}>{m.tasksDone}/{m.tasks} tasks{m.dueDate ? ` · ${m.overdue ? 'overdue ' : 'due '}${fmtDate(m.dueDate)}` : ''}</span>
        </div>
      ))}
      <div className="row kmadd">
        <input className="inp" maxLength={100} placeholder="New milestone, e.g. Poles installed" value={title} onChange={(e) => setTitle(e.target.value)} />
        <DateInput className="inp" aria-label="Milestone due day" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn sm" onClick={() => run(async () => { await post(`/api/projects/${encodeURIComponent(p.id)}/milestones`, { title: title.trim(), dueDate: due || undefined }); setTitle(''); setDue(''); })}>Add milestone</button>
      </div>
    </div>
  );
}
