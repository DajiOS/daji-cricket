// Reconcile, recurring entries, journal entries, month sign-off and setup (accounts, rules, GST).
import { useEffect, useState } from 'react';
import { api, post, put, patch, del, inr, fmtDate, thisMonth, addDaysISO } from '../../lib';
import { Field, Chip, ErrorBox, Loading, Empty, useToast, Icon } from '../../ui';
import { Grid, Money, Section, Note, Load, useShared, useAct, monthName } from './kit';
import { RecDialog, JournalDialog, ReasonDialog, FilesDialog, AccountDialog, RuleDialog } from './dialogs';

export function Reconcile() {
  const act = useAct();
  return (
    <Load<any> path="/api/accounting/reconcile">{(r, reload) => (
      <div className="stack">
        <Section title="Do the books agree with the bank?" pad={false}>
          <Grid heads={['Account', 'Books say', 'Last statement says', 'Difference', 'Uncategorised']} nums={[1, 2, 3, 4]} empty="No bank accounts yet."
            rows={r.accounts.map((a: any) => [a.name, inr(a.booksBalancePaise), a.statementBalancePaise === null ? 'No statement balance' : `${inr(a.statementBalancePaise)} on ${fmtDate(a.statementDate)}`,
              a.differencePaise === null ? '' : a.differencePaise === 0 ? <Chip tone="good">Matches</Chip> : <Chip tone="bad">{a.differencePaise < 0 ? '−' : '+'}{inr(Math.abs(a.differencePaise))}</Chip>, a.uncategorised])} />
        </Section>
        <Section title={`Deposits waiting to be matched (${r.rows.length})`} aside={<button className="btn sm primary" onClick={async () => { await act(() => post('/api/accounting/reconcile/auto', {}).then((x) => { reload(); return x; }), (x) => `${x.matched} matched, ${x.left} left`); }}>Run automatic matching</button>}>
          <Note>{r.unmatchedPayments} UPI or bank-transfer booking payments have no bank deposit yet. Matching is automatic after every statement import when the 12-digit UTR and the amount agree. Anything less certain is shown here for you to confirm.</Note>
          {!r.rows.length ? <Empty>Every bank deposit is matched or categorised.</Empty> : r.rows.map((x: any) => (
            <div className="bk-rec" key={x.txnId}>
              <div><b className="strong">{inr(x.amountPaise)} · {fmtDate(x.date)}</b><div className="muted small">{x.description}</div><div className="muted small">{x.accountName}</div></div>
              <div>{x.candidates.length ? x.candidates.map((c: any) => (
                <div className="bk-li" key={c.paymentId}><span>{c.customerName || 'Customer'} · {c.method === 'upi' ? 'UPI' : 'Bank transfer'} · paid {fmtDate(c.paidOn)} <Chip tone={c.strength === 'utr' ? 'good' : 'mute'}>{c.strength === 'utr' ? 'UTR matches' : 'Same amount'}</Chip></span>
                  <button className="btn sm primary" onClick={() => act(() => post(`/api/accounting/transactions/${x.txnId}/match`, { paymentId: c.paymentId }).then(reload), () => 'Matched')}>Match</button></div>))
                : <span className="muted small">No booking payment of this amount. It may be a deposit that is not a booking: categorise it under Transactions.</span>}</div>
            </div>))}
        </Section>
      </div>)}</Load>
  );
}

