import { useEffect, useRef, useState } from 'react';
import { useSession } from './App';
import { Icon, Modal, Field, useToast } from './ui';
import { api, post, can, go, fmtTime, setViewOwner } from './lib';
import type { TodayData } from './parts/dash/Today';
import { AddGround } from './parts/admin/AddGround';

// The starter kit's property picker, for one ground: the business name opens a list of the grounds and what is on each right now.
// The software owner, and an owner with a portfolio of businesses, also switch business here.
interface Ground { id: string; name: string; ownerId: string; city: string }

// The main website's owner adds another business straight into their own portfolio (Antroli, run by its own owner), with its
// own owner account, kept apart from theirs. Nothing is sent to the new owner. A ground or pitch of the business you are in is
// added with AddGround instead.
function AddBusiness({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const blank = { businessName: '', ownerName: '', phone: '', email: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function add() {
    setBusy(true); setMsg(null);
    try {
      const b = await post<{ id: string; businessName: string }>('/api/me/portfolio', f);
      toast(`${b.businessName} added. Nothing was sent to its owner.`);
      setViewOwner(b.id); location.reload();
    } catch (e: any) { setMsg(e?.message ?? 'Could not add it.'); setBusy(false); }
  }
  return (
    <Modal title="Add a business" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={add}>Add business</button></>}>
      <p className="small muted">A separate business in your portfolio. Its bookings, customers, team and money are kept apart from yours. You switch to it here.</p>
      <div className="form-grid">
        <Field label="Business name" required><input className="inp" value={f.businessName} onChange={set('businessName')} placeholder="Antroli Cricket Ground" /></Field>
        <Field label="Its owner's name" required><input className="inp" autoComplete="off" value={f.ownerName} onChange={set('ownerName')} /></Field>
        <Field label="Its owner's mobile" required><input className="inp" inputMode="tel" autoComplete="off" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Its owner's email" required><input className="inp" type="email" autoComplete="off" value={f.email} onChange={set('email')} /></Field>
      </div>
      {msg && <p className="err-text" role="alert">{msg}</p>}
    </Modal>
  );
}

export function GroundPicker() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [grounds, setGrounds] = useState<Ground[] | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const owner = s.owners.find((o) => o.id === s.ownerId);
  const name = owner?.businessName || s.me.businessName || 'Daji Cricket Ground';
  const bookings = can(s.me, 'manage_bookings');
  const manage = can(s.me, 'manage_grounds');
  const [adding, setAdding] = useState(false);
  const [canAdd, setCanAdd] = useState(false);
  const [addingBiz, setAddingBiz] = useState(false);
  useEffect(() => { if (s.me.role === 'owner') api<{ canAdd?: boolean }>('/api/me/portfolio').then((r) => setCanAdd(!!r.canAdd)).catch(() => setCanAdd(false)); }, [s.me.role]);
  useEffect(() => {
    if (!open) return;
    api<{ items: Ground[] }>('/api/staff/grounds').then((r) => setGrounds(r.items))
      .catch(() => api<{ items: Ground[] }>('/api/grounds').then((r) => setGrounds(r.items.filter((g) => g.ownerId === s.ownerId)))).catch(() => setGrounds([]));
    if (bookings) api<TodayData>('/api/staff/today').then(setToday).catch(() => setToday(null));
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('mousedown', away); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open, bookings, s.ownerId]);

  /** "Playing now until 11:00", "Free, next at 14:00" or "Nothing more today", from today's sessions on that ground. */
  const status = (g: Ground): [string, string] | null => {
    if (!today) return null;
    const t = Date.now();
    const on = today.bookings.filter((b) => b.groundId === g.id && (b.status === 'confirmed' || b.status === 'completed' || b.status === 'held')).sort((a, b) => a.startAt - b.startAt);
    const now = on.find((b) => b.startAt <= t && b.endAt > t);
    if (now) return ['busy', `Playing now · ${now.customerName} until ${fmtTime(now.endAt)}`];
    const next = on.find((b) => b.startAt > t);
    return next ? ['free', `Free · next at ${fmtTime(next.startAt)} (${on.filter((b) => b.startAt > t).length} more today)`] : ['idle', 'Nothing more today'];
  };

  return (
    <div className="gpick hide-sm" ref={box}>
      {addingBiz && <AddBusiness onClose={() => setAddingBiz(false)} />}
      <button className="gpick-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">{name}<Icon name="chevron" size={13} /></button>
      {open && (
        <div className="gpick-menu" role="menu">
          {(s.me.role === 'super_admin' || s.me.role === 'owner' || s.me.role === 'staff') && s.owners.length > 1 && <>
            <div className="nav-group">Business</div>
            {s.owners.map((o) => <button key={o.id} role="menuitemradio" aria-checked={o.id === s.ownerId} className={`gpick-row${o.id === s.ownerId ? ' on' : ''}`} onClick={() => { setOpen(false); s.setOwner(o.id); }}><b>{o.businessName || o.name}</b></button>)}
          </>}
          {s.me.role === 'owner' && s.owners.length > 1 && <button role="menuitem" className="gpick-row" onClick={() => { setOpen(false); go('/combined'); }}><Icon name="pie" size={15} /><b>All my businesses (combined view)</b></button>}
          {canAdd && <button role="menuitem" className="gpick-row" onClick={() => { setOpen(false); setAddingBiz(true); }}><Icon name="plus" size={15} /><b>Add a business</b></button>}
          <div className="nav-group">Grounds</div>
          {!grounds ? <p className="small muted gpick-row">Loading…</p> : grounds.map((g) => {
            const st = status(g);
            return (
              <button key={g.id} role="menuitem" className="gpick-row" onClick={() => { setOpen(false); go(bookings ? '/bookings/day' : '/calendar'); }}>
                <span className={`gpick-dot ${st?.[0] ?? ''}`} aria-hidden="true" />
                <span><b>{g.name}</b>{st && <span className="small muted">{st[1]}</span>}</span>
              </button>);
          })}
          {manage && <button className="gpick-row gpick-foot" onClick={() => { setOpen(false); setAdding(true); }}><Icon name="plus" size={15} />Add a ground or pitch</button>}
          {bookings && <button className="gpick-row gpick-foot" onClick={() => { setOpen(false); go('/booking-report/compare/grounds'); }}><Icon name="pie" size={15} />Compare the grounds</button>}
        </div>)}
      {adding && <AddGround city={grounds?.[0]?.city ?? ''} onAdded={() => setGrounds(null)} onClose={() => setAdding(false)} />}
    </div>
  );
}
