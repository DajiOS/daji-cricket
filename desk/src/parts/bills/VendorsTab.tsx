import { useState } from 'react';
import { useApi, post, patch, del, inr, formatPhone } from '../../lib';
import { Modal, Field, ErrorBox, Table, Loading, Icon, Confirm, useToast } from '../../ui';
import type { Vendor } from './common';

export function VendorsTab({ onBill }: { onBill: (vendorId: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [data, err, reload] = useApi<{ items: Vendor[] }>(`/api/accounting/vendors${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null);
  const remove = async (v: Vendor) => { try { await del(`/api/accounting/vendors/${v.id}`); toast('Vendor removed'); reload(); } catch (e: any) { toast(e.message); } };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <input className="inp bills-search" placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" />
        <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" />Add vendor</button>
      </div>
      <ErrorBox msg={err} />
      <div className="card">
        {!data ? <div className="card-pad"><Loading /></div> : (
          <Table rows={data.items} empty={q ? 'No vendor matches that search.' : 'No vendors yet. Add the people you pay: turf suppliers, electricity, cleaners.'} cols={[
            { head: 'Vendor', cell: (v) => <div><div className="strong">{v.name}</div>{v.gstin && <div className="small faint">GSTIN {v.gstin}</div>}</div> },
            { head: 'Phone', cell: (v) => formatPhone(v.phone) || '—' },
            { head: 'UPI', cell: (v) => v.upiId || '—' },
            { head: 'Bills', cell: (v) => v.billCount, num: true },
            { head: 'Unpaid', cell: (v) => (v.openPaise ? inr(v.openPaise) : '—'), num: true },
            { head: '', cell: (v) => <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => onBill(v.id)}>New bill</button>
              <button className="btn sm ghost" onClick={() => setEdit(v)}>Edit</button>
              {!v.billCount && <Confirm label="Remove" ask="Remove?" onYes={() => remove(v)} className="btn sm ghost" />}</div> },
          ]} />)}
      </div>
      {edit && <VendorForm vendor={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function VendorForm({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: vendor?.name ?? '', phone: vendor?.phone ?? '', upiId: vendor?.upiId ?? '', gstin: vendor?.gstin ?? '', notes: vendor?.notes ?? '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: any) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr(null);
    try { vendor ? await patch(`/api/accounting/vendors/${vendor.id}`, v) : await post('/api/accounting/vendors', v); toast('Vendor saved'); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={vendor ? 'Edit vendor' : 'Add vendor'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save vendor</button></>}>
      <div className="stack"><ErrorBox msg={err} />
        <div className="form-grid">
          <Field label="Name" full><input className="inp" value={v.name} onChange={set('name')} autoFocus /></Field>
          <Field label="Phone"><input className="inp" inputMode="tel" value={v.phone} onChange={set('phone')} placeholder="98765 43210" /></Field>
          <Field label="UPI id"><input className="inp" value={v.upiId} onChange={set('upiId')} placeholder="name@bank" /></Field>
          <Field label="GSTIN (optional)"><input className="inp" value={v.gstin} onChange={set('gstin')} placeholder="24ABCDE1234F1Z5" maxLength={15} /></Field>
          <Field label="Notes" full><textarea className="inp" value={v.notes} onChange={set('notes')} /></Field>
        </div>
      </div>
    </Modal>
  );
}