const FREQ: Record<string, string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
export function Recurring() {
  const sh = useShared(); const act = useAct(); const [add, setAdd] = useState(false);
  return (
    <Load<any> path="/api/accounting/recurring">{(r, reload) => (
      <Section title="Recurring entries" aside={<>
        <button className="btn sm" onClick={() => act(() => post('/api/accounting/recurring/run', {}).then((x) => { reload(); return x; }), (x) => `${x.posted} posted` + (x.skippedLocked ? `, ${x.skippedLocked} skipped (month signed off)` : ''))}>Post what is due now</button>
        <button className="btn sm primary" onClick={() => setAdd(true)}><Icon name="plus" />Add a recurring entry</button></>} pad={false}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><Note>Rent, salaries, loan instalments and other regular amounts are posted for you on their due dates. Months you have signed off are never changed.</Note></div>
        <Grid heads={['What', 'Account', 'How often', 'Next', 'Amount', '']} nums={[4]} empty="No recurring entries yet."
          rows={r.items.map((i: any) => [<span>{i.description} {!i.active && <Chip>Paused</Chip>}</span>, i.accountName, FREQ[i.frequency], i.nextDate ? fmtDate(i.nextDate) : 'Finished', <Money p={i.amountPaise} />,
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => act(() => patch('/api/accounting/recurring/' + i.id, { active: !i.active }).then(reload))}>{i.active ? 'Pause' : 'Resume'}</button><button className="btn sm ghost" onClick={() => act(() => del('/api/accounting/recurring/' + i.id).then(reload))}>Delete</button></span>])} />
        {add && <RecDialog accounts={sh.accounts} cats={sh.categories} onClose={() => setAdd(false)} done={reload} />}
      </Section>)}</Load>
  );
}

export function Journals() {
  const [add, setAdd] = useState(false); const [files, setFiles] = useState<any>(null); const [voiding, setVoiding] = useState<any>(null);
  return (
    <Load<any> path="/api/accounting/journals?limit=50">{(r, reload) => (
      <Section title="Journal entries" aside={<button className="btn sm primary" onClick={() => setAdd(true)}><Icon name="plus" />New journal entry</button>} pad={false}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><Note>For adjustments an accountant makes: depreciation, an owner putting money in, a correction. Each entry must balance. A wrong entry is voided, never deleted.</Note></div>
        <Grid heads={['Date', 'Memo', 'Lines', 'Total', '']} nums={[3]} empty="No journal entries."
          rows={r.items.map((j: any) => ({ cls: j.deletedAt ? 'dim' : undefined, cells: [fmtDate(j.date), <span>{j.memo} {j.deletedAt && <Chip tone="bad">Voided</Chip>}</span>,
            <span className="muted small">{j.lines.map((l: any) => `${l.accountName} ${l.debitPaise ? 'Dr ' + inr(l.debitPaise) : 'Cr ' + inr(l.creditPaise)}`).join('; ')}</span>, inr(j.totalPaise),
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setFiles(j)}>Files</button>{!j.deletedAt && <button className="btn sm ghost" onClick={() => setVoiding(j)}>Void</button>}</span>] }))} />
        {add && <JournalDialog onClose={() => setAdd(false)} done={reload} />}
        {files && <FilesDialog entity="journal" id={files.id} title={files.memo} onClose={() => setFiles(null)} />}
        {voiding && <ReasonDialog title="Void this entry" lede={voiding.memo} label="Void entry" path={`/api/accounting/journals/${voiding.id}/void`} body={(reason) => ({ reason })} onClose={() => setVoiding(null)} done={reload} />}
      </Section>)}</Load>
  );
}

