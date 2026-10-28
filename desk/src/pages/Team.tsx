import { useState } from 'react';
import { PageHead, Stat, Chip, Field, Modal, Loading, ErrorBox, Empty, Filters, NameField, NameFields, useToast } from '../ui';
import { useApi, post, patch, formatPhone } from '../lib';
import { errText } from '../parts/admin/common';

interface Member { id: string; name: string; firstName?: string; lastName?: string; email: string | null; phone: string | null; active: boolean; readOnly?: boolean; mfa?: boolean; permissions: string[] }
interface TeamData { items: Member[]; allPermissions: string[]; presets: Record<string, { title: string; permissions: string[] }> }
/** The role a member's rights add up to: a preset's title when they match it exactly, otherwise Custom. */
const roleOf = (m: Member, presets: TeamData['presets']): string => {
  const mine = [...(m.permissions || [])].sort().join(',');
  const hit = Object.values(presets).find((p) => [...p.permissions].sort().join(',') === mine);
  return hit ? hit.title : 'Custom rights';
};
const words = (p: string) => (p === 'view_revenue' ? 'Can see revenue' : p === 'view_cameras' ? 'Can watch live cameras' : p.replace(/_/g, ' '));

function AddMember({ presets, onClose, onDone }: { presets: TeamData['presets']; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', preset: Object.keys(presets)[0] || '', readOnly: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function add() {
    setErr(null); setBusy(true);
    try { await post('/api/staff/team', { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, password: f.password, preset: f.preset || undefined, ...(f.readOnly ? { readOnly: true } : {}) }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title="Add to team" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add to team'}</button></>}>
      <div className="form-grid">
        <NameField value={f.name} onChange={(n) => setF((s) => ({ ...s, name: n }))} required />
        <Field label="Email" required><input className="inp" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mobile number"><input className="inp" type="tel" placeholder="10 digit mobile number" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Role"><select className="inp" value={f.preset} onChange={set('preset')}>{Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.title}</option>)}</select></Field>
        <Field label="First password" required hint="At least 8 characters with a capital letter, a small letter and a number."><input className="inp" autoComplete="off" value={f.password} onChange={set('password')} /></Field>
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={f.readOnly} onChange={(e) => setF((s) => ({ ...s, readOnly: e.target.checked }))} /><span>Read only: they can look at everything their role opens, but cannot change anything</span></label>
      <div className="hint" style={{ marginTop: 10 }}>They can sign in with their email or mobile number.</div>
      <div style={{ marginTop: 10 }}><ErrorBox msg={err} /></div>
    </Modal>
  );
}

