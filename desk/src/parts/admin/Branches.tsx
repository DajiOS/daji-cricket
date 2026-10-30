// Settings › Branches and access (areas.ts, Sunny 30 Oct 2026): the branches of this business (Office, House, Personal, Loans), which
// branches each team member sees, people from your other businesses on this team, and whether each business in your portfolio is
// yours or one you support. A restricted branch is seen by nobody but the owner until the owner ticks it for someone.
import { useState } from 'react';
import { del, patch, post, put, useApi } from '../../lib';
import { Chip, ErrorBox, Field, Loading, Modal, useToast } from '../../ui';
import { useSession } from '../../App';
import { Panel, errText } from './common';

interface Area { id: string; name: string; restricted: boolean; archived: boolean }
interface Member { id: string; name: string; permissions: string[] }
interface Added { userId: string; name: string; email: string | null; permissions: string[]; homeBusiness: string }
interface Access { userId: string; all: boolean; areaIds: string[] }
interface PortfolioItem { id: string; businessName: string; own: boolean; relation: 'mine' | 'support' }

const words = (p: string) => (p === 'view_revenue' ? 'Can see revenue' : p === 'view_cameras' ? 'Can watch live cameras' : p.replace(/_/g, ' '));

export default function Branches() {
  const { me, ownerId } = useSession();
  const [areas, aErr, reload] = useApi<{ items: Area[] }>('/api/areas?archived=1', [ownerId]);
  if (aErr) return <ErrorBox msg={aErr} />;
  if (!areas) return <Loading h={160} />;
  return (
    <div className="stack">
      <BranchList items={areas.items} onChanged={reload} />
      <WhoSees areas={areas.items.filter((a) => !a.archived)} />
      {me.role === 'owner' && <FromOtherBusinesses />}
      {me.role === 'owner' && <YourBusinesses />}
    </div>
  );
}

function BranchList({ items, onChanged }: { items: Area[]; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [restricted, setRestricted] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); if (done) toast(done); onChanged(); } catch (e) { toast(errText(e)); } };
  return (
    <Panel title="Branches" note="Parts of this business, such as Office or House. Their books stay in this business; a branch only says which part a project or record belongs to. A restricted branch is seen by you alone until you tick it for someone below.">
      <div className="stack">
        {!items.length && <p className="hint">No branches yet. A business with no branches works exactly as before.</p>}
        {items.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span><b className={a.archived ? 'muted' : ''}>{a.name}</b> {a.restricted && <Chip tone="warn">Restricted</Chip>} {a.archived && <Chip>Archived</Chip>}</span>
            <span className="row">
              {!a.archived && <button className="btn ghost sm" onClick={() => run(() => patch(`/api/areas/${encodeURIComponent(a.id)}`, { restricted: !a.restricted }), a.restricted ? `${a.name} is open to the team` : `${a.name} is restricted`)}>{a.restricted ? 'Open to the team' : 'Restrict'}</button>}
              <button className="btn ghost sm" onClick={() => run(() => patch(`/api/areas/${encodeURIComponent(a.id)}`, { archived: !a.archived }))}>{a.archived ? 'Restore' : 'Archive'}</button>
            </span>
          </div>
        ))}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="inp" maxLength={60} placeholder="New branch, e.g. Office" aria-label="New branch name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="check"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted</label>
          <button className="btn primary sm" disabled={name.trim().length < 2} onClick={() => run(async () => { await post('/api/areas', { name: name.trim(), restricted }); setName(''); setRestricted(false); }, 'Branch added')}>Add branch</button>
        </div>
      </div>
    </Panel>
  );
}

