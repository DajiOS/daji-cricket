import { useState } from 'react';
import { post, inr, fmtDate } from '../../lib';
import { Chip, Status, Modal, Field, ErrorBox, type Tone } from '../../ui';

export interface Bill {
  id: string; vendorId: string; vendorName: string; vendorUpi: string | null; vendorPhone: string | null; billNo: string | null; billDate: string; dueDate: string; amountPaise: number;
  categoryId: string | null; categoryName: string | null; notes: string | null; status: string; createdBy: string | null; createdByName: string | null; createdAt: number;
  submittedAt: number | null; decidedAt: number | null; decidedBy: string | null; decidedByName: string | null; rejectReason: string | null;
  paidDate: string | null; payMethod: string | null; payReference: string | null; transactionId: string | null; overdue: boolean; dueInDays: number; fileCount: number;
}
export interface Vendor { id: string; name: string; phone: string | null; upiId: string | null; gstin: string | null; notes: string | null; billCount: number; openPaise: number }
export interface Stats { overdueCount: number; overduePaise: number; dueWeekCount: number; dueWeekPaise: number; pendingCount: number; pendingPaise: number; approvedCount: number; approvedPaise: number; paidMonthPaise: number }

export const STATUS: Record<string, [Tone, string]> = {
  draft: ['mute', 'Draft'], pending_approval: ['warn', 'Awaiting approval'], approved: ['info', 'Approved, unpaid'], paid: ['good', 'Paid'], rejected: ['bad', 'Rejected'],
};
export const METHOD: Record<string, string> = { upi: 'UPI', bank: 'Bank transfer', cash: 'Cash' };
export const BillChip = ({ s }: { s: string }) => <Status s={s} map={STATUS} />;

/** "Overdue by 3 days", "Due today", "Due in 4 days" for an unpaid bill; the paid date for a paid one. */
export function DueText({ b }: { b: Bill }) {
  if (b.status === 'paid') return <span className="muted small">Paid {fmtDate(b.paidDate)}</span>;
  if (b.status === 'rejected') return <span className="muted small">{fmtDate(b.dueDate)}</span>;
  if (b.overdue) return <Chip tone="bad">Overdue {-b.dueInDays}d</Chip>;
  if (b.dueInDays === 0) return <Chip tone="warn">Due today</Chip>;
  if (b.dueInDays <= 7) return <Chip tone="warn">Due in {b.dueInDays}d</Chip>;
  return <span className="muted small">{fmtDate(b.dueDate)}</span>;
}

export function RejectModal({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await post(`/api/accounting/bills/${bill.id}/reject`, { reason }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Reject bill from ${bill.vendorName}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={busy} onClick={submit}>Reject bill</button></>}>
      <div className="stack"><ErrorBox msg={err} />
        <p className="muted">{inr(bill.amountPaise)}{bill.billNo ? ` · bill ${bill.billNo}` : ''}. The person who entered it can fix it and send it again.</p>
        <Field label="Reason"><textarea className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount, duplicate of INV-12" autoFocus /></Field>
      </div>
    </Modal>
  );
}
