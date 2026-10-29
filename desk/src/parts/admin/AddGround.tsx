// Adding a ground or a practice pitch to the business. Opened from Settings, Prices and timings and from the + in the ground picker.
import { useState } from 'react';
import { post } from '../../lib';
import { Field, Modal, useToast } from '../../ui';
import { useSession } from '../../App';
import { errText } from './common';

/**
 * Adds another ground or practice pitch to this business (Antroli, or a net next to Daji's own ground): same owner, same team, same books, so it shows in the
 * ground picker, on the website and in the reports straight away. Prices, timings and the check-in point are then set on its own card.
 */
export function AddGround({ city, onAdded, onClose }: { city: string; onAdded: () => void; onClose: () => void }) {
  const toast = useToast();
  const s = useSession();
  const [f, setF] = useState({ name: '', city, mapUrl: '', price: '', open: true });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'name' | 'city' | 'mapUrl' | 'price') => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function add() {
    setMsg(null);
    if (f.name.trim().length < 2) return setMsg('Give it a name.');
    if (f.city.trim().length < 2) return setMsg('Enter the city.');
    if (f.price === '' || isNaN(Number(f.price)) || Number(f.price) < 0) return setMsg('Enter the price for one hour, in rupees.');
    setBusy(true);
    try {
      await post('/api/staff/grounds', {
        name: f.name.trim(), city: f.city.trim(), pricePaise: Math.round(Number(f.price) * 100), active: f.open,
        ...(f.mapUrl.trim() ? { mapUrl: f.mapUrl.trim() } : {}), ...(s.me.role === 'super_admin' ? { ownerId: s.ownerId } : {}),
      });
      toast(`${f.name.trim()} added`); onAdded(); onClose();
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add a ground or pitch" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add ground'}</button></>}>
      <div className="grid g2">
        <Field label="Name" required hint="A ground, or a practice pitch customers rent on its own"><input className="inp" value={f.name} onChange={set('name')} placeholder="Antroli Cricket Ground, or Practice pitch 1" autoFocus /></Field>
        <Field label="City" required><input className="inp" value={f.city} onChange={set('city')} /></Field>
        <Field label="Price for one hour (₹)" required hint="The starting price. Set the full price list on its card after adding it."><input className="inp" value={f.price} onChange={set('price')} inputMode="decimal" /></Field>
        <Field label="Google Maps link" hint="Share, then Copy link. Set the check-in point in Settings, Check-in."><input className="inp" value={f.mapUrl} onChange={set('mapUrl')} placeholder="https://maps.app.goo.gl/..." /></Field>
        <label className="row full" style={{ gap: 8 }}><input type="checkbox" checked={f.open} onChange={(e) => setF((x) => ({ ...x, open: e.target.checked }))} />Customers can book it now. Untick to set it up first; it stays hidden until you switch it on.</label>
      </div>
      {msg && <div className="err" role="alert" style={{ marginTop: 10 }}>{msg}</div>}
    </Modal>
  );
}