/** Each team member (employed here or added from another business): every open branch, or only the ones ticked. */
function WhoSees({ areas }: { areas: Area[] }) {
  const { me, ownerId } = useSession();
  const [team, tErr] = useApi<{ items: Member[] }>('/api/staff/team', [ownerId]);
  const [added] = useApi<{ items: Added[] }>(me.role === 'owner' ? '/api/staff/team-memberships' : null, [ownerId]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  if (!areas.length) return null;
  if (tErr) return <ErrorBox msg={tErr} />;
  const people = [...(team?.items ?? []).map((m) => ({ id: m.id, name: m.name })), ...(added?.items ?? []).map((m) => ({ id: m.userId, name: m.name }))];
  return (
    <Panel title="Who sees which branch" note="With no limit, a team member sees every branch that is not restricted. Changing this signs them out once, so their screens reload.">
      {!people.length ? <p className="hint">No one on the team yet.</p> : (
        <div className="stack">
          {people.map((p) => <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}><b>{p.name}</b><button className="btn ghost sm" onClick={() => setEditing(p)}>Branches</button></div>)}
        </div>)}
      {editing && <AccessDialog person={editing} areas={areas} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function AccessDialog({ person, areas, onClose }: { person: { id: string; name: string }; areas: Area[]; onClose: () => void }) {
  const toast = useToast();
  const [cur, err] = useApi<Access>(`/api/staff/team/${encodeURIComponent(person.id)}/areas`);
  const [pick, setPick] = useState<string[] | null>(null);
  const [all, setAll] = useState<boolean | null>(null);
  const chosen = pick ?? cur?.areaIds ?? [];
  const isAll = all ?? cur?.all ?? true;
  async function save() {
    try { await put(`/api/staff/team/${encodeURIComponent(person.id)}/areas`, isAll ? { all: true } : { areaIds: chosen }); toast('Saved'); onClose(); } catch (e) { toast(errText(e)); }
  }
  return (
    <Modal title={`Branches for ${person.name}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!cur} onClick={save}>Save</button></>}>
      {err ? <ErrorBox msg={err} /> : !cur ? <Loading h={100} /> : (
        <div className="stack">
          <label className="check"><input type="radio" checked={isAll} onChange={() => setAll(true)} /> Every branch that is not restricted</label>
          <label className="check"><input type="radio" checked={!isAll} onChange={() => setAll(false)} /> Only these branches</label>
          {!isAll && areas.map((a) => (
            <label key={a.id} className="check" style={{ marginLeft: 24 }}>
              <input type="checkbox" checked={chosen.includes(a.id)} onChange={(e) => setPick(e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))} /> {a.name}{a.restricted ? ' (restricted)' : ''}
            </label>))}
        </div>)}
    </Modal>
  );
}

/** People employed by one of your other businesses who also work here, with the rights they have here only. */
function FromOtherBusinesses() {
  const { ownerId } = useSession();
  const toast = useToast();
  const [data, err, reload] = useApi<{ items: Added[] }>('/api/staff/team-memberships', [ownerId]);
  const [team] = useApi<{ allPermissions: string[] }>('/api/staff/team', [ownerId]);
  const [adding, setAdding] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  return (
    <Panel title="Team from your other businesses" note="Someone employed by another business you hold, who also works here. They switch business from the name at the top, and here they only have the rights you give them here." actions={<button className="btn sm" onClick={() => setAdding(true)}>Add a person</button>}>
      {!data ? <Loading h={80} /> : !data.items.length ? <p className="hint">No one from your other businesses works here yet.</p> : (
        <div className="stack">
          {data.items.map((m) => (
            <div key={m.userId} className="row" style={{ justifyContent: 'space-between' }}>
              <span><b>{m.name}</b> <span className="muted small">from {m.homeBusiness} · {m.permissions.length ? m.permissions.map(words).join(', ') : 'no rights yet'}</span></span>
              <button className="btn ghost sm" onClick={async () => { try { await del(`/api/staff/team-memberships/${encodeURIComponent(m.userId)}`); toast(`${m.name} no longer works here`); reload(); } catch (e) { toast(errText(e)); } }}>Remove</button>
            </div>))}
        </div>)}
      {adding && <AddPerson perms={team?.allPermissions ?? []} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </Panel>
  );
}

function AddPerson({ perms, onClose, onDone }: { perms: string[]; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState<string[]>(['manage_tasks']);
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    setMsg(null);
    try { await post('/api/staff/team-memberships', { email: email.trim(), permissions: chosen }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Add a person from your other business" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={add}>Add</button></>}>
      <div className="stack">
        <Field label="Their email (as on their own team)" required><input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div><b className="small">What they can do here</b>
          {perms.map((p) => <label key={p} className="check" style={{ display: 'block' }}><input type="checkbox" checked={chosen.includes(p)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p] : chosen.filter((x) => x !== p))} /> {words(p)}</label>)}
        </div>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

/** Each business in your portfolio is yours, or one you only support (a friend's ground): only yours will count in your combined view. */
function YourBusinesses() {
  const toast = useToast();
  const [data, err, reload] = useApi<{ items: PortfolioItem[] }>('/api/me/portfolio');
  if (err) return <ErrorBox msg={err} />;
  if (!data || data.items.length < 2) return null;
  return (
    <Panel title="Your businesses" note="Mark the businesses that are yours. One you only support, such as a friend's ground, is never added into your combined view. Each business keeps its own books either way.">
      <div className="stack">
        {data.items.map((b) => (
          <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
            <b>{b.businessName}</b>
            {b.own ? <Chip tone="good">Your sign-in's own business</Chip> : (
              <select className="inp" style={{ maxWidth: 200 }} aria-label={`${b.businessName}: yours or supported`} value={b.relation}
                onChange={async (e) => { try { await patch(`/api/me/portfolio/${encodeURIComponent(b.id)}`, { relation: e.target.value }); toast('Saved'); reload(); } catch (x) { toast(errText(x)); } }}>
                <option value="mine">Mine</option><option value="support">One I support</option>
              </select>)}
          </div>))}
      </div>
    </Panel>
  );
}
