// The tournaments still to come, from both places a tournament can be on the books: a tournament set up on the Tournaments page, and a booking made
// on a tournament price ("Saturday tournament", "Two-day tournament (Sat + Sun)") by a customer or at the desk, which has no tournament record of its own.
import type { ReactNode } from 'react';
import { can, fmtDate, fmtDay, go, todayISO, useApi } from '../../lib';
import { useSession } from '../../App';
import { Chip, Status } from '../../ui';
import { timeRange, type Booking, type Page } from '../dash/common';
import { API, STATUS, type Tournament } from './shared';

interface Row { key: string; from: string; to: string; title: string; sub: string; status: ReactNode; open: () => void }

export function UpcomingTournaments({ limit = 50, version = 0 }: { limit?: number; version?: number }) {
  const { me, ownerId } = useSession();
  const seesBookings = can(me, 'manage_bookings'), seesTournaments = can(me, 'manage_matches');
  const [bks, bErr, , bStatus] = useApi<Page<Booking>>(seesBookings ? `/api/staff/bookings?kind=tournament&upcoming=1&group=1&limit=${limit}` : null, [version, ownerId]);
  const [ts, tErr, , tStatus] = useApi<{ items: Tournament[] }>(seesTournaments ? API : null, [version, ownerId]);
  const today = todayISO();
  // a booking that belongs to a tournament record is shown once, as the tournament
  const linked = new Set((ts?.items ?? []).map((t) => t.booking?.seriesId).filter(Boolean));
  const rows: Row[] = [
    ...(ts?.items ?? []).filter((t) => t.endDate >= today && t.status !== 'cancelled' && t.status !== 'completed').map((t): Row => ({
      key: 't' + t.id, from: t.startDate, to: t.endDate, title: t.name, sub: t.booking?.groundName ? `${t.booking.groundName} · ${t.teamCount} teams` : `${t.teamCount} teams`,
      status: <Status s={t.status} map={STATUS} />, open: () => go('/tournaments/' + t.id) })),
    ...(bks?.items ?? []).filter((b) => !(b.block?.seriesId && linked.has(b.block.seriesId))).map((b): Row => ({
      key: 'b' + b.id, from: b.block?.fromDate ?? b.date, to: b.block?.toDate ?? b.date, title: b.formatLabel || 'Tournament booking',
      sub: `${b.customerName} · ${b.groundName} · ${timeRange(b)}`, status: <Chip tone={b.status === 'held' ? 'warn' : 'info'}>{b.status === 'held' ? 'Held, not paid' : 'Booked'}</Chip>, open: () => go('/bookings/' + b.id) })),
  ].sort((a, b) => a.from.localeCompare(b.from));
  const refused = (e: string | null, s: number | null) => !!e && s === 403;
  const err = [bErr && !refused(bErr, bStatus) ? bErr : null, tErr && !refused(tErr, tStatus) ? tErr : null].filter(Boolean).join(' · ');
  if (!seesBookings && !seesTournaments) return null;
  if (err) return <p className="xempty err" role="alert">Upcoming tournaments could not be loaded: {err}</p>;
  if ((seesBookings && !bks && !bErr) || (seesTournaments && !ts && !tErr)) return <p className="xempty" data-state="loading">Loading tournaments…</p>;
  if (!rows.length) return <p className="xempty" data-state="empty">No tournaments booked ahead.</p>;
  return (
    <div className="tbl-wrap"><table className="xtbl" data-state="ready">
      <thead><tr><th>When</th><th>Tournament</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key} className="click" onClick={r.open}>
          <td className="tabular">{r.from === r.to ? fmtDay(r.from) : `${fmtDay(r.from)} – ${fmtDate(r.to)}`}</td>
          <td><b>{r.title}</b><div className="small muted">{r.sub}</div></td>
          <td>{r.status}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
