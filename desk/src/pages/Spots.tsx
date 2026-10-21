import { useRef, useState } from 'react';
import { useApi, api, post, fmtDateTime } from '../lib';
import { useSession } from '../App';
import { ErrorBox, Loading, useToast } from '../ui';

// The ground-and-nets status board, in the design's colour columns (as its Rooms board), and the layout page that shows the same spots on a plan of the ground.
type Status = 'ready' | 'attention' | 'out_of_order' | 'maintenance';
interface Spot { id: string; groundId: string | null; name: string; kind: string; status: Status; note: string; x: number; y: number; statusAt: number }
interface Data { items: Spot[]; counts: Record<Status, number> }
const COLS: { key: Status; name: string; sub: string; ink: string; tint: string }[] = [
  { key: 'ready', name: 'Ready', sub: 'Good to play on', ink: 'var(--i-green)', tint: 'var(--t-green)' },
  { key: 'attention', name: 'Needs attention', sub: 'Still playable, but look at it', ink: 'var(--i-amber)', tint: 'var(--t-amber)' },
  { key: 'out_of_order', name: 'Out of order', sub: 'Do not book', ink: 'var(--i-red)', tint: 'var(--t-red)' },
  { key: 'maintenance', name: 'Under maintenance', sub: 'Being worked on', ink: 'var(--i-violet)', tint: 'var(--t-violet)' },
];
const KINDS: [string, string][] = [['ground', 'Ground'], ['net', 'Net'], ['pitch', 'Pitch'], ['equipment', 'Equipment'], ['other', 'Other']];
const kindName = (k: string) => KINDS.find((x) => x[0] === k)?.[1] ?? k;

export default function Spots({ sub }: { sub: string }) {
  const { ownerId } = useSession();
  const toast = useToast();
  const [d, err, reload] = useApi<Data>('/api/desk/spots', [ownerId]);
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('net');
  const items = d?.items ?? [];
  const cur = items.find((x) => x.id === sel) ?? null;
  const patch = async (id: string, body: object) => { try { await api(`/api/desk/spots/${id}`, { method: 'PATCH', body }); reload(); } catch (e: any) { toast(e.message); } };
  const add = async () => { if (!name.trim()) { toast('Type a name for the spot first.'); return; } try { const r = await post<Spot>('/api/desk/spots', { name: name.trim(), kind }); setName(''); setSel(r.id); reload(); } catch (e: any) { toast(e.message); } };
  const remove = async (x: Spot) => { try { await api(`/api/desk/spots/${x.id}`, { method: 'DELETE' }); setSel(null); reload(); toast(`${x.name} removed`); } catch (e: any) { toast(e.message); } };

  return (
    <div className="dap">
      <div className="dap-hd">
        <div><span className="eyebrow">Inspect → fix → ready to play</span><h1>Grounds &amp; nets</h1></div>
        <span className="muted">{d ? `${d.counts.ready} of ${items.length} ready to play` : ' '}</span>
      </div>
      <ErrorBox msg={err} />
      {!d ? (!err && <Loading h={300} />) : sub === 'layout' ? <Layout items={items} sel={sel} onSel={setSel} onMove={(id, x, y) => patch(id, { x, y })} /> : (
        <div className="dap-row">
          <div className="dap-board-wrap">
            <div className="dap-board" style={{ gridTemplateColumns: 'repeat(4, minmax(170px, 1fr))' }}>
              {COLS.map((c) => (
                <div key={c.key} className="dap-col" style={{ background: c.tint }}>
                  <span className="dap-who" style={{ color: c.ink }}>{c.name} · {d.counts[c.key]}</span>
                  <span className="small muted" style={{ marginTop: -4 }}>{c.sub}</span>
                  {items.filter((x) => x.status === c.key).map((x) => (
                    <button key={x.id} type="button" className={`dap-card${cur?.id === x.id ? ' on' : ''}`} onClick={() => { setSel(x.id); setNote(null); }}>
                      <span className="dap-tag" style={{ color: c.ink, background: c.tint }}>{kindName(x.kind)}</span>
                      <b>{x.name}</b>
                      {x.note && <span className="muted">{x.note}</span>}
                    </button>))}
                </div>))}
            </div>
          </div>
          <aside className="dcard dap-panel" aria-label="Selected spot">
            {cur ? (<>
              <span className="dap-tag" style={{ color: 'var(--fg-2)', background: 'var(--soft)' }}>{kindName(cur.kind)}</span>
              <h2>{cur.name}</h2>
              <span className="muted">In this status since {fmtDateTime(cur.statusAt)}</span>
              <div className="dtabs" role="group" aria-label="Status">
                {COLS.map((c) => <button key={c.key} type="button" className={`dchip${cur.status === c.key ? ' on' : ''}`} aria-pressed={cur.status === c.key} onClick={() => patch(cur.id, { status: c.key })}>{c.name}</button>)}
              </div>
              <div className="field" style={{ margin: 0 }}><label htmlFor="spNote">Note</label>
                <textarea id="spNote" rows={3} value={note ?? cur.note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== null && note !== cur.note) patch(cur.id, { note }); }} placeholder="e.g. Net torn at the far end, new one coming Friday" /></div>
              <div className="dap-acts">{cur.groundId ? <span className="small muted">A ground you sell. Take it out of play from Settings.</span> : <button type="button" className="dap-no" onClick={() => remove(cur)}>Remove</button>}</div>
            </>) : <>
              <h2>Pick a card</h2>
              <p className="muted" style={{ margin: 0 }}>Choose a ground, net or piece of kit to change its status or add a note.</p>
            </>}
            <div className="dap-chain" style={{ borderTop: '1px solid var(--line)', paddingTop: 14, gap: 8 }}>
              <b>Add a net, pitch or kit</b>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Net 3, Bowling machine" aria-label="Name" onKeyDown={(e) => e.key === 'Enter' && add()} />
              <div className="dap-acts"><select className="inp" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ width: 'auto' }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button type="button" className="dap-yes" style={{ height: 40 }} onClick={add}>Add</button></div>
            </div>
          </aside>
        </div>)}
    </div>
  );
}

/** A plan of the ground: every spot as a tile in its status colour. Drag a tile to move it; the place is saved when you let go. */
function Layout({ items, sel, onSel, onMove }: { items: Spot[]; sel: string | null; onSel: (id: string | null) => void; onMove: (id: string, x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))), y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))) }; };
  return (
    <div className="spot-plan" ref={box} onPointerMove={(e) => drag && setDrag({ id: drag.id, ...at(e) })} onPointerUp={() => { if (drag) { onMove(drag.id, drag.x, drag.y); setDrag(null); } }} onPointerLeave={() => { if (drag) { onMove(drag.id, drag.x, drag.y); setDrag(null); } }}>
      <div className="spot-oval" aria-hidden="true" />
      {items.map((x) => {
        const c = COLS.find((k) => k.key === x.status)!;
        const p = drag?.id === x.id ? drag : x;
        return (
          <button key={x.id} type="button" className={`spot-tile${sel === x.id ? ' on' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%`, background: c.tint, color: c.ink, borderColor: c.ink }}
            onPointerDown={(e) => { e.preventDefault(); onSel(x.id); setDrag({ id: x.id, x: x.x, y: x.y }); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}>
            <b>{x.name}</b><span>{c.name}</span>
          </button>);
      })}
      <p className="spot-hint small muted">Drag a tile to where it sits on your ground.</p>
    </div>
  );
}