/** Edit a member: name, email, mobile, Read only, and a new password (which ends every sign-in made with the old one). */
function EditMember({ m, onClose, onSaved }: { m: Member; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ first: m.firstName ?? '', last: m.lastName ?? '', email: m.email ?? '', phone: m.phone ?? '', readOnly: !!m.readOnly, password: '', resetMfa: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'email' | 'phone' | 'password') => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    if (!f.first.trim() || !f.email.trim()) { setErr(!f.first.trim() ? 'Type their first name.' : 'Type their email address.'); return; }
    setErr(null); setBusy(true);
    const body: Record<string, unknown> = {};
    if (f.first.trim() !== (m.firstName ?? '') || f.last.trim() !== (m.lastName ?? '')) { body.firstName = f.first.trim(); body.lastName = f.last.trim(); }
    if (f.email.trim() !== (m.email ?? '')) body.email = f.email.trim();
    if (f.phone.trim() && f.phone.trim() !== (m.phone ?? '')) body.phone = f.phone.trim();
    if (f.readOnly !== !!m.readOnly) body.readOnly = f.readOnly;
    if (f.password) body.password = f.password;
    if (f.resetMfa) body.resetMfa = true;
    if (!Object.keys(body).length) { onClose(); return; }
    try { await patch(`/api/staff/team/${encodeURIComponent(m.id)}`, body); onSaved(f.password || f.resetMfa ? 'Saved. Their old sign-ins have ended: they sign in again.' : 'Saved'); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title={`Edit ${m.name || m.email || 'team member'}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <NameFields first={f.first} last={f.last} onFirst={(v) => setF((s) => ({ ...s, first: v }))} onLast={(v) => setF((s) => ({ ...s, last: v }))} required />
        <Field label="Email" required><input className="inp" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mobile number"><input className="inp" type="tel" placeholder="10 digit mobile number" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Set a new password" hint="Leave empty to keep their password. A new one signs them out everywhere."><input className="inp" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={f.readOnly} onChange={(e) => setF((s) => ({ ...s, readOnly: e.target.checked }))} /><span>Read only: they can look at everything their role opens, but cannot change anything</span></label>
      {m.mfa && <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={f.resetMfa} onChange={(e) => setF((s) => ({ ...s, resetMfa: e.target.checked }))} /><span>Reset two-step sign-in (they lost their phone): they sign in with just the password and can set it up again</span></label>}
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
  const [editingInfo, setEditingInfo] = useState<Member | null>(null);
  async function toggle(m: Member) {
    try { await patch(`/api/staff/team/${encodeURIComponent(m.id)}`, { active: !m.active }); toast('Saved'); reload(); } catch (e) { toast(errText(e)); }
  }
  const [q, setQ] = useState(''), [st, setSt] = useState(''), [rl, setRl] = useState('');
  const all = data?.items || [];
  const roles = data ? [...new Set(all.map((m) => roleOf(m, data.presets)))] : [];
  const items = all.filter((m) => (!st || (st === 'on') === m.active) && (!rl || roleOf(m, data!.presets) === rl)
    && (!q.trim() || [m.name, m.email, m.phone].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="stack">
      <PageHead eyebrow="Administration" title="Users & Access" lede="An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports. Prices, the books, promo codes, the team and settings stay with you.">
        <button className="btn primary" disabled={!data} onClick={() => setAdding(true)}>Add to team</button>
      </PageHead>
      {error && <ErrorBox msg={error} />}
      {!data && !error && <Loading />}
      {data && <>
        <div className="grid g3">
          <Stat label="Team members" value={all.length} />
          <Stat label="Can sign in" value={all.filter((m) => m.active).length} />
          <Stat label="Switched off" value={all.filter((m) => !m.active).length} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Your team</h3></div>
          <div className="row" style={{ padding: '10px 16px 0' }}>
            <input className="inp" style={{ flex: '1 1 220px', width: 'auto' }} type="search" placeholder="Search name, email or phone" aria-label="Search the team" value={q} onChange={(e) => setQ(e.target.value)} />
            <Filters active={(st ? 1 : 0) + (rl ? 1 : 0)}>
              <select className="inp" style={{ width: 150 }} aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Any status</option><option value="on">Active</option><option value="off">Switched off</option></select>
              <select className="inp" style={{ width: 170 }} aria-label="Role" value={rl} onChange={(e) => setRl(e.target.value)}><option value="">Any role</option>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </Filters>
          </div>
          {!items.length ? <Empty>{all.length ? 'No one matches.' : 'No one on your team yet.'}</Empty> : (
            <div className="card-pad">
              {items.map((m) => (
                <div className="dl-line" key={m.id}>
                  <div>
                    <b>{m.name || m.email || formatPhone(m.phone) || 'Unnamed member'}</b> <Chip tone={m.active ? 'good' : 'mute'}>{m.active ? 'Active' : 'Switched off'}</Chip> <Chip tone="gold">{roleOf(m, data.presets)}</Chip>{m.readOnly && <> <Chip tone="mute">Read only</Chip></>}{m.mfa && <> <Chip tone="good">2FA on</Chip></>}
                    <div className="small muted">{[m.email, m.phone && formatPhone(m.phone)].filter(Boolean).join('  ·  ')}</div>
                    <div className="hint">{(m.permissions || []).length} permissions</div>
                  </div>
                  <div className="acts">
                    <button className="btn sm ghost" onClick={() => setEditingInfo(m)}>Edit</button>
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
      {editingInfo && <EditMember m={editingInfo} onClose={() => setEditingInfo(null)} onSaved={(msg) => { setEditingInfo(null); toast(msg); reload(); }} />}
      {editing && data && <Rights m={editing} all={data.allPermissions} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}
