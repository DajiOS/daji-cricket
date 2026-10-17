import { useState } from 'react';
import { post, patch, sendFile, useApi, toPaise, rupees, todayISO, addDaysISO } from '../../lib';
import { Modal, Field, ErrorBox, useToast, DateInput } from '../../ui';
import type { Bill, Vendor } from './common';

interface Cat { id: string; name: string; kind: string; group: string }

/** Enter or edit a bill. A new bill can be saved as a draft or sent for approval in one go. */
export function BillForm({ bill, vendorId, onClose, onSaved }: { bill?: Bill; vendorId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [vendors] = useApi<{ items: Vendor[] }>('/api/accounting/vendors');
  const [cats] = useApi<{ items: Cat[] }>('/api/accounting/categories');
  const [v, setV] = useState({
    vendorId: bill?.vendorId ?? vendorId ?? '', billNo: bill?.billNo ?? '', billDate: bill?.billDate ?? todayISO(), dueDate: bill?.dueDate ?? addDaysISO(todayISO(), 15),
    amount: bill ? rupees(bill.amountPaise) : '', categoryId: bill?.categoryId ?? '', notes: bill?.notes ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async (submit: boolean) => {
    const paise = toPaise(v.amount);
    if (!paise || paise <= 0) return setErr('Enter the bill amount in rupees');
    if (!v.vendorId) return setErr('Choose a vendor');
    setBusy(true); setErr(null);
    try {
      const body = { vendorId: v.vendorId, billNo: v.billNo, billDate: v.billDate, dueDate: v.dueDate, amountPaise: paise, categoryId: v.categoryId || null, notes: v.notes || null };
      const saved: Bill = bill ? await patch(`/api/accounting/bills/${bill.id}`, body) : await post('/api/accounting/bills', body);
      if (file) await sendFile(`/api/accounting/bills/${saved.id}/files?filename=${encodeURIComponent(file.name)}`, file);
      if (submit) await post(`/api/accounting/bills/${saved.id}/submit`);
      toast(submit ? 'Bill sent for approval' : 'Bill saved as a draft');
      onSaved(saved.id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const expense = (cats?.items ?? []).filter((c) => c.kind === 'expense');
  return (
    <Modal wide title={bill ? 'Edit bill' : 'Enter a bill'} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
      <button className="btn primary" disabled={busy} onClick={() => save(true)}>Send for approval</button></>}>
      <div className="stack"><ErrorBox msg={err} />
        <div className="form-grid">
          <Field label="Vendor" hint="Not listed? Add it under the Vendors tab first.">
            <select className="inp" value={v.vendorId} onChange={set('vendorId')}><option value="">Choose a vendor</option>{(vendors?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Bill number"><input className="inp" value={v.billNo} onChange={set('billNo')} placeholder="As printed on the bill" /></Field>
          <Field label="Bill date"><DateInput className="inp" value={v.billDate} onChange={set('billDate')} /></Field>
          <Field label="Due date"><DateInput className="inp" value={v.dueDate} onChange={set('dueDate')} /></Field>
          <Field label="Amount (rupees)"><input className="inp" inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="12500.00" /></Field>
          <Field label="Category"><select className="inp" value={v.categoryId} onChange={set('categoryId')}><option value="">None</option>{expense.map((c) => <option key={c.id} value={c.id}>{c.group} / {c.name}</option>)}</select></Field>
          <Field label="Notes" full><textarea className="inp" value={v.notes} onChange={set('notes')} /></Field>
          <Field label={bill ? 'Add another document' : 'Photo or PDF of the bill'} hint="PDF, PNG, JPEG or WebP, up to 5 MB" full>
            <input className="inp" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
