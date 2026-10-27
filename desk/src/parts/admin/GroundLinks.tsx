// Which grounds include which: a whole ground and the nets or pitches inside it. Booking one blocks the other for the same time, unless the resource is marked as able to run on its own.
// This is configuration only (nothing infers it); the server applies it everywhere a slot is held, shown or offered. Saved with the "manage_grounds" permission.
import { useState } from 'react';
import { useApi, put } from '../../lib';
import { ErrorBox, useToast } from '../../ui';
import { Panel, errText } from './common';

interface G { id: string; name: string }
interface Link { childId: string; conflicts: boolean }

function Card({ g, all }: { g: G; all: G[] }) {
  const toast = useToast();
  const [d, err] = useApi<{ includes: { childId: string; conflicts: boolean }[] }>(`/api/staff/grounds/${encodeURIComponent(g.id)}/links`);
  const [edit, setEdit] = useState<Link[] | null>(null);
  const [saved, setSaved] = useState<Link[] | null>(null); // what the server last confirmed, so the card shows it without asking again
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return null;
  const rows: Link[] = edit ?? saved ?? d.includes.map((x) => ({ childId: x.childId, conflicts: x.conflicts }));
  const changed = edit !== null;
  const others = all.filter((x) => x.id !== g.id);
  const on = (id: string) => rows.find((r) => r.childId === id);
  const toggle = (id: string) => setEdit(on(id) ? rows.filter((r) => r.childId !== id) : [...rows, { childId: id, conflicts: true }]);
  const setConflicts = (id: string, conflicts: boolean) => setEdit(rows.map((r) => (r.childId === id ? { ...r, conflicts } : r)));
  const save = async () => {
    setMsg(null); setBusy(true);
    try { const r = await put<{ includes: { childId: string; conflicts: boolean }[] }>(`/api/staff/grounds/${encodeURIComponent(g.id)}/links`, { includes: rows.map((x) => ({ groundId: x.childId, conflicts: x.conflicts })) }); setSaved(r.includes.map((x) => ({ childId: x.childId, conflicts: x.conflicts }))); toast(`${g.name}: saved.`); setEdit(null); }
    catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Panel title={g.name} note="What this ground includes">
      <div className="stack ground-links" data-ground={g.id} style={{ gap: 8 }}>
        {!others.length && <div className="muted small">There is no other ground to include.</div>}
        {others.map((o) => { const l = on(o.id); return (
          <div key={o.id} className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" data-include={o.id} checked={!!l} onChange={() => toggle(o.id)} />Includes {o.name}</label>
            {l && <label className="row small" style={{ gap: 6 }}><input type="checkbox" data-blocks={o.id} checked={l.conflicts} onChange={(e) => setConflicts(o.id, e.target.checked)} />Booking either one blocks the other</label>}
          </div>); })}
        <ErrorBox msg={msg} />
        <div className="row"><button className="btn primary sm" data-save-links={g.id} disabled={busy || !changed} onClick={save}>Save</button></div>
      </div>
    </Panel>
  );
}

/** Shown under the prices when the business has more than one ground. */
export default function GroundLinks() {
  const [data] = useApi<{ items: G[] }>('/api/staff/grounds');
  if (!data || data.items.length < 2) return null;
  return (
    <div className="stack" style={{ gap: 12, marginTop: 24 }}>
      <div className="eyebrow">Whole ground and nets</div>
      <div className="hint" style={{ margin: 0 }}>If a whole ground includes its nets or pitches, booking one blocks the other for the same time. Mark a net as able to run on its own by unticking the second box. Customers, staff and Guppi all see the same availability.</div>
      {data.items.map((g) => <Card key={g.id} g={g} all={data.items} />)}
    </div>
  );
}
