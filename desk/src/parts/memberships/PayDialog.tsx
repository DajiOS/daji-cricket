import { useState } from 'react';
import { post, inr, toPaise, rupees, formatPhone, fmtDate, todayISO, addDaysISO } from '../../lib';
import { Modal, Field, ErrorBox, NameField, useToast, DateInput } from '../../ui';
import { METHODS, needsRef, errText, type Member, type Plan } from './shared';

/** Sell a new membership (no `member`) or renew an existing one. One form, one payment. */
export default function PayDialog({ plans, member, onClose, onDone }: { plans: Plan[]; member?: Member; onClose: () => void; onDone: (m: Member) => void }) {
  const toast = useToast();
  const choices = plans.filter((p) => p.active || p.id === member?.planId);
  const [planId, setPlanId] = useState(member?.planId && choices.some((p) => p.id === member.planId) ? member.planId : choices[0]?.id ?? '');
  const plan = choices.find((p) => p.id === planId);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [start, setStart] = useState(todayISO());
  const [method, setMethod] = useState('cash'); const [ref, setRef] = useState('');
  const [amount, setAmount] = useState<string | null>(null); // null = follow the plan price
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amountText = amount ?? (plan ? rupees(plan.pricePaise) : '');

  // where the paid period will run, shown before the person confirms
  const t = todayISO();
  const from = member ? (member.endDate >= t ? addDaysISO(member.endDate, 1) : t) : start;
  const until = plan ? addDaysISO(from, plan.durationDays - 1) : null;

  async function submit() {
    setErr(null);
    const paise = toPaise(amountText);
    if (!plan) return setErr('Choose a plan.');
    if (paise == null || paise < 0) return setErr('Enter the amount received, like 3000 or 3000.50.');
    if (!member && (name.trim().length < 2 || !phone.trim())) return setErr('Enter the member name and mobile number.');
    if (needsRef(method) && !ref.trim()) return setErr('Enter the UTR or transaction reference.');
    setBusy(true);
    try {
      const pay = { planId, method, reference: ref.trim() || undefined, amountPaise: paise };
      const m = member
        ? await post<Member>(`/api/desk/memberships/members/${member.id}/renew`, pay)
        : await post<Member>('/api/desk/memberships/members', { ...pay, name: name.trim(), phone: phone.trim(), startDate: start });
      toast(member ? `${m.name} renewed until ${fmtDate(m.endDate)}` : `${m.name} is now a member`);
      onDone(m);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Modal title={member ? `Renew ${member.name}` : 'Sell a membership'} onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={submit}>{busy ? 'Saving…' : member ? 'Record renewal' : 'Record sale'}</button></>}>
      {!choices.length ? <div className="muted">Add an active plan first (Plans tab).</div> : (
        <div className="form-grid">
          {member ? (
            <div className="full small muted">{formatPhone(member.phone)} · now {member.planName}, ends {fmtDate(member.endDate)}</div>
          ) : (<>
            <NameField value={name} onChange={setName} autoFocus />
            <Field label="Mobile number" required><input className="inp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></Field>
          </>)}
          <Field label="Plan" full={!!member} required>
            <select className="inp" value={planId} onChange={(e) => { setPlanId(e.target.value); setAmount(null); }}>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.pricePaise)} · {p.durationDays} days{p.active ? '' : ' (off)'}</option>)}
            </select>
          </Field>
          {!member && <Field label="Starts on"><DateInput className="inp" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
          <Field label="Amount received (₹)" required hint={plan && amountText !== rupees(plan.pricePaise) ? `Plan price is ${inr(plan.pricePaise)}` : undefined}>
            <input className="inp" inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Paid by">
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label={needsRef(method) ? 'UTR / reference' : 'Reference (optional)'} full><input className="inp" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} placeholder={needsRef(method) ? '12-digit UTR or transaction id' : 'Receipt number, if any'} /></Field>
          {until && <div className="full small muted">Covers <span className="gold">{fmtDate(from)}</span> to <span className="gold">{fmtDate(until)}</span>.</div>}
        </div>
      )}
      <ErrorBox msg={err} />
    </Modal>
  );
}
