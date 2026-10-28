import { useState } from 'react';
import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Icon, Tabs } from '../ui';
import { useApi, go, can, inr, fmtDate, fmtDateTime, todayISO, type Me } from '../lib';
import { seesMoney } from '../registry';
import { BillChip, DueText, METHOD, type Bill } from '../parts/bills/common';
import type { Booking } from '../parts/dash/common';

// The starter kit's process pipeline: work moving through its stages, with the approval chain of the picked item on the side.
type Tab = 'bills' | 'bookings';
const tabsFor = (me: Me): [Tab, string][] => [...(seesMoney(me) ? [['bills', 'Bills'] as [Tab, string]] : []), ...(can(me, 'manage_bookings') ? [['bookings', 'Bookings'] as [Tab, string]] : [])];

export default function Pipeline({ sub }: { sub: string }) {
  const { me } = useSession();
  const tabs = tabsFor(me);
  const tab: Tab = (tabs.find(([k]) => k === sub)?.[0] ?? tabs[0]?.[0] ?? 'bills');
  return (
    <div className="stack">
      <PageHead eyebrow="Work in motion" title="Pipeline" lede="Bills move from entered to approved to paid, and bookings from held to confirmed and paid in full. Pick a bill to see who did what on it." />
      {tabs.length > 1 && <div><Tabs value={tab} onChange={(t) => go(`/pipeline/${t}`)} items={tabs} label="Pipeline" /></div>}
      {!tabs.length ? <p className="muted">Your login has no bills or bookings to follow.</p> : tab === 'bills' ? <BillsFlow /> : <BookingsFlow />}
    </div>
  );
}

function Column({ title, tone, count, total, children }: { title: string; tone: string; count: number; total?: number; children: React.ReactNode }) {
  return (
    <section className={`pl-col t-${tone}`} aria-label={title}>
      <header><span className="pl-dot" aria-hidden="true" /><b>{title}</b><span className="muted small">{count}{total != null ? ` · ${inr(total)}` : ''}</span></header>
      <div className="pl-cards">{count ? children : <p className="small muted" style={{ margin: '4px 2px' }}>Nothing here</p>}</div>
    </section>
  );
}

function BillsFlow() {
  const [d, err] = useApi<{ items: Bill[] }>('/api/accounting/bills');
  const [pick, setPick] = useState<string | null>(null);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading h={360} />;
  const since = new Date(Date.parse(todayISO()) - 30 * 864e5).toISOString().slice(0, 10);
  const cols: [string, string, Bill[]][] = [
    ['Entered', 'amber', d.items.filter((b) => b.status === 'draft' || b.status === 'rejected')],
    ['Waiting for approval', 'violet', d.items.filter((b) => b.status === 'pending_approval')],
    ['Approved, to pay', 'blue', d.items.filter((b) => b.status === 'approved')],
    ['Paid in the last 30 days', 'green', d.items.filter((b) => b.status === 'paid' && (b.paidDate ?? '') >= since)],
  ];
  const sum = (xs: Bill[]) => xs.reduce((s, b) => s + b.amountPaise, 0);
  const picked = d.items.find((b) => b.id === pick) ?? null;
  return (
    <div className={`pl-wrap${picked ? ' with-side' : ''}`}>
      <div className="pl">
        {cols.map(([t, tone, xs]) => (
          <Column key={t} title={t} tone={tone} count={xs.length} total={sum(xs)}>
            {xs.map((b) => (
              <button key={b.id} className={`pl-card${pick === b.id ? ' on' : ''}`} onClick={() => setPick(pick === b.id ? null : b.id)} aria-pressed={pick === b.id}>
                <span className="pl-top"><b>{b.vendorName}</b><span className="num">{inr(b.amountPaise)}</span></span>
                <span className="small muted">{b.billNo ? `Bill ${b.billNo} · ` : ''}{b.categoryName ?? 'No category'}</span>
                <span className="pl-foot">{b.status === 'rejected' ? <BillChip s="rejected" /> : <DueText b={b} />}</span>
              </button>))}
          </Column>))}
      </div>
      {picked && <Chain bill={picked} onClose={() => setPick(null)} />}
    </div>
  );
}

interface Detail { bill: Bill; events: { id: number; at: number; action: string; actorName: string | null; actorRole: string | null; detail: any }[] }
const STEP_WORDS: Record<string, string> = { 'bill.create': 'Entered', 'bill.update': 'Changed', 'bill.submit': 'Sent for approval', 'bill.approve': 'Approved', 'bill.reject': 'Rejected', 'bill.pay': 'Paid', 'bill.file.add': 'Receipt added', 'bill.file.remove': 'Receipt removed' };

