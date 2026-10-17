import { useState } from 'react';
import { PageHead, Stat, Chip, Field, Modal, Loading, ErrorBox, Empty, useToast } from '../ui';
import { useApi, post, patch, formatPhone } from '../lib';
import { errText } from '../parts/admin/common';

interface Member { id: string; name: string; email: string | null; phone: string | null; active: boolean; permissions: string[] }
interface TeamData { items: Member[]; allPermissions: string[]; presets: Record<string, { title: string; permissions: string[] }> }
const words = (p: string) => (p === 'view_revenue' ? 'Can see revenue' : p.replace(/_/g, ' '));

function AddMember({ presets, onClose, onDone }: { presets: TeamData['presets']; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', preset: Object.keys(presets)[0] || '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function add() {
    setErr(null); setBusy(true);
    try { await post('/api/staff/team', { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, password: f.password, preset: f.preset || undefined }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title="Add to team" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add to team'}</button></>}>
      <div className="form-grid">
        <Field label="Name" full><input className="inp" maxLength={80} placeholder="Full name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input className="inp" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mobile number"><input className="inp" type="tel" placeholder="10 digit mobile number" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Role"><select className="inp" value={f.preset} onChange={set('preset')}>{Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.title}</option>)}</select></Field>
        <Field label="First password"><input className="inp" autoComplete="off" value={f.password} onChange={set('password')} /></Field>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>They can sign in with their email or mobile number.</div>
      <div style={{ marginTop: 10 }}><ErrorBox msg={err} /></div>
    </Modal>
  );
}

function Rights({ m, all, onClose, onSaved }: { m: Member; all: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<string[]>(m.permissions || []);
  const [busy, setBusy] = useState(false);
  const flip = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  async function save() {
    setBusy(true);
    try { await patch(`/api/staff/team/${encodeURIComponent(m.id)}`, { permissions: sel }); toast('Saved'); onSaved(); } catch (e) { toast(errText(e)); setBusy(false); }
  }
  return (
    <Modal title={`Rights for ${m.name}`} onClose={onClose} wide foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save rights</button></>}>
      <div className="perm-grid">{all.map((p) => <label key={p} className="check"><input type="checkbox" checked={sel.includes(p)} onChange={() => flip(p)} /><span>{words(p)}</span></label>)}</div>
    </Modal>
  );
}

export default function Team({ sub }: { sub: string }) {
  void sub;
  const toast = useToast();
  const [data, error, reload] = useApi<TeamData>('/api/staff/team');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  async function toggle(m: Member) {
    try { await patch(`/api/staff/team/${encodeURIComponent(m.id)}`, { active: !m.active }); toast('Saved'); reload(); } catch (e) { toast(errText(e)); }
  }
  const items = data?.items || [];
  return (
    <div className="stack">
      <PageHead eyebrow="Administration" title="Users & Access" lede="An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports. Prices, the books, promo codes, the team and settings stay with you.">
        <button className="btn primary" disabled={!data} onClick={() => setAdding(true)}>Add to team</button>
      </PageHead>
      {error && <ErrorBox msg={error} />}
      {!data && !error && <Loading />}
      {data && <>
        <div className="grid g3">
          <Stat label="Team members" value={items.length} />
          <Stat label="Can sign in" value={items.filter((m) => m.active).length} />
          <Stat label="Switched off" value={items.filter((m) => !m.active).length} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Your team</h3></div>
          {!items.length ? <Empty>No one on your team yet.</Empty> : (
            <div className="card-pad">
              {items.map((m) => (
                <div className="ad-line" key={m.id}>
                  <div>
                    <b>{m.name}</b> <Chip tone={m.active ? 'good' : 'mute'}>{m.active ? 'Active' : 'Switched off'}</Chip>
                    <div className="small muted">{[m.email, m.phone && formatPhone(m.phone)].filter(Boolean).join('  ·  ')}</div>
                    <div className="hint">{(m.permissions || []).length} permissions</div>
                  </div>
                  <div className="acts">
                    <button className="btn sm ghost" onClick={() => setEditing(m)}>Rights</button>
                    <button className="btn sm ghost" onClick={() => toggle(m)}>{m.active ? 'Switch off' : 'Switch on'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}
      {adding && data && <AddMember presets={data.presets} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast('Added. They can sign in with their email or mobile number.'); reload(); }} />}
      {editing && data && <Rights m={editing} all={data.allPermissions} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}
