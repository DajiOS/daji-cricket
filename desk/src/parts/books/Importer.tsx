// Bank statement import: an always-visible upload box (PDF, Excel, CSV), a dry-run preview, then confirm. A past import can be removed, with its transactions.
import { useRef, useState } from 'react';
import { api, sendFile, useApi, fmtDate, inr, fmtDateTime } from '../../lib';
import { Field, Chip, ErrorBox, Loading, useToast, Icon, Confirm } from '../../ui';
import { Section, Note, Grid, Money, useShared } from './kit';
import { AccountDialog } from './dialogs';
import { FeedPanel } from './Feed';
import { AccountAggregator } from './AccountAggregator';

const TAG: Record<string, [string, string]> = { new: ['good', 'New'], duplicate: ['mute', 'Already have'], locked: ['warn', 'Month closed'] };
let waiting: File | null = null; // a statement chosen before any account existed

export function Importer() {
  const sh = useShared();
  const [accountId, setAccountId] = useState('');
  const [adding, setAdding] = useState(false);
  const [cur, setCur] = useState<File | null>(null);
  const [pass, setPass] = useState(''); const [needPass, setNeedPass] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ msg: string; code?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null); const [sure, setSure] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null); const seq = useRef(0);
  const [hist, he, reloadHist] = useApi<{ items: any[] }>('/api/accounting/imports');
  const toast = useToast();
  const acct = accountId || sh.accounts[0]?.id || '';

  const url = (f: File, extra: string, a = acct) => `/api/accounting/imports?accountId=${a}&filename=${encodeURIComponent(f.name)}${extra}`;
  const hdr = (p: string) => (p ? { 'x-statement-password': p } : undefined);
  const read = async (f: File | undefined, o: { pass?: string; account?: string } = {}) => {
    if (!f) return; setCur(f); setPreview(null); setDone(null); setErr(null); setSure(false);
    const a = o.account ?? acct;
    if (!a) { waiting = f; setAdding(true); return; }
    if (f.size > 16 * 1024 * 1024) return setErr({ msg: 'That file is over 16 MB. Download the statement in smaller periods.' });
    const mine = ++seq.current; setBusy(true);
    try { const r = await sendFile(url(f, '&dryRun=1', a), f, hdr(o.pass ?? pass)); if (mine !== seq.current) return; setNeedPass(false); setPreview(r); }
    catch (e: any) { if (mine !== seq.current) return; if (e.code === 'PDF_PASSWORD_REQUIRED' || e.code === 'PDF_PASSWORD_WRONG') setNeedPass(true); setErr({ msg: e.message, code: e.code }); }
    finally { if (mine === seq.current) setBusy(false); }
  };
  const commit = async () => {
    if (!cur) return;
    if (preview?.reviewRequired && !sure) { toast('Tick “I have checked the rows above” first.'); return; }
    setBusy(true);
    try {
      const r = await sendFile(url(cur, preview?.reviewRequired ? '&confirm=1' : ''), cur, hdr(pass));
      setDone(`Imported ${r.rowsNew} transactions. ${r.autoMatched} UPI or bank payments were matched to bookings automatically.`);
      setPreview(null); setCur(null); setPass(''); setNeedPass(false); if (input.current) input.current.value = ''; toast('Statement imported'); reloadHist(); sh.reload();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const remove = async (i: any) => { try { const x = await api(`/api/accounting/imports/${i.id}/remove`, { method: 'POST', body: {} }); toast(x.removed ? `Removed the statement and its ${x.removed} transactions` : 'Removed the statement'); reloadHist(); sh.reload(); } catch (e: any) { toast(e.message); } };
  const accountAdded = async () => { sh.reload(); const f = waiting; waiting = null; if (!f) return; try { const a = await api('/api/accounting/accounts'); if (a.items[0]) { setAccountId(a.items[0].id); read(f, { account: a.items[0].id }); } } catch { /* the person can choose the file again */ } };

  const r = preview;
  const ok = r?.reconcile && r.reconcile.checked > 0 && r.reconcile.mismatched === 0;
  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <FeedPanel onAccountAdded={accountAdded} />
      <AccountAggregator />
      <Section title="Load a bank statement">
        <Note>For banks with no bank feed: download the statement as PDF, Excel or CSV and drop it here. It is read straight away and checked against the balance column, and you see a preview first. Loading the same lines twice is safe: they are recognised and skipped.</Note>
        <ErrorBox msg={sh.error} />
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <Field label="Bank account">
            <select className="inp" value={acct} onChange={(e) => { setAccountId(e.target.value); if (cur) read(cur, { account: e.target.value }); }}>
              {sh.accounts.length ? sh.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>) : <option value="">No bank account yet</option>}
            </select>
          </Field>
        </div>
        <div className={`dropzone${over ? ' over' : ''}${cur ? ' has' : ''}`} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]); }}>
          <Icon name="upload" size={26} />
          <b>{cur ? cur.name : 'Drop a statement here, or click to choose'}</b>
          <span className="muted small">PDF, Excel or CSV. It is read the moment you choose it.</span>
        </div>
        <input ref={input} type="file" hidden accept=".pdf,.csv,.xlsx,application/pdf,text/csv" onChange={(e) => read(e.target.files?.[0])} />
        {needPass && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="This PDF is password protected">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="inp" type="password" autoComplete="off" autoFocus placeholder="PDF password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && read(cur ?? undefined, { pass })} />
                <button className="btn primary" disabled={busy} onClick={() => (pass ? read(cur ?? undefined, { pass }) : setErr({ msg: 'Type the PDF password first. Banks often use your date of birth or customer ID.' }))}>Open</button>
              </div>
            </Field>
          </div>)}
        <div style={{ marginTop: 14 }}>
          {busy && !r && <Loading h={70} />}
          {err && <div className="err" role="alert">{err.msg}</div>}
          {done && <div className="ok-box">{done}</div>}
          {r && (
            <div className="stack">
              <div className="eyebrow" style={{ margin: 0 }}>Preview of {cur?.name}. Nothing is saved yet</div>
              {r.reconcile?.checked > 0 && <div className={ok ? 'ok-box' : 'err'}>{ok ? `Balance check passed: all ${r.reconcile.checked} rows agree with the balance column.` : `Balance check failed on ${r.reconcile.mismatched} of ${r.reconcile.checked} rows (first at line ${r.reconcile.firstBadLine}).`}</div>}
              <div className="stmt-stats">
                <div><div className="label">New</div><div className="v">{r.rowsNew}</div></div>
                <div><div className="label">Already have</div><div className="v">{r.rowsDuplicate}</div></div>
                <div><div className="label">Not read</div><div className="v">{r.rowsSkipped}</div></div>
                <div><div className="label">Auto-categorised</div><div className="v">{r.categorisedByRules}</div></div>
              </div>
              {r.periodFrom && <div className="muted small">Period {fmtDate(r.periodFrom)} to {fmtDate(r.periodTo)}</div>}
              {r.warnings.map((w: string, i: number) => <div key={i} className="err">{w}</div>)}
              <Grid heads={['Date', 'Description', 'Amount', 'Balance', '']} nums={[2, 3]}
                rows={r.preview.map((x: any) => ({ cls: x.status === 'new' ? '' : 'dim', cells: [fmtDate(x.date), x.description, <Money p={x.amountPaise} />, x.balancePaise == null ? '' : inr(x.balancePaise), <Chip tone={(TAG[x.status] || ['mute', x.status])[0] as any}>{(TAG[x.status] || ['mute', x.status])[1]}</Chip>] }))} />
              {r.rowsTotal > r.preview.length && <div className="muted small">Showing the first {r.preview.length} rows. All rows are imported.</div>}
              {r.skipped.length > 0 && <div className="muted small">Not read: {r.skipped.slice(0, 5).map((s: any) => `line ${s.line} (${s.reason})`).join(', ')}{r.skipped.length > 5 ? '…' : ''}</div>}
              {r.reviewRequired && <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I have checked the rows above against my statement</label>}
              {r.rowsNew ? <div><button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={commit}>Import {r.rowsNew} new transaction{r.rowsNew === 1 ? '' : 's'}</button></div> : <div className="muted">Nothing new to import.</div>}
            </div>)}
        </div>
      </Section>
      <Section title="Statements loaded" pad={false}>
        {he ? <ErrorBox msg={he} /> : !hist ? <Loading h={80} /> : (
          <Grid heads={['Loaded', 'File', 'Account', 'New', 'Skipped duplicates', '']} nums={[3, 4]} empty="No statements loaded yet."
            rows={hist.items.map((i) => [fmtDateTime(i.createdAt), i.filename || '', i.accountName, i.rowsNew, i.rowsDuplicate, <Confirm className="btn sm ghost" label="Remove" ask={`Remove it and its ${i.rowsNew} transactions?`} onYes={() => remove(i)} />])} />)}
      </Section>
      {adding && <AccountDialog onClose={() => { setAdding(false); }} done={accountAdded} />}
    </div>
  );
}
