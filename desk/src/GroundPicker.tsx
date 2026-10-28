import { useEffect, useRef, useState } from 'react';
import { useSession } from './App';
import { Icon } from './ui';
import { api, can, go, fmtTime } from './lib';
import type { TodayData } from './parts/dash/Today';

// The starter kit's property picker, for one ground: the business name opens a list of the grounds and what is on each right now.
// The software owner also switches business here, as before.
interface Ground { id: string; name: string; ownerId: string }

export function GroundPicker() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [grounds, setGrounds] = useState<Ground[] | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const owner = s.owners.find((o) => o.id === s.ownerId);
  const name = owner?.businessName || s.me.businessName || 'Daji Cricket Ground';
  const bookings = can(s.me, 'manage_bookings');
  useEffect(() => {
    if (!open) return;
    api<{ items: Ground[] }>('/api/grounds').then((r) => setGrounds(r.items.filter((g) => g.ownerId === s.ownerId))).catch(() => setGrounds([]));
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
      <button className="gpick-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">{name}<Icon name="chevron" size={13} /></button>
      {open && (
        <div className="gpick-menu" role="menu">
          {s.me.role === 'super_admin' && s.owners.length > 1 && <>
            <div className="nav-group">Business</div>
            {s.owners.map((o) => <button key={o.id} role="menuitemradio" aria-checked={o.id === s.ownerId} className={`gpick-row${o.id === s.ownerId ? ' on' : ''}`} onClick={() => { setOpen(false); s.setOwner(o.id); }}><b>{o.businessName || o.name}</b></button>)}
          </>}
          <div className="nav-group">Grounds</div>
          {!grounds ? <p className="small muted gpick-row">Loading…</p> : grounds.map((g) => {
            const st = status(g);
            return (
              <button key={g.id} role="menuitem" className="gpick-row" onClick={() => { setOpen(false); go(bookings ? '/bookings/day' : '/calendar'); }}>
                <span className={`gpick-dot ${st?.[0] ?? ''}`} aria-hidden="true" />
                <span><b>{g.name}</b>{st && <span className="small muted">{st[1]}</span>}</span>
              </button>);
          })}
          {bookings && <button className="gpick-row gpick-foot" onClick={() => { setOpen(false); go('/booking-report/compare/grounds'); }}><Icon name="pie" size={15} />Compare the grounds</button>}
        </div>)}
    </div>
  );
}
