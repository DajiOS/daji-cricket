import { useState } from 'react';
import { post, patch, toPaise, rupees } from '../../lib';
import { Modal, Field, ErrorBox, useToast } from '../../ui';
import { errText, type Plan } from './shared';

export default function PlanDialog({ plan, onClose, onDone }: { plan?: Plan; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(plan?.name ?? ''); const [price, setPrice] = useState(plan ? rupees(plan.pricePaise) : '');
  const [days, setDays] = useState(String(plan?.durationDays ?? 30)); const [perks, setPerks] = useState(plan?.perks ?? ''); const [active, setActive] = useState(plan?.active ?? true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    const pricePaise = toPaise(price), durationDays = Number(days);
    if (name.trim().length < 2) return setErr('Give the plan a name.');
    if (pricePaise == null || pricePaise < 0) return setErr('Enter the price in rupees.');
    if (!Number.isInteger(durationDays) || durationDays < 1) return setErr('Duration must be a whole number of days.');
    setBusy(true);
    try {
      const body = { name: name.trim(), pricePaise, durationDays, perks: perks.trim(), active };
      if (plan) await patch(`/api/desk/memberships/plans/${plan.id}`, body); else await post('/api/desk/memberships/plans', body);
      toast(plan ? 'Plan saved' : 'Plan added'); onDone();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title={plan ? 'Edit plan' : 'New plan'} onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button></>}>
      <div className="form-grid">
        <Field label="Plan name" full><input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder="Monthly net practice" /></Field>
        <Field label="Price (₹)"><input className="inp" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Duration (days)"><input className="inp" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Perks" full hint="Shown to staff when selling. One line per perk."><textarea className="inp" value={perks} onChange={(e) => setPerks(e.target.value)} maxLength={600} /></Field>
        <label className="row full" style={{ gap: 8 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span className="small">On sale (can be sold and renewed)</span></label>
      </div>
      <ErrorBox msg={err} />
    </Modal>
  );
}
