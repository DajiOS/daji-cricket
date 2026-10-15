// Small shared pieces for the accounting screens: money, tables, export menu, form dialog, shared lookups.
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { api, useApi, inr, download, todayISO, addDaysISO } from '../../lib';
import { Modal, Icon, ErrorBox, Loading, Empty, useToast } from '../../ui';

export interface Account { id: string; name: string; kind: string; bankName?: string | null; balancePaise: number; transactions: number; uncategorised: number }
export interface Category { id: string; name: string; group: string; kind: string }

/** Bank accounts and categories, used by several screens. */
export function useShared() {
  const [a, ea, ra] = useApi<{ items: Account[] }>('/api/accounting/accounts');
  const [c, ec, rc] = useApi<{ items: Category[] }>('/api/accounting/categories');
  return { accounts: a?.items ?? [], categories: c?.items ?? [], ready: !!a && !!c, error: ea || ec, reload: () => { ra(); rc(); } };
}
export const catOptions = (cats: Category[]) => [...cats.filter((c) => c.kind !== 'booking_receipt'), ...cats.filter((c) => c.kind === 'booking_receipt')];
export function CatSelect({ cats, value, onChange, blank, className = 'inp' }: { cats: Category[]; value: string; onChange: (v: string) => void; blank: string; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Category">
      <option value="">{blank}</option>
      {catOptions(cats).map((c) => <option key={c.id} value={c.id}>{c.group}: {c.name}</option>)}
    </select>
  );
}

export const Money = ({ p }: { p: number }) => <span className="amt" style={p < 0 ? { color: 'var(--bad)' } : undefined}>{p < 0 ? '−' : ''}{inr(Math.abs(p))}</span>;
export const monthName = (m: string) => { const [y, mo] = m.split('-').map(Number); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo! - 1] + ' ' + y; };
export const monthAdd = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y!, mo! - 1 + n, 1)).toISOString().slice(0, 7); };
export const lastDayOf = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y!, mo!, 0)).toISOString().slice(0, 10); };
export const fyStart = () => { const t = todayISO(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
export { addDaysISO };

export interface GRow { cls?: string; cells: ReactNode[] }
/** A table whose rows may carry a style (group heading, subtotal, net line). `nums` are right-aligned column numbers. */
export function Grid({ heads, rows, nums = [], empty = 'Nothing here yet.' }: { heads: string[]; rows: (GRow | ReactNode[])[]; nums?: number[]; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="tbl-wrap"><table className="tbl bk-tbl">
      <thead><tr>{heads.map((h, i) => <th key={i} className={nums.includes(i) ? 'num right' : ''}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => { const row = Array.isArray(r) ? { cells: r } : r; return (
        <tr key={i} className={row.cls ? 'bk-' + row.cls : ''}>{row.cells.map((c, j) => <td key={j} className={nums.includes(j) ? 'num right' : ''}>{c}</td>)}</tr>); })}</tbody>
    </table></div>
  );
}

/** Loads a path and shows loading and error states; children get the data. */
export function Load<T>({ path, deps, children }: { path: string | null; deps?: unknown[]; children: (d: T, reload: () => void) => ReactNode }) {
  const [d, e, reload] = useApi<T>(path, deps);
  if (e) return <ErrorBox msg={e} />;
  if (!d) return <Loading />;
  return <>{children(d, reload)}</>;
}

/** Print and export (PDF, Excel, CSV) for a report. */
export function ExportBar({ path, name }: { path: () => string; name: () => string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; addEventListener('mousedown', f); return () => removeEventListener('mousedown', f); }, [open]);
  const get = (f: string) => { setOpen(false); const p = path(); download(p + (p.includes('?') ? '&' : '?') + 'format=' + f, `${name()}.${f}`).catch((e) => toast(e.message)); };
  return (
    <div className="row no-print" style={{ gap: 6 }} ref={box}>
      <button className="btn sm" onClick={() => window.print()}><Icon name="print" />Print</button>
      <div className="bk-menu-wrap">
        <button className="btn sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="download" />Export</button>
        {open && <div className="bk-menu" role="menu">{[['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']].map(([f, l]) => <button key={f} role="menuitem" onClick={() => get(f!)}>{l}</button>)}</div>}
      </div>
    </div>
  );
}

/** A dialog around a form: shows the error, disables the button while saving. `onSubmit` throws to show an error, returns to close. */
export function FormModal({ title, lede, onClose, onSubmit, label = 'Save', wide, children, extraFoot }: { title: string; lede?: ReactNode; onClose: () => void; onSubmit: () => Promise<void>; label?: string; wide?: boolean; children: ReactNode; extraFoot?: ReactNode }) {
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async (e?: { preventDefault: () => void }) => { e?.preventDefault(); setErr(null); setBusy(true); try { await onSubmit(); onClose(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} wide={wide} foot={<>{extraFoot}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => go()}>{busy ? 'Saving…' : label}</button></>}>
      <form onSubmit={go}>
        {lede && <p className="muted small" style={{ marginTop: 0 }}>{lede}</p>}
        {children}
        {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export const Section = ({ title, aside, children, pad = true }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: boolean }) => (
  <div className="card">
    {(title || aside) && <div className="card-head"><h3>{title}</h3>{aside && <div className="row">{aside}</div>}</div>}
    <div className={pad ? 'card-pad' : ''}>{children}</div>
  </div>
);
export const Note = ({ children }: { children: ReactNode }) => <p className="muted small" style={{ margin: '0 0 14px' }}>{children}</p>;

/** Runs an action, shows a toast with the result or the error. */
export function useAct() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, msg?: (r: any) => string) => { try { const r = await fn(); if (msg) toast(msg(r)); return true; } catch (e: any) { toast(e.message); return false; } };
}
export { api };
