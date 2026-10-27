import { lazy, Suspense, useState } from 'react';
import { useApi, post, inr, fmtDay, fmtDateTime, can, go } from '../lib';
import { useSession } from '../App';
import { ErrorBox, Loading, useToast } from '../ui';
import { timeRange, errText, type Booking } from '../parts/dash/common';
import type { Bill } from '../parts/bills/common';
const BillsTable = lazy(() => import('./ApprovalsList'));
const Rules = lazy(() => import('../parts/approvals/Rules'));

// Approvals, as in the design: everything waiting on a decision on one stage board (Submitted, Review, Approval, Final sign-off, Done),
// filtered by kind, with the selected item's facts, its sign-off chain and the decision. The old bills table is still at /approvals/bills.
// Bills, staff pay, refunds, discounts, fee waivers and expenses follow the owner's approval rules (built at /approvals/rules):
// the server sends each chain's steps, who may sign and its trail.
type Kind = 'bill' | 'pay' | 'book' | 'upi' | 'refund' | 'discount' | 'waiver' | 'expense';
// The kinds that only ever come from the rules, with the right that lets a team member see them.
const RULED: Partial<Record<Kind, string>> = { refund: 'record_payments', discount: 'manage_bookings', waiver: 'manage_academy', expense: 'manage_accounting' };
const K: Record<Kind, { name: string; ink: string; tint: string; href: string }> = {
  bill: { name: 'Bills', ink: '#B86E12', tint: 'var(--t-amber)', href: '/bills' },
  pay: { name: 'Staff pay', ink: 'var(--i-violet)', tint: 'var(--t-violet)', href: '/payroll' },
  book: { name: 'Booking approvals', ink: 'var(--i-green)', tint: 'var(--t-green)', href: '/bookings/approvals' },
  upi: { name: 'UPI payments', ink: '#0B5F67', tint: 'var(--t-teal)', href: '/bookings/payments' },
  refund: { name: 'Refunds', ink: 'var(--i-red)', tint: 'var(--t-red)', href: '/bookings/payments' },
  discount: { name: 'Discounts', ink: 'var(--i-blue)', tint: 'var(--t-blue)', href: '/bookings' },
  waiver: { name: 'Fee waivers', ink: 'var(--i-teal)', tint: 'var(--t-teal)', href: '/academy/fees' },
  expense: { name: 'Expenses', ink: 'var(--i-amber)', tint: 'var(--t-amber)', href: '/transactions' },
};
const ST: [string, string, string, string][] = [
  ['Submitted', 'New in', 'var(--i-blue)', 'var(--t-blue)'], ['Review', 'First check', '#0B5F67', 'var(--t-teal)'],
  ['Approval', 'Manager sign-off', 'var(--i-amber)', 'var(--t-amber)'], ['Final sign-off', 'Ready to pay', 'var(--i-violet)', 'var(--t-violet)'],
  ['Done', 'Paid or confirmed', 'var(--i-green)', 'var(--t-green)'],
];
const CHAIN: Record<Kind, string[]> = {
  bill: ['Entered by the team', 'Approved by someone else', 'Paid'],
  pay: ['Sent by the owner', 'Signed off', 'Month locked'],
  book: ['Customer pays the advance', 'You approve the booking', 'Session played'],
  upi: ['Customer sends the UPI payment', 'Checked against the bank', 'Booking confirmed'],
  refund: ['Refund started', 'Signed at the ground', 'Super admin authorises'],
  discount: ['Asked for', 'Signed off', 'Discount given'],
  waiver: ['Asked for', 'Signed off', 'Fee waived'],
  expense: ['Entered', 'Signed off', 'Recorded in the books'],
};
// The first and last links of a ruled chain, around the owner's steps.
const ENDS: Partial<Record<Kind, [string, string]>> = { pay: ['Sent by', 'Month locked'], refund: ['Started by', 'Super admin authorises'], discount: ['Asked for by', 'Discount given'], waiver: ['Asked for by', 'Fee waived'], expense: ['Entered by', 'Recorded in the books'] };
const RULE: Record<Kind, string> = {
  bill: 'A bill is approved by someone other than the person who entered it. The owner can approve any bill.',
  pay: 'The month locks when the last step signs.',
  book: 'The advance is holding the slot until you approve it.',
  upi: 'Approve only once the money shows in the bank. Rejecting tells the customer it was not received.',
  refund: 'The super admin authorises it after the last step here. Sending it back keeps it waiting from the first step.',
  discount: 'The booking owes less once the last step signs.',
  waiver: 'The fee drops once the last step signs.',
  expense: 'It is added to the books once the last step signs.',
};
const KIND_OF: Record<string, Kind> = { payroll: 'pay', refund: 'refund', discount: 'discount', waiver: 'waiver', expense: 'expense' };
interface Pay { id: string; bookingId: string; amountPaise: number; reference: string | null; submittedAt: number | null; createdAt: number }
export interface Req {
  id: string; kind: 'bill' | 'payroll' | 'refund' | 'discount' | 'waiver' | 'expense'; entityId: string; title: string; amountPaise: number; status: string; round: number; submittedByName: string | null; submittedAt: number; atStep: number;
  steps: { label: string; who: string; overPaise: number | null; state: 'done' | 'now' | 'later'; signedByName: string | null; signedAt: number | null; note: string | null }[];
  rule: string; canSign: boolean; whyNot: string | null; trail: { id: number; at: number; action: string; actorName: string | null; detail: any }[];
}
type Item = { key: string; id: string; k: Kind; stage: number; step: number; title: string; who: string; amount: number | null; since: number | null; bill?: Bill; req?: Req };
// Where a chain sits on the five columns: a one-step chain waits in Approval; a longer one starts in Review and its last step is Approval.
const stageOf = (r: Req) => (r.steps.length > 1 && r.atStep < r.steps.length - 1 ? 1 : 2);
const ACT: Record<string, string> = { cleared: 'Cleared for the super admin', decline: 'Declined by the super admin', submit: 'Sent in', signoff: 'Signed', approve: 'Approved', sendback: 'Sent back a step', reject: 'Sent back', withdraw: 'Taken back', create: 'Entered', finalise: 'Month locked', pay: 'Paid' };
const age = (t: number | null) => {
  if (!t) return '—';
  const h = Math.floor((Date.now() - t) / 3600000);
  return h < 1 ? 'Under an hour' : h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} day${h < 48 ? '' : 's'}`;
};

export default function Approvals({ sub }: { sub: string }) {
  if (sub === 'rules') return <Suspense fallback={<Loading />}><Rules /></Suspense>;
  if (sub === 'bills') return <Suspense fallback={<Loading />}><BillsTable sub="" /></Suspense>;
  return <Board />;
}

function Board() {
  const s = useSession(); const toast = useToast();
  const me = s.me;
  const boss = me.role === 'owner' || me.role === 'super_admin';
  const acct = can(me, 'manage_accounting'), books = can(me, 'manage_bookings'), upiOk = can(me, 'verify_payments') || can(me, 'record_payments');
  const ruled = acct || (Object.values(RULED) as string[]).some((p) => can(me, p));
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const dep = [s.ownerId, v];
  const [draft] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=draft' : null, dep);
  const [pend, err] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=pending_approval' : null, dep);
  const [appr] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=approved' : null, dep);
  const [paid] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=paid' : null, dep);
  const [bks] = useApi<{ items: Booking[] }>(books ? '/api/staff/bookings?approval=pending&limit=100' : null, dep);
  const [pays] = useApi<{ items: Pay[] }>(upiOk ? '/api/staff/payments?status=submitted&limit=50' : null, dep);
  const [reqs, reqsErr, , reqsStatus] = useApi<{ items: Req[] }>(ruled ? '/api/accounting/approvals/requests' : null, dep);
  // The server shows approval chains only to someone who signs a step in one (or reads the reports). A refusal means none are theirs, not a
  // page that waits for ever; any other failure is said on the page.
  const loaded = (!acct || (draft && pend && appr && paid)) && (!ruled || reqs || reqsErr) && (!books || bks) && (!upiOk || pays);
  const chain = new Map((reqs?.items ?? []).map((r) => [`${r.kind}:${r.entityId}`, r]));

  const week = Date.now() - 7 * 86400000;
  const bill = (b: Bill, stage: number, step: number): Item => {
    const req = stage === 2 ? chain.get(`bill:${b.id}`) : undefined;
    return { key: 'b' + b.id, id: b.id, k: 'bill', stage: req ? stageOf(req) : stage, step: req ? 1 + req.atStep : step, title: `${b.vendorName}${b.billNo ? ' · ' + b.billNo : ''}`, who: b.createdByName ?? '', amount: b.amountPaise, since: stage === 4 ? Date.parse(b.paidDate ?? '') || null : b.submittedAt ?? b.createdAt, bill: b, req };
  };
  const all: Item[] = [
    ...(draft?.items ?? []).map((b) => bill(b, 0, 0)), ...(pend?.items ?? []).map((b) => bill(b, 2, 1)), ...(appr?.items ?? []).map((b) => bill(b, 3, 2)),
    ...(paid?.items ?? []).filter((b) => (Date.parse(b.paidDate ?? '') || 0) >= week).map((b) => bill(b, 4, 3)),
    ...(reqs?.items ?? []).filter((r) => r.kind !== 'bill').map((r): Item => ({ key: 'p' + r.id, id: r.entityId, k: KIND_OF[r.kind]!, stage: stageOf(r), step: 1 + r.atStep, title: r.title, who: r.submittedByName ?? '', amount: r.amountPaise, since: r.submittedAt, req: r })),
    ...(bks?.items ?? []).map((b): Item => ({ key: 'k' + b.id, id: b.id, k: 'book', stage: 2, step: 1, title: `${b.customerName} · ${fmtDay(b.date)}`, who: `${b.groundName} · ${timeRange(b)}`, amount: b.paidPaise, since: b.createdAt })),
    ...(pays?.items ?? []).map((p): Item => ({ key: 'u' + p.id, id: p.id, k: 'upi', stage: 1, step: 1, title: `UPI ${inr(p.amountPaise)}${p.reference ? ' · ' + p.reference : ''}`, who: '', amount: p.amountPaise, since: p.submittedAt ?? p.createdAt })),
  ];
  // A kind that only comes from the rules gets a tab once it has something in it.
  const kinds = (Object.keys(K) as Kind[]).filter((k) => all.some((x) => x.k === k) || (k === 'bill' && acct) || (k === 'pay' && boss) || (k === 'book' && books) || (k === 'upi' && upiOk));
  const vis = all.filter((x) => filter === 'all' || x.k === filter);
  const open = all.filter((x) => x.stage < 4);
  const cur = all.find((x) => x.key === sel) ?? vis.find((x) => x.stage < 4) ?? vis[0];
  const canDecide = (x: Item) => (x.req ? x.req.canSign : x.k === 'bill' ? x.stage === 2 && acct && (boss || x.bill?.createdBy !== me.id) : x.k === 'pay' ? false : x.k === 'book' ? books : upiOk);
  const chainOf = (x: Item): string[] => {
    if (!x.req) return CHAIN[x.k];
    const [by, end] = ENDS[x.k] ?? ['Entered by', 'Paid'];
    return [`${by} ${x.req.submittedByName ?? (x.k === 'pay' ? 'the owner' : x.k === 'refund' ? 'the system' : 'the team')}`, ...x.req.steps.map((st) => st.label), end];
  };
  const chainSub = (x: Item, i: number, done: boolean, now: boolean): string => {
    const st = x.req && i >= 1 ? x.req.steps[i - 1] : undefined;
    if (!st) return done ? 'Done' : now ? 'Waiting now' : 'Not yet';
    if (st.state === 'done') return `Signed by ${st.signedByName ?? 'someone'}${st.note ? `: "${st.note}"` : ''}`;
    return `${st.who}${st.overPaise ? `, for ${inr(st.overPaise)} or more` : ''} · ${st.state === 'now' ? 'Waiting now' : 'Not yet'}`;
  };
  const canSendBack = (x: Item) => x.k !== 'book';

  async function decide(x: Item, yes: boolean) {
    if (!yes && !note.trim()) { setMsg('Write a short note first, so the person knows what to fix.'); return; }
    setBusy(true); setMsg(null);
    try {
      if (x.k === 'bill') await post(`/api/accounting/bills/${x.id}/${yes ? 'approve' : 'reject'}`, yes ? (note.trim() ? { note: note.trim() } : {}) : { reason: note.trim() });
      else if (x.req) await post(`/api/accounting/approvals/requests/${x.req!.id}/${yes ? 'approve' : 'send-back'}`, note.trim() ? { note: note.trim() } : {});
      else if (x.k === 'book') await post(`/api/staff/bookings/${encodeURIComponent(x.id)}/approve`, {});
      else await post(`/api/staff/payments/${encodeURIComponent(x.id)}/verify`, yes ? { approve: true } : { approve: false, reason: note.trim() });
      const last = !x.req || x.req.atStep >= x.req.steps.length - 1;
      toast(yes ? (last ? 'Approved.' : 'Signed. It moves to the next step.') : 'Sent back.'); setNote(''); setSel(null); setV((n) => n + 1); s.refreshCounts();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  return (
    <div className="dap">
      <div className="dap-hd">
        <div><span className="eyebrow">Everything waiting on a decision · {s.me.businessName || 'Daji Cricket Ground'}</span><h1>Approvals</h1></div>
        <span className="muted">Waiting on you: {open.filter(canDecide).length} · <a href="#/approvals/bills">Bills table</a>{boss && <> · <a href="#/approvals/rules">Approval rules</a></>}</span>
      </div>
      <div role="tablist" className="dtabs">
        <button type="button" role="tab" aria-selected={filter === 'all'} className={`dchip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All · {open.length}</button>
        {kinds.map((k) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={`dchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{K[k].name} · {open.filter((x) => x.k === k).length}</button>)}
      </div>
      <ErrorBox msg={err} />
      {reqsErr && reqsStatus !== 403 && <ErrorBox msg={`Could not load the approval chains: ${reqsErr}`} />}
      {!loaded ? <Loading h={300} /> : (<>
        <div className="dap-stages">
          {ST.map((st, i) => <span key={st[0]} className={`dap-chev${i === 0 ? ' first' : ''}${i === 4 ? ' last' : ''}`} style={{ background: st[3], color: st[2] }}><b>{st[0]}</b><span>{vis.filter((x) => x.stage === i).length}</span></span>)}
        </div>
        <div className="dap-row">
          <div className="dap-board-wrap">
            <div className="dap-board">
              {ST.map((st, si) => (
                <div key={st[0]} className="dap-col" style={{ background: st[3] }}>
                  <span className="dap-who" style={{ color: st[2] }}>{st[1]}</span>
                  {vis.filter((x) => x.stage === si).map((x) => (
                    <button key={x.key} type="button" className={`dap-card${cur?.key === x.key ? ' on' : ''}`} onClick={() => { setSel(x.key); setMsg(null); }}>
                      <span className="dap-tag" style={{ color: K[x.k].ink, background: K[x.k].tint }}>{K[x.k].name}</span>
                      <b>{x.title}</b>
                      <span className="muted">{[x.amount != null ? inr(x.amount) : '', x.who].filter(Boolean).join(' · ')}</span>
                    </button>))}
                </div>))}
            </div>
            {!all.length && <p className="muted" style={{ margin: '10px 2px' }}>Nothing is waiting for a decision. New bills, bookings to approve, UPI payments to check, and refunds, discounts, fee waivers and expenses held by your rules show here.</p>}
          </div>
          {cur && (
            <aside aria-label="Selected approval" className="dcard dap-panel">
              <span className="dap-tag" style={{ color: K[cur.k].ink, background: K[cur.k].tint }}>{K[cur.k].name}</span>
              <h2>{cur.title}</h2>
              <span className="muted" style={{ fontSize: 14 }}>{[cur.amount != null ? inr(cur.amount) : '', cur.who].filter(Boolean).join(' · ')}</span>
              <div className="dap-facts">
                <div><span>Stage</span><b>{ST[cur.stage]![0]}</b></div>
                <div><span>{cur.stage === 4 ? 'Finished' : 'Waiting'}</span><b>{cur.stage === 4 ? 'Done' : age(cur.since)}</b></div>
              </div>
              <ol aria-label="Approval chain" className="dap-chain">
                {chainOf(cur).map((who, i, arr) => {
                  const done = i < cur.step, now = i === cur.step;
                  return (
                    <li key={`${i}-${who}`}>
                      <span className="dap-rail"><span className={`dap-mark${done ? ' done' : now ? ' now' : ''}`}>{done ? '✓' : i + 1}</span>{i < arr.length - 1 && <i className={done ? 'done' : ''} />}</span>
                      <span className="dap-step"><b>{who}</b><span className="muted">{chainSub(cur, i, done, now)}</span></span>
                    </li>);
                })}
              </ol>
              <span className="dap-rule">{cur.req ? cur.req.rule : RULE[cur.k]}</span>
              {cur.req && !cur.req.canSign && cur.req.whyNot && <span className="muted" style={{ fontSize: 13 }}>{cur.req.whyNot}.</span>}
              {canDecide(cur) ? (<>
                <div className="field" style={{ margin: 0 }}><label htmlFor="apNote">Note</label><textarea id="apNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="dap-acts">
                  <button type="button" className="dap-yes" disabled={busy} onClick={() => decide(cur, true)}>Approve</button>
                  {canSendBack(cur) && <button type="button" className="dap-no" disabled={busy} onClick={() => decide(cur, false)}>Send back</button>}
                  <a href={`#${cur.k === 'bill' ? `/bills/${cur.id}` : cur.k === 'book' ? `/bookings/${cur.id}` : K[cur.k].href}`} className="dap-open">Open</a>
                </div>
              </>) : <button type="button" className="dbtn" onClick={() => go(cur.k === 'bill' ? `/bills/${cur.id}` : K[cur.k].href)}>Open in {K[cur.k].name}</button>}
              {msg && <div className="err" style={{ margin: 0 }}>{msg}</div>}
              {cur.req && cur.req.trail.length > 0 && (
                <details className="dap-trail">
                  <summary>History · {cur.req.trail.length}</summary>
                  <ol>{cur.req.trail.map((e) => <li key={e.id}><b>{ACT[e.action] ?? e.action}</b> <span className="muted">{e.actorName ?? 'System'} · {fmtDateTime(e.at)}</span>{(e.detail?.note || e.detail?.reason) && <span className="muted">"{e.detail.note || e.detail.reason}"</span>}</li>)}</ol>
                </details>)}
            </aside>)}
        </div>
      </>)}
    </div>
  );
}
