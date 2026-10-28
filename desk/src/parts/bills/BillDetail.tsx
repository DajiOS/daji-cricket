import { useState } from 'react';
import { useApi, post, del, sendFile, download, inr, fmtDate, fmtDateTime, go, can, formatPhone } from '../../lib';
import { useSession } from '../../App';
import { PageHead, Loading, ErrorBox, Icon, Confirm, useToast, Stat } from '../../ui';
import { BillChip, DueText, METHOD, RejectModal, type Bill } from './common';
import { BillForm } from './BillForm';
import { PayModal } from './PayModal';

interface Detail {
  bill: Bill; files: { id: string; filename: string; mime: string; sizeBytes: number }[];
  events: { id: number; at: number; action: string; actorName: string | null; actorRole: string | null; detail: any }[];
  transaction: { id: string; date: string; description: string; amountPaise: number } | null;
}
const EVENT: Record<string, string> = {
  'bill.create': 'Bill entered', 'bill.update': 'Bill edited', 'bill.submit': 'Sent for approval', 'bill.approve': 'Approved', 'bill.reject': 'Rejected',
  'bill.pay': 'Marked paid', 'bill.file.add': 'Document added', 'bill.file.remove': 'Document removed',
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function BillDetail({ id }: { id: string }) {
  const s = useSession(); const toast = useToast();
  const [d, err, reload] = useApi<Detail>(`/api/accounting/bills/${id}`, [id]);
  const [modal, setModal] = useState<'edit' | 'pay' | 'reject' | null>(null);
  if (err) return <div className="stack"><a href="#/bills" className="btn ghost sm"><Icon name="back" />All bills</a><ErrorBox msg={err} /></div>;
  if (!d) return <Loading h={400} />;
  const b = d.bill;
  const boss = s.me.role === 'owner' || s.me.role === 'super_admin';
  const mayDecide = can(s.me, 'manage_accounting') && b.status === 'pending_approval' && (boss || b.createdBy !== s.me.id);
  const act = async (path: string, msg: string) => { try { await post(`/api/accounting/bills/${b.id}/${path}`); toast(msg); reload(); s.refreshCounts(); } catch (e: any) { toast(e.message); } };
  const upload = async (f: File | undefined) => { if (!f) return; try { await sendFile(`/api/accounting/bills/${b.id}/files?filename=${encodeURIComponent(f.name)}`, f); reload(); } catch (e: any) { toast(e.message); } };
  const rm = async (fid: string) => { try { await del(`/api/accounting/bills/${b.id}/files/${fid}`); reload(); } catch (e: any) { toast(e.message); } };
  const removeBill = async () => { try { await del(`/api/accounting/bills/${b.id}`); toast('Bill deleted'); go('/bills'); } catch (e: any) { toast(e.message); } };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a href="#/bills" className="btn ghost sm"><Icon name="back" />All bills</a>
        <div className="row">
          {(b.status === 'draft' || b.status === 'rejected') && <>
            <Confirm label="Delete" ask="Delete this bill?" onYes={removeBill} className="btn ghost" />
            <button className="btn" onClick={() => setModal('edit')}>Edit</button>
            <button className="btn primary" onClick={() => act('submit', 'Sent for approval')}>Send for approval</button></>}
          {mayDecide && <><button className="btn danger" onClick={() => setModal('reject')}>Reject</button><button className="btn primary" onClick={() => act('approve', 'Bill approved')}><Icon name="check" />Approve</button></>}
          {b.status === 'pending_approval' && !mayDecide && can(s.me, 'manage_accounting') && <span className="muted small">You entered this bill, so someone else approves it.</span>}
          {b.status === 'approved' && can(s.me, 'manage_accounting') && <button className="btn primary" onClick={() => setModal('pay')}><Icon name="payments" />Mark paid</button>}
        </div>
      </div>
      <PageHead eyebrow={b.categoryName ?? 'Vendor bill'} title={b.vendorName} lede={`${b.billNo ? `Bill ${b.billNo} · ` : ''}dated ${fmtDate(b.billDate)} · due ${fmtDate(b.dueDate)}`}><BillChip s={b.status} /></PageHead>
      {b.status === 'rejected' && b.rejectReason && <div className="err" role="alert">Rejected{b.decidedByName ? ` by ${b.decidedByName}` : ''}: {b.rejectReason}</div>}
      <div className="grid g3">
        <Stat label="Amount" value={inr(b.amountPaise, 2)} foot={<DueText b={b} />} />
        <Stat label="Entered by" value={<span style={{ fontSize: 20 }}>{b.createdByName ?? 'Unknown'}</span>} foot={fmtDateTime(b.createdAt)} />
        <Stat label={b.status === 'paid' ? 'Paid' : 'Decision'} value={<span style={{ fontSize: 20 }}>{b.status === 'paid' ? fmtDate(b.paidDate) : b.decidedByName ?? 'Not yet'}</span>}
          foot={b.status === 'paid' ? `${METHOD[b.payMethod ?? ''] ?? ''}${b.payReference ? ` · ${b.payReference}` : ''}` : b.decidedAt ? fmtDateTime(b.decidedAt) : 'Waiting'} />
      </div>
      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h3>Details</h3></div>
          <div className="card-pad bills-kv">
            <div><span>Vendor UPI</span><b>{b.vendorUpi ?? '—'}</b></div>
            <div><span>Vendor phone</span><b>{formatPhone(b.vendorPhone) || '—'}</b></div>
            <div><span>Notes</span><b>{b.notes ?? '—'}</b></div>
            {d.transaction && <div><span>Bank transaction</span><b><a href="#/transactions">{fmtDate(d.transaction.date)} · {inr(-d.transaction.amountPaise)} · {d.transaction.description}</a></b></div>}
          </div>
          <div className="card-head"><h3>Documents</h3>
            {b.status !== 'paid' && can(s.me, 'manage_accounting') && <label className="btn sm"><Icon name="plus" />Add<input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}</div>
          <div className="card-pad">
            {!d.files.length ? <span className="muted small">No document attached.</span> : d.files.map((f) => (
              <div key={f.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <button className="btn ghost sm" onClick={() => download(`/api/accounting/bills/${b.id}/files/${f.id}`, f.filename)}>{f.filename} <span className="faint">{kb(f.sizeBytes)}</span></button>
                {b.status !== 'paid' && can(s.me, 'manage_accounting') && <Confirm label="Remove" ask="Remove?" onYes={() => rm(f.id)} className="btn sm ghost" />}
              </div>))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Audit log</h3></div>
          <div className="card-pad bills-log">
            {d.events.map((e) => (
              <div key={e.id} className="bills-ev"><div className="strong">{EVENT[e.action] ?? e.action}</div>
                <div className="small muted">{e.actorName ?? e.actorRole ?? 'System'} · {fmtDateTime(e.at)}</div>
                {e.detail?.reason && <div className="small">Reason: {e.detail.reason}</div>}
                {e.action === 'bill.pay' && <div className="small">{METHOD[e.detail?.method] ?? ''}{e.detail?.reference ? ` · ${e.detail.reference}` : ''}</div>}
              </div>))}
          </div>
        </div>
      </div>
      {modal === 'edit' && <BillForm bill={b} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'pay' && <PayModal bill={b} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'reject' && <RejectModal bill={b} onClose={() => setModal(null)} onDone={() => { setModal(null); toast('Bill rejected'); reload(); s.refreshCounts(); }} />}
    </div>
  );
}
