// Small helpers shared by the Academy, Matches, Contacts and Tasks pages.
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorBox, Icon, Loading } from '../../ui';
import { ApiError } from '../../lib';

/** Error text for a toast or an inline box, with the server's field messages appended. */
export function errMsg(e: unknown): string {
  const x = e as ApiError | undefined;
  const fields = (x?.details as { fields?: { message: string }[] } | undefined)?.fields;
  return (x?.message || 'Something went wrong.') + (fields?.length ? ' ' + fields.map((f) => f.message).join('. ') : '');
}
export const forbidden = (m: string | null) => (m && /permission|role|forbidden|not allowed/i.test(m) ? 'Your role does not include this.' : m);

/** A value that settles a moment after the person stops typing. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10" -> "October 2026" */
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Shows the loading block, the error, or the children once data has arrived. */
export function Async<T>({ data, error, children }: { data: T | null; error: string | null; children: (d: T) => ReactNode }) {
  if (error) return <ErrorBox msg={forbidden(error)} />;
  if (!data) return <Loading h={160} />;
  return <>{children(data)}</>;
}

export function Select({ value, onChange, options, label, disabled }: { value: string; onChange: (v: string) => void; options: [string, string][]; label?: string; disabled?: boolean }) {
  return <select className="inp" value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

/** The compact bar of filters above a table. */
/** The filter controls of a list, behind the Filters button (open at first on a wide screen, closed on a phone). */
export const FilterBar = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  return (
    <div className="filterbar">
      <button type="button" className={`btn sm filter-btn${open ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="filter" size={15} />Filters</button>
      {open && <div className="filters">{children}</div>}
    </div>);
};