/** The approval chain: the four steps of a bill with who and when, then every change made to it. */
function Chain({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [d] = useApi<Detail>(`/api/accounting/bills/${bill.id}`);
  const ev = d?.events ?? [];
  const by = (a: string) => [...ev].reverse().find((e) => e.action === a);
  const who = (e?: Detail['events'][number]) => (e ? `${e.actorName ?? e.actorRole ?? 'System'} · ${fmtDateTime(e.at)}` : null);
  const steps: [string, boolean, string | null][] = [
    ['Entered', true, who(by('bill.create')) ?? (bill.createdByName ? `${bill.createdByName} · ${fmtDateTime(bill.createdAt)}` : null)],
    ['Sent for approval', !!bill.submittedAt, who(by('bill.submit'))],
    [bill.status === 'rejected' ? 'Rejected' : 'Approved', !!bill.decidedAt, bill.decidedAt ? `${bill.decidedByName ?? 'Someone'} · ${fmtDateTime(bill.decidedAt)}${bill.rejectReason ? ` · "${bill.rejectReason}"` : ''}` : null],
    ['Paid', bill.status === 'paid', bill.status === 'paid' ? `${fmtDate(bill.paidDate)}${bill.payMethod ? ` · ${METHOD[bill.payMethod] ?? bill.payMethod}` : ''}${bill.payReference ? ` · ${bill.payReference}` : ''}` : null],
  ];
  return (
    <aside className="card pl-side" aria-label="Approval chain">
      <div className="card-head"><h3>{bill.vendorName}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      <div className="card-pad">
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="flow-total num">{inr(bill.amountPaise)}</span><BillChip s={bill.status} /></div>
        <ol className="chain">
          {steps.map(([t, done, text]) => (
            <li key={t} className={done ? (t === 'Rejected' ? 'bad' : 'done') : ''}>
              <span className="chain-dot" aria-hidden="true">{done ? (t === 'Rejected' ? <Icon name="x" size={12} /> : <Icon name="check" size={12} />) : null}</span>
              <span><b>{t}</b>{text ? <span className="small muted">{text}</span> : <span className="small muted">Not yet</span>}</span>
            </li>))}
        </ol>
        {ev.length > 0 && <>
          <div className="eyebrow" style={{ marginTop: 16 }}>Every change</div>
          <ul className="chain-log">{ev.map((e) => <li key={e.id}><span>{STEP_WORDS[e.action] ?? e.action}</span><span className="small muted">{e.actorName ?? e.actorRole ?? 'System'} · {fmtDateTime(e.at)}</span></li>)}</ul>
        </>}
        <button className="btn primary" style={{ marginTop: 16, width: '100%' }} onClick={() => go(bill.status === 'pending_approval' ? '/approvals' : `/bills/${bill.id}`)}>
          {bill.status === 'pending_approval' ? 'Go to approvals' : bill.status === 'approved' ? 'Pay this bill' : bill.status === 'draft' || bill.status === 'rejected' ? 'Open and send for approval' : 'Open the bill'}
        </button>
      </div>
    </aside>
  );
}

interface Pay { id: string; bookingId: string; amountPaise: number; reference: string | null; submittedAt: number | null; createdAt: number }
function BookingsFlow() {
  const { me } = useSession();
  const verify = can(me, 'verify_payments') || can(me, 'record_payments');
  const [held] = useApi<{ items: Booking[] }>('/api/staff/bookings?status=held&limit=50');
  const [waiting] = useApi<{ items: Booking[] }>('/api/staff/bookings?approval=pending&limit=50');
  const [upi] = useApi<{ items: Pay[] }>(verify ? '/api/staff/payments?status=submitted&limit=50' : null);
  const [ahead, err] = useApi<{ items: Booking[] }>(`/api/staff/bookings?status=confirmed&from=${todayISO()}&limit=100`);
  if (err) return <ErrorBox msg={err} />;
  if (!held || !waiting || !ahead || (verify && !upi)) return <Loading h={360} />;
  const due = ahead.items.filter((b) => b.balancePaise > 0 && b.approval !== 'pending');
  const settled = ahead.items.filter((b) => b.balancePaise <= 0 && b.approval !== 'pending');
  const card = (b: Booking, foot: React.ReactNode) => (
    <button key={b.id} className="pl-card" onClick={() => go(`/bookings/${b.id}`)}>
      <span className="pl-top"><b>{b.customerName}</b><span className="num">{inr(b.totalPaise)}</span></span>
      <span className="small muted">{b.ref} · {fmtDate(b.date)} · {b.groundName}</span>
      <span className="pl-foot">{foot}</span>
    </button>);
  return (
    <div className="pl">
      <Column title="Held, not paid" tone="amber" count={held.items.length}>{held.items.map((b) => card(b, <span className="small muted">Hold ends {b.holdExpiresAt ? fmtDateTime(b.holdExpiresAt) : 'soon'}</span>))}</Column>
      {verify && <Column title="UPI to verify" tone="violet" count={upi!.items.length} total={upi!.items.reduce((s, p) => s + p.amountPaise, 0)}>
        {upi!.items.map((p) => (
          <button key={p.id} className="pl-card" onClick={() => go('/approvals/upi')}>
            <span className="pl-top"><b>UPI {p.reference ?? ''}</b><span className="num">{inr(p.amountPaise)}</span></span>
            <span className="small muted">Sent {fmtDateTime(p.submittedAt ?? p.createdAt)}</span>
          </button>))}
      </Column>}
      <Column title="Waiting for approval" tone="blue" count={waiting.items.length}>{waiting.items.map((b) => card(b, <span className="small muted">Paid {inr(b.paidPaise)}</span>))}</Column>
      <Column title="Balance to collect" tone="teal" count={due.length} total={due.reduce((s, b) => s + b.balancePaise, 0)}>{due.map((b) => card(b, <span className="small">Balance <b className="num">{inr(b.balancePaise)}</b></span>))}</Column>
      <Column title="Paid in full, coming up" tone="green" count={settled.length}>{settled.map((b) => card(b, <span className="small muted">All paid</span>))}</Column>
    </div>
  );
}
