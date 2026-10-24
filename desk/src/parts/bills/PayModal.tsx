import { useState } from 'react';
import { post, useApi, inr, fmtDate, todayISO } from '../../lib';
import { Modal, Field, ErrorBox, useToast, Chip, DateInput } from '../../ui';
import { METHOD, type Bill } from './common';

interface Link { id: string; date: string; description: string; amountPaise: number; reference: string | null; accountName: string }

export function PayModal({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [links] = useApi<{ items: Link[] }>(`/api/accounting/bills/linkable?amountPaise=${bill.amountPaise}`);
  const [v, setV] = useState({ paidDate: todayISO(), method: bill.vendorUpi ? 'upi' : 'bank', reference: '', transactionId: '', cashReason: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const pick = (id: string) => {
    const t = links?.items.find((x) => x.id === id);
    setV((s) => ({ ...s, transactionId: id, paidDate: t && t.date <= todayISO() ? t.date : s.paidDate, reference: id && t?.reference && !s.reference ? t.reference : s.reference }));
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await post(`/api/accounting/bills/${bill.id}/pay`, { paidDate: v.paidDate, method: v.method, reference: v.reference || undefined, transactionId: v.transactionId || undefined, cashReason: v.method === 'cash' && v.cashReason ? v.cashReason : undefined }); toast('Marked as paid'); onDone(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Mark as paid" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Mark paid {inr(bill.amountPaise)}</button></>}>
      <div className="stack"><ErrorBox msg={err} />
        <div className="card card-pad"><div className="strong">{bill.vendorName}</div>
          <div className="small muted">{bill.billNo ? `Bill ${bill.billNo}` : 'No bill number'} · {inr(bill.amountPaise)}</div>
          {bill.vendorUpi && <div className="small">Pay to UPI <span className="gold">{bill.vendorUpi}</span></div>}</div>
        <div className="form-grid">
          <Field label="Paid on" required><DateInput className="inp" max={todayISO()} value={v.paidDate} onChange={set('paidDate')} /></Field>
          <Field label="Method"><select className="inp" value={v.method} onChange={set('method')}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label={v.method === 'cash' ? 'Reference (optional)' : 'UTR or reference'} full><input className="inp" value={v.reference} onChange={set('reference')} placeholder={v.method === 'upi' ? '12-digit UPI reference' : ''} /></Field>
          {v.method === 'cash' && bill.amountPaise > 10_000_00 && <Field label="Why cash? (needed above ₹10,000)" hint="Cash above ₹10,000 to one person in a day is not an allowed expense unless an exception applies. Pay by UPI or bank if you can." full><input className="inp" value={v.cashReason} onChange={set('cashReason')} placeholder="For example: no bank within reach, rule 6DD" /></Field>}
          <Field label="Link a bank transaction (optional)" hint="Withdrawals from the last 90 days that no bill has claimed. Matching amounts are listed first." full>
            <select className="inp" value={v.transactionId} onChange={(e) => pick(e.target.value)}>
              <option value="">Not linked</option>
              {(links?.items ?? []).map((t) => <option key={t.id} value={t.id}>{fmtDate(t.date)} · {inr(-t.amountPaise)} · {t.description.slice(0, 40)}{t.amountPaise === -bill.amountPaise ? ' (same amount)' : ''}</option>)}
            </select></Field>
        </div>
        {v.transactionId && links?.items.find((t) => t.id === v.transactionId)?.amountPaise !== -bill.amountPaise && <div><Chip tone="warn">Amount differs from the bill</Chip></div>}
      </div>
    </Modal>
  );
}
