// Find any account and fix its name, phone, email or whether it can sign in.
import { useEffect, useState } from 'react';
import { api, patch, qs } from '../../lib';
import { Chip, Empty, ErrorBox } from '../../ui';
import { Panel, errText } from './common';

const cap = (s: string) => s.replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, c) => a + c.toUpperCase());
const ROLES: [string, string][] = [['', 'Everyone'], ['customer', 'Customers'], ['owner', 'Owners'], ['staff', 'Staff'], ['super_admin', 'Admins']];

function Person({ u0 }: { u0: any }) {
  const [u, setU] = useState(u0);
  const [f, setF] = useState({ firstName: u0.firstName || '', lastName: u0.lastName || '', phone: u0.phone || '', email: u0.email || '', active: !!u0.active });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'firstName' | 'lastName' | 'phone' | 'email') => (e: any) => setF((s) => ({ ...s, [k]: k.endsWith('Name') ? cap(e.target.value) : e.target.value }));
  async function save() {
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = { active: f.active };
    if (f.firstName.trim()) body.firstName = f.firstName.trim();
    if (f.lastName.trim()) body.lastName = f.lastName.trim();
    if (f.phone.trim()) body.phone = f.phone.trim();
    if (f.email.trim() && f.email.trim() !== (u.email || '')) body.email = f.email.trim();
    try { const r = await patch('/api/admin/users/' + encodeURIComponent(u.id), body); setU(r); setF((s) => ({ ...s, firstName: r.firstName, lastName: r.lastName })); setMsg({ ok: true, text: `Saved as ${r.name}.` }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  }
  return (
    <div className="ad-person">
      <div className="row"><b>{u.name}</b><Chip tone="mute">{String(u.role).replace('_', ' ')}</Chip></div>
      <div className="fields">
        <input className="inp" placeholder="First name" aria-label="First name" value={f.firstName} onChange={set('firstName')} />
        <input className="inp" placeholder="Last name" aria-label="Last name" value={f.lastName} onChange={set('lastName')} />
        <input className="inp" placeholder="Mobile" aria-label="Mobile" inputMode="numeric" value={f.phone} onChange={set('phone')} />
        <input className="inp" type="email" placeholder="Email" aria-label="Email" value={f.email} onChange={set('email')} />
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF((s) => ({ ...s, active: e.target.checked }))} /><span>Can sign in</span></label>
        <button className="btn sm" disabled={busy} onClick={save}>Save</button>
        {msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function People() {
  const [q, setQ] = useState(''); const [role, setRole] = useState('');
  const [items, setItems] = useState<any[]>([]); const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  async function load(offset: number) {
    setLoading(true); setError(null);
    try { const r = await api<{ items: any[]; total: number }>('/api/admin/users' + qs({ limit: 25, offset, q: term, role })); setItems((cur) => (offset ? [...cur, ...r.items] : r.items)); setTotal(r.total); }
    catch (e) { setError(errText(e)); }
    setLoading(false);
  }
  useEffect(() => { load(0); }, [term, role]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title="People and accounts" note="Search customers, staff and owners. Names are saved with a capital first letter.">
      <div className="row" style={{ marginBottom: 8 }}>
        <input className="inp" style={{ flex: '1 1 220px', width: 'auto' }} type="search" placeholder="Search name, phone or email" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ width: 150 }} aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <ErrorBox msg={error} />
      {items.map((u) => <Person key={u.id} u0={u} />)}
      {!loading && !error && !items.length && <Empty>No one found.</Empty>}
      {loading && <div className="hint">Loading…</div>}
      {items.length < total && !loading && <button className="btn sm" onClick={() => load(items.length)}>Show more</button>}
    </Panel>
  );
}