/** Month sign-off: freezes a month, keeps the profit and loss at that moment, and holds a note for it. */
export function MonthEnd() {
  const act = useAct(); const toast = useToast();
  const [month, setMonth] = useState(addDaysISO(thisMonth() + '-01', -1).slice(0, 7));
  const [memo, setMemo] = useState(''); const [reopen, setReopen] = useState<string | null>(null);
  useEffect(() => { let live = true; api('/api/accounting/memos/' + month).then((m) => live && setMemo(m.body || '')).catch(() => live && setMemo('')); return () => { live = false; }; }, [month]);
  return (
    <Load<any> path="/api/accounting/signoffs">{(r, reload) => (
      <div className="stack">
        <Section title="Sign off a month">
          <Note>Signing off freezes the month: nothing dated in it can be added, changed or imported until you re-open it. The profit and loss at that moment is kept on record.</Note>
          <div className="form-grid">
            <Field label="Month"><input className="inp" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            <div className="row" style={{ alignItems: 'flex-end' }}><button className="btn primary" onClick={() => act(() => post('/api/accounting/signoffs', { month }).then(reload), () => `${monthName(month)} signed off`)}>Sign off {month ? monthName(month) : ''}</button></div>
            <Field label="Month note" full><textarea className="inp" placeholder="Notes for this month (for you and your accountant)" value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn sm" onClick={() => act(() => put('/api/accounting/memos/' + month, { body: memo.trim() }), () => 'Note saved')}>Save note</button></div>
        </Section>
        <Section title="Signed-off months" pad={false}>
          <Grid heads={['Month', 'Revenue', 'Expenses', 'Net profit', '']} nums={[1, 2, 3]} empty="No months signed off yet."
            rows={r.items.map((s: any) => [monthName(s.month), s.revenuePaise === null ? '' : inr(s.revenuePaise), s.expensesPaise === null ? '' : inr(s.expensesPaise), s.netProfitPaise === null ? '' : inr(s.netProfitPaise),
              s.reopenedAt ? <Chip>Re-opened</Chip> : <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Chip tone="good">Locked</Chip><button className="btn sm ghost" onClick={() => setReopen(s.month)}>Re-open</button></span>])} />
        </Section>
        {reopen && <ReasonDialog title={`Re-open ${monthName(reopen)}`} lede="The reason is kept in the audit log." label="Re-open month" path="/api/accounting/signoffs/reopen" body={(reason) => ({ month: reopen, reason })} onClose={() => setReopen(null)} done={() => { toast('Re-opened'); reload(); }} />}
      </div>)}</Load>
  );
}

const MATCH: Record<string, string> = { contains: 'contains', starts_with: 'starts with', equals: 'is', regex: 'matches' };
const DIR: Record<string, string> = { any: 'Either', in: 'Money in', out: 'Money out' };
export function Setup() {
  const sh = useShared(); const act = useAct(); const [dlg, setDlg] = useState<null | 'account' | 'rule'>(null);
  const [gst, setGst] = useState<string | null>(null);
  return (
    <Load<{ items: any[] }> path="/api/accounting/rules">{(rules: any, reloadRules) => (
      <Load<any> path="/api/accounting/settings">{(st) => (
        <div className="stack">
          <ErrorBox msg={sh.error} />
          <Section title="Bank and cash accounts" aside={<button className="btn sm primary" onClick={() => setDlg('account')}><Icon name="plus" />Add an account</button>} pad={false}>
            <Grid heads={['Account', 'Kind', 'Balance', 'Transactions', 'Uncategorised']} nums={[2, 3, 4]} empty="No accounts yet."
              rows={sh.accounts.map((a) => [a.name + (a.bankName ? ` · ${a.bankName}` : ''), a.kind === 'cash' ? 'Cash' : a.holds === 'card' ? 'Credit card' : a.holds === 'loan' ? 'Loan' : 'Bank', inr(a.balancePaise), a.transactions, a.uncategorised])} />
          </Section>
          <CoaPanel onChange={sh.reload} />
          <Section title="Rules that categorise bank lines" pad={false} aside={<>
            <button className="btn sm" onClick={() => act(() => post('/api/accounting/rules/apply', {}), (x) => `${x.categorised} of ${x.checked} categorised`)}>Apply rules to uncategorised lines</button>
            <button className="btn sm primary" onClick={() => setDlg('rule')}><Icon name="plus" />Add a rule</button></>}>
            <div className="card-pad" style={{ paddingBottom: 0 }}><Note>When a bank line contains the words you choose, it gets the category you choose. Rules run on every import and never override a category you set yourself.</Note></div>
            <Grid heads={['When the text', 'Direction', 'Category', '']} empty="No rules yet."
              rows={rules.items.map((x: any) => [`${MATCH[x.matchType]} “${x.pattern}”`, DIR[x.direction], x.categoryName, <button className="btn sm ghost" onClick={() => act(() => del('/api/accounting/rules/' + x.id).then(reloadRules))}>Delete</button>])} />
          </Section>
          <Section title="GST">
            <Note>If your booking prices include GST, enter the rate and the reports separate it. Leave at 0 if you do not charge GST.</Note>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="GST rate (%)"><input className="inp" type="number" min={0} max={28} style={{ width: 140 }} value={gst ?? st.gstPercent} onChange={(e) => setGst(e.target.value)} /></Field>
              <button className="btn primary" onClick={() => act(() => patch('/api/accounting/settings', { gstPercent: Number(gst ?? st.gstPercent) }), () => 'Saved')}>Save</button>
            </div>
          </Section>
          {dlg === 'account' && <AccountDialog onClose={() => setDlg(null)} done={sh.reload} />}
          {dlg === 'rule' && <RuleDialog cats={sh.categories} onClose={() => setDlg(null)} done={reloadRules} />}
        </div>)}</Load>)}</Load>
  );
}

