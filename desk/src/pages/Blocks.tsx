import { useState } from 'react';
import { PageHead, Field, ErrorBox, Load, DateInput, useToast } from '../ui';
import { useApi, post, can, todayISO } from '../lib';
import { useSession } from '../App';
import { Select } from '../parts/club/common';
import { errText } from '../parts/dash/common';

// Close a ground for part of a day (maintenance, a private event) so nobody can book those slots, or open them again. The server blocks
// only free slots and refuses the whole range if any slot already has a booking, so a block never sits on top of a customer.
export default function Blocks({ sub }: { sub: string }) {
  void sub;
  const { me } = useSession();
  const toast = useToast();
  const [grounds, gErr, gReload, gStatus] = useApi<{ items: { id: string; name: string }[] }>('/api/staff/grounds');
  const [groundId, setGroundId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStart] = useState('06:00');
  const [endTime, setEnd] = useState('08:00');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = groundId || grounds?.items[0]?.id || '';
  const run = async (kind: 'block' | 'unblock') => {
    if (!g) return;
    setBusy(true); setMsg(null);
    try {
      if (kind === 'block') { const r = await post<{ blocked: number }>(`/api/staff/grounds/${encodeURIComponent(g)}/blocks`, { date, startTime, endTime, note: note.trim() || undefined }); toast(r.blocked ? `${r.blocked} slot${r.blocked === 1 ? '' : 's'} closed.` : 'Those slots were already closed.'); }
      else { const r = await post<{ unblocked: number }>(`/api/staff/grounds/${encodeURIComponent(g)}/blocks/remove`, { date, startTime, endTime }); toast(r.unblocked ? `${r.unblocked} slot${r.unblocked === 1 ? '' : 's'} opened again.` : 'Nothing was closed in that time.'); }
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const allowed = can(me, 'manage_grounds');
  return (
    <div className="stack">
      <PageHead eyebrow="Grounds & nets" title="Blocks" lede="Close a ground for part of a day so it cannot be booked, for maintenance or a private event, and open it again. Slots that already have a booking are never closed." />
      {!allowed ? <Load data={null} error="forbidden" status={403}>{() => null}</Load> : (
        <Load data={grounds} error={gErr} status={gStatus} retry={gReload} isEmpty={(x) => !x.items.length} empty="Add a ground first.">{(x) => (
          <div className="card card-pad stack" style={{ maxWidth: 720 }}>
            <div className="form-grid">
              <Field label="Ground"><Select value={g} onChange={setGroundId} options={x.items.map((i) => [i.id, i.name] as [string, string])} label="Ground" /></Field>
              <Field label="Date"><DateInput value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></Field>
              <Field label="From"><input className="inp" type="time" step={1800} value={startTime} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Until"><input className="inp" type="time" step={1800} value={endTime} onChange={(e) => setEnd(e.target.value)} /></Field>
              <Field label="Why (shown to staff)" full><input className="inp" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pitch relaying" /></Field>
            </div>
            <ErrorBox msg={msg} />
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => run('block')}>Close these slots</button>
              <button className="btn" disabled={busy} onClick={() => run('unblock')}>Open them again</button>
              <a className="btn ghost" href="#/resources/availability">See the day</a>
            </div>
          </div>)}</Load>)}
    </div>
  );
}
