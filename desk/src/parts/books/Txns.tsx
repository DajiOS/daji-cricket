// The bank transactions list: account cards, pending/posted tabs, filters, inline categories, receipts, edit.
import { useEffect, useState } from 'react';
import { api, qs, inr, fmtDate, useApi, patch } from '../../lib';
import { Tabs, Chip, ErrorBox, Loading, useToast, Icon, Filters } from '../../ui';
import { Grid, CatSelect, ExportBar, useShared } from './kit';
import { AddTxnDialog, TransferDialog, EditTxnDialog, FilesDialog } from './dialogs';

const LIMIT = 50;
type Tab = 'pending' | 'posted' | 'all';

export function Txns({ initialTab = 'pending', initialAccount = '', actions }: { initialTab?: Tab; initialAccount?: string; actions?: (a: { add: () => void; move: () => void }) => void }) {
  const sh = useShared();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [accountId, setAccountId] = useState(initialAccount);
  const [f, setF] = useState({ q: '', from: '', to: '', direction: '' });
  const [q, setQ] = useState(f.q);
  const [offset, setOffset] = useState(0);
  const [dlg, setDlg] = useState<null | 'add' | 'move' | { edit: any } | { files: any }>(null);
  const toast = useToast();
  useEffect(() => { const t = setTimeout(() => { setF((s) => ({ ...s, q })); setOffset(0); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { actions?.({ add: () => setDlg('add'), move: () => setDlg('move') }); }, []);
  const status = tab === 'pending' ? 'no' : tab === 'posted' ? 'yes' : '';
  const filters = { accountId, categorised: status, direction: f.direction, q: f.q.trim(), from: f.from, to: f.to };
  const [r, e, reload] = useApi<any>('/api/accounting/transactions' + qs({ limit: LIMIT, offset, ...filters }));
  const [cnt, setCnt] = useState<Record<string, number>>({});
  useEffect(() => { if (!r?.items?.length) { setCnt({}); return; } api('/api/accounting/attachment-counts', { method: 'POST', body: { entity: 'transaction', ids: r.items.map((t: any) => t.id) } }).then(setCnt).catch(() => {}); }, [r]);
  const refresh = () => { reload(); sh.reload(); };
  const setCat = async (t: any, categoryId: string) => { try { await patch('/api/accounting/transactions/' + t.id, { categoryId: categoryId || null }); toast('Saved'); refresh(); } catch (x: any) { toast(x.message); } };
  const upd = (k: string, v: string) => { setF((s) => ({ ...s, [k]: v })); setOffset(0); };

  const totalAll = sh.accounts.reduce((s, a) => s + a.balancePaise, 0), pendAll = sh.accounts.reduce((s, a) => s + a.uncategorised, 0);
  const card = (id: string, name: string, bal: number, n: number) => (
    <button key={id} className={`bk-acct${accountId === id ? ' on' : ''}`} onClick={() => { setAccountId(id); setOffset(0); }}>
      <span className="bk-acct-t"><span>{name}</span>{n ? <Chip tone="warn">{n}</Chip> : <Chip tone="good">ok</Chip>}</span>
      <b>{inr(bal)}</b>
    </button>
  );
  return (
    <div className="stack">
      <ErrorBox msg={sh.error} />
      <div className="bk-accts">{card('', 'All accounts', totalAll, pendAll)}{sh.accounts.map((a) => card(a.id, a.name, a.balancePaise, a.uncategorised))}</div>
      <Tabs value={tab} onChange={(v) => { setTab(v); setOffset(0); }} items={[['pending', 'Pending'], ['posted', 'Posted'], ['all', 'All']]} label="Status" />
      <div className="card">
        <div className="bk-tool">
          <input className="inp" type="search" placeholder="Search description" aria-label="Search description" value={q} onChange={(e) => setQ(e.target.value)} />
          <Filters active={[f.from, f.to, f.direction].filter(Boolean).length}>
          <input className="inp" type="date" aria-label="From date" value={f.from} onChange={(e) => upd('from', e.target.value)} />
          <input className="inp" type="date" aria-label="To date" value={f.to} onChange={(e) => upd('to', e.target.value)} />
          <select className="inp" aria-label="Direction" value={f.direction} onChange={(e) => upd('direction', e.target.value)}><option value="">All transactions</option><option value="in">Money in</option><option value="out">Money out</option></select>
          </Filters>
          <ExportBar path={() => '/api/accounting/transactions/export' + qs(filters)} name={() => 'bank-transactions'} />
        </div>
        {e ? <ErrorBox msg={e} /> : !r ? <Loading /> : (
          <>
            <div className="card-pad muted small" style={{ paddingBottom: 8, paddingTop: 12 }}>{r.total} transaction{r.total === 1 ? '' : 's'} · Received <b className="strong">{inr(r.moneyInPaise)}</b> · Spent <b className="strong">{inr(Math.abs(r.moneyOutPaise))}</b></div>
            <Grid heads={['Date', 'Bank description', 'Spent', 'Received', 'Receipt', 'Category', '']} nums={[2, 3]}
              empty={tab === 'pending' ? 'Nothing is waiting. Every transaction here has a category.' : 'No transactions match.'}
              rows={r.items.map((t: any) => [
                <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</span>,
                <span>{t.description}{t.reference && <span className="muted small bk-mono"> {t.reference}</span>}{t.note && <div className="muted small">{t.note}</div>}</span>,
                t.amountPaise < 0 ? inr(-t.amountPaise) : '', t.amountPaise > 0 ? inr(t.amountPaise) : '',
                <button className="btn sm ghost" onClick={() => setDlg({ files: t })}><Icon name="upload" />{cnt[t.id] ? `Files (${cnt[t.id]})` : 'Add file'}</button>,
                t.paymentId ? <Chip tone="good">Matched to a booking</Chip> : <CatSelect className="inp sm" cats={sh.categories} value={t.categoryId || ''} onChange={(v) => setCat(t, v)} blank="Select category" />,
                <button className="btn sm ghost" aria-label="Edit" onClick={() => setDlg({ edit: t })}><Icon name="edit" /></button>])} />
            <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
              <button className="btn sm ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
              <span className="muted small">{r.total ? offset + 1 : 0} to {Math.min(offset + LIMIT, r.total)} of {r.total}</span>
              <button className="btn sm ghost" disabled={offset + LIMIT >= r.total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
            </div>
          </>)}
      </div>
      {dlg === 'add' && <AddTxnDialog accounts={sh.accounts} cats={sh.categories} onClose={() => setDlg(null)} done={() => { toast('Added'); refresh(); }} />}
      {dlg === 'move' && <TransferDialog accounts={sh.accounts} onClose={() => setDlg(null)} done={() => { toast('Moved'); refresh(); }} />}
      {dlg && typeof dlg === 'object' && 'edit' in dlg && <EditTxnDialog t={dlg.edit} cats={sh.categories} onClose={() => setDlg(null)} done={refresh} />}
      {dlg && typeof dlg === 'object' && 'files' in dlg && <FilesDialog entity="transaction" id={dlg.files.id} title={dlg.files.description} onClose={() => setDlg(null)} done={() => reload()} />}
    </div>
  );
}