/** Chart of accounts: rename, make inactive, or delete what was never used. */
function CoaPanel({ onChange }: { onChange: () => void }) {
  const act = useAct();
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [showOff, setShowOff] = useState(true);
  return (
    <Load<{ items: any[] }> path="/api/accounting/coa">{(d, reload) => {
      const done = () => { reload(); onChange(); };
      const items = d.items.filter((x) => showOff || x.active);
      const label = (x: any) => edit?.id === x.id
        ? <span className="row" style={{ gap: 6 }}>
            <input className="inp" autoFocus value={edit!.name} onChange={(e) => setEdit({ id: x.id, name: e.target.value })} style={{ width: 220 }} />
            <button className="btn sm primary" onClick={async () => { if (await act(() => patch('/api/accounting/coa/' + x.id, { name: edit!.name }), () => 'Renamed')) { setEdit(null); done(); } }}>Save</button>
            <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></span>
        : <span>{x.name}{x.active ? '' : ' (Inactive)'}</span>;
      return (
        <Section title="Chart of accounts" pad={false} aside={<label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Show inactive</label>}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><Note>Rename anything. Make an account inactive when you stop using it: it stays in reports for the dates that have entries, tagged (Inactive), and takes no new entries. A bank or cash account can go inactive only when its balance is zero. Delete works only on what was never used.</Note></div>
          <Grid heads={['Account', 'Type', 'Used', 'Balance', 'Status', '']} nums={[2, 3]} empty="Nothing to show."
            rows={items.map((x) => [label(x), x.type === 'account' ? (x.kind === 'cash' ? 'Cash' : x.holds === 'card' ? 'Credit card' : x.holds === 'loan' ? 'Loan' : 'Bank') : x.kind === 'income' ? 'Income' : 'Expense', x.uses ? `${x.uses} use${x.uses === 1 ? '' : 's'}` : 'Never',
              x.balancePaise === null ? '' : inr(x.balancePaise), x.active ? 'Active' : 'Inactive',
              <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn sm ghost" onClick={() => setEdit({ id: x.id, name: x.name })}>Rename</button>
                {x.active
                  ? <button className="btn sm ghost" title={x.deactivateBlock ?? ''} disabled={!x.canDeactivate} onClick={async () => { if (await act(() => patch('/api/accounting/coa/' + x.id, { active: false }), () => 'Made inactive')) done(); }}>Make inactive</button>
                  : <button className="btn sm ghost" onClick={async () => { if (await act(() => patch('/api/accounting/coa/' + x.id, { active: true }), () => 'Active again')) done(); }}>Make active</button>}
                <button className="btn sm ghost" title={x.deleteBlock ?? ''} disabled={!x.canDelete} onClick={async () => { if (await act(() => del('/api/accounting/coa/' + x.id), () => 'Deleted')) done(); }}>Delete</button>
              </span>])} />
        </Section>);
    }}</Load>
  );
}
