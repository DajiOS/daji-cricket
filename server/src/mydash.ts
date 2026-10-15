import { now } from './clock.ts';
import type { UserRow } from './auth.ts';
import { listBookings } from './bookings.ts';
import { summary as creditSummary } from './credits.ts';
import { istDate } from './time.ts';
import type { Booking } from '@daji/shared';

// The customer's own dashboard: what they have spent at each ground, month by month, and how often they play.
// "Spent" is what actually stayed with the ground. A played session or a no-show counts what was paid; a cancellation
// counts only what was kept (paid less the refund and less the credit given back). Money still held for a session
// that has not been played is shown separately as "paid ahead", not as spent.

export interface MyDashboard {
  spentPaise: number;
  sessions: number;
  slots: number;
  cancelled: number;
  noShows: number;
  paidAheadPaise: number;
  upcoming: number;
  creditPaise: number;
  firstPlayed: string | null;
  byGround: { groundId: string; groundName: string; sessions: number; slots: number; spentPaise: number; lastPlayed: string }[];
  byMonth: { month: string; sessions: number; spentPaise: number }[];
  recent: { id: string; ref: string; groundName: string; date: string; slots: number; status: string; spentPaise: number }[];
}

const played = (b: Booking, t: number): boolean => b.status === 'completed' || (b.status === 'confirmed' && b.endAt <= t);
const kept = (b: Booking): number => (b.status === 'cancelled' ? Math.max(0, b.paidPaise - b.refundPaise - b.creditPaise) : b.paidPaise);

export function myDashboard(user: UserRow): MyDashboard {
  const t = now();
  const all = listBookings({ customerId: user.id, limit: 1000, offset: 0 }).items;
  const d: MyDashboard = { spentPaise: 0, sessions: 0, slots: 0, cancelled: 0, noShows: 0, paidAheadPaise: 0, upcoming: 0, creditPaise: creditSummary(user.id).balancePaise, firstPlayed: null, byGround: [], byMonth: [], recent: [] };
  const g = new Map<string, MyDashboard['byGround'][number]>();
  const m = new Map<string, { sessions: number; spentPaise: number }>();
  for (const b of all) {
    if (b.status === 'held' || b.status === 'expired') continue;
    if (b.status === 'confirmed' && b.endAt > t) { d.upcoming++; d.paidAheadPaise += b.paidPaise; continue; }
    const spent = kept(b);
    const isPlayed = played(b, t);
    if (b.status === 'cancelled') d.cancelled++;
    if (b.status === 'no_show') d.noShows++;
    if (!isPlayed && b.status !== 'no_show' && b.status !== 'cancelled') continue;
    d.spentPaise += spent;
    if (isPlayed) {
      d.sessions++; d.slots += b.slotCount;
      if (!d.firstPlayed || b.date < d.firstPlayed) d.firstPlayed = b.date;
    }
    const e = g.get(b.groundId) ?? { groundId: b.groundId, groundName: b.groundName, sessions: 0, slots: 0, spentPaise: 0, lastPlayed: '' };
    e.spentPaise += spent;
    if (isPlayed) { e.sessions++; e.slots += b.slotCount; if (b.date > e.lastPlayed) e.lastPlayed = b.date; }
    g.set(b.groundId, e);
    const mk = b.date.slice(0, 7);
    const me = m.get(mk) ?? { sessions: 0, spentPaise: 0 };
    me.spentPaise += spent; if (isPlayed) me.sessions++;
    m.set(mk, me);
  }
  d.byGround = [...g.values()].sort((a, b) => b.spentPaise - a.spentPaise);
  // the last 12 months, including months with nothing, oldest first
  const today = istDate(t);
  let y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  const months: string[] = [];
  for (let i = 0; i < 12; i++) { months.unshift(`${y}-${String(mo).padStart(2, '0')}`); mo--; if (mo === 0) { mo = 12; y--; } }
  d.byMonth = months.map((k) => ({ month: k, ...(m.get(k) ?? { sessions: 0, spentPaise: 0 }) }));
  d.recent = all.filter((b) => b.status !== 'held' && b.status !== 'expired' && !(b.status === 'confirmed' && b.endAt > t)).slice(0, 10)
    .map((b) => ({ id: b.id, ref: b.ref, groundName: b.groundName, date: b.date, slots: b.slotCount, status: b.status, spentPaise: kept(b) }));
  return d;
}
