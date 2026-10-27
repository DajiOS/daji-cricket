// One day at the ground: every session, grouped by ground, in time order.
import { useState, type CSSProperties } from 'react';
import { Loading, ErrorBox, Empty, DateInput } from '../../ui';
import { useApi, fmtDay, todayISO, addDaysISO, inr } from '../../lib';
import { type Booking, type Page, BookingChip, timeRange, whatOf } from './common';
import { BookingDetail } from './Detail';
import { DayTimeline, groundColor, ViewToggle, useView } from './BookingCalendar';

export function DayView({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [view, setView] = useView();
  const [open, setOpen] = useState<string | null>(null);
  const [d, err] = useApi<Page<Booking>>(`/api/staff/bookings?from=${date}&to=${date}&limit=200`, [version]);
  const live = (d?.items || []).filter((b) => b.status !== 'cancelled' && b.status !== 'expired').sort((a, b) => a.startAt - b.startAt);
  const grounds = [...new Set(live.map((b) => b.groundName))];
  return (
    <div className="stack">
      <div className="row">
        <button className="btn sm" onClick={() => setDate(addDaysISO(date, -1))} aria-label="Previous day">←</button>
        <DateInput className="inp" style={{ width: 170 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        <button className="btn sm" onClick={() => setDate(addDaysISO(date, 1))} aria-label="Next day">→</button>
        {date !== todayISO() && <button className="btn ghost sm" onClick={() => setDate(todayISO())}>Today</button>}
        <b className="gold" style={{ marginLeft: 6 }}>{fmtDay(date)}</b>
        {new Date().getTimezoneOffset() !== -330 && <span className="muted small">India time</span>}
        {d && <span className="muted small">{live.length} {live.length === 1 ? 'session' : 'sessions'}</span>}
        <span style={{ marginLeft: 'auto' }}><ViewToggle value={view} onChange={setView} /></span>
      </div>
      {err ? <ErrorBox msg={err} /> : !d ? <Loading h={200} /> : !live.length ? <div className="card"><Empty>No sessions on this day.</Empty></div> : view === 'calendar' ? <DayTimeline bookings={live} onOpen={setOpen} /> : (
        <div className="grid g2">
          {grounds.map((g) => (
            <div className="card" key={g}>
              <div className="card-head"><h3>{g}</h3><span className="muted small">{live.filter((b) => b.groundName === g).length} sessions</span></div>
              <div className="day-list">
                {live.filter((b) => b.groundName === g).map((b) => (
                  <button key={b.id} className="day-row" style={{ ['--c' as string]: groundColor(b.groundName) } as CSSProperties} onClick={() => setOpen(b.id)}>
                    <span className="day-time tabular"><i className="cal-dot" />{timeRange(b)}</span>
                    <span className="day-who"><b>{b.customerName}</b><span className="small muted">{whatOf(b)}{b.balancePaise > 0 && b.status === 'confirmed' ? ` · ${inr(b.balancePaise)} to collect` : ''}</span></span>
                    <BookingChip b={b} />
                  </button>))}
              </div>
            </div>))}
        </div>)}
      {open && <BookingDetail id={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}
